use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::AichainError;
use crate::events::WinningsClaimed;
use crate::market_signer;
use crate::math::pari_mutuel_payout;
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

    if payout > 0 {
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
            payout,
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
        payout,
    });

    Ok(())
}
