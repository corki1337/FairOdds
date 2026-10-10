use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::AichainError;
use crate::events::WinningsClaimed;
use crate::market_signer;
use crate::math::{pari_mutuel_payout, profit_fee};
use crate::state::{GlobalConfig, SEED_GLOBAL, SEED_POLICY, SEED_TREASURY, load_policy};
use crate::state::{
    MarketState, MarketStatus, UserBetReceipt, SEED_MARKET, SEED_RECEIPT, SEED_VAULT, SEED_VERSION,
};

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_MARKET, market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Resolved @ AichainError::MarketNotResolved,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_VAULT, market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_ata.mint == market.usdc_mint,
        constraint = user_ata.owner == user.key(),
    )]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_RECEIPT, market.key().as_ref(), user.key().as_ref()],
        bump = receipt.bump,
        has_one = user,
        has_one = market,
    )]
    pub receipt: Account<'info, UserBetReceipt>,

    /// CHECK: mandatory derived address prevents hiding an opted-in fee policy
    #[account(seeds = [SEED_VERSION, SEED_POLICY, market.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,
    #[account(seeds = [SEED_VERSION, SEED_GLOBAL], bump = global.bump, has_one = treasury)]
    pub global: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [SEED_VERSION, SEED_TREASURY, global.key().as_ref()], bump)]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimWinnings>) -> Result<()> {
    let receipt = &ctx.accounts.receipt;
    require!(!receipt.claimed, AichainError::AlreadyClaimed);

    let market = &ctx.accounts.market;
    let winning = market
        .winning_team
        .ok_or(error!(AichainError::MarketNotResolved))?;
    require!(receipt.team_selected == winning, AichainError::NotWinner);

    let stake = receipt.amount_staked;
    let payout = pari_mutuel_payout(stake, market.pool_of(winning), market.payout_pool)?;

    let policy = load_policy(&ctx.accounts.policy.to_account_info(), &market.key())?;
    let fee = profit_fee(payout, stake, policy.map(|p| p.fee_bps).unwrap_or(0))?;
    let net = payout.checked_sub(fee).ok_or(error!(AichainError::MathOverflow))?;
    if fee > 0 {
        market_signer!(market, id, bump, seeds);
        token::transfer(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.treasury.to_account_info(), authority: ctx.accounts.market.to_account_info() },
            &[seeds],
        ), fee)?;
        emit!(crate::events::ProtocolFeePaid { market: market.key(), user: ctx.accounts.user.key(), fee });
    }
    if net > 0 {
        market_signer!(market, id, bump, seeds);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[seeds],
            ),
            net,
        )?;
    }

    ctx.accounts.receipt.claimed = true;
    let market = &mut ctx.accounts.market;
    market.claimed_stake = market
        .claimed_stake
        .checked_add(stake)
        .ok_or(error!(AichainError::MathOverflow))?;

    emit!(WinningsClaimed {
        market: market.key(),
        user: ctx.accounts.user.key(),
        payout: net,
    });

    Ok(())
}
