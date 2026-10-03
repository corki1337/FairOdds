use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::AichainError;
use crate::events::WinningsClaimed;
use crate::math::pari_mutuel_payout;
use crate::state::{MarketState, MarketStatus, UserBetReceipt};

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"market", market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Resolved @ AichainError::MarketNotResolved,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
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
        seeds = [b"receipt", market.key().as_ref(), user.key().as_ref()],
        bump = receipt.bump,
        has_one = user,
        constraint = receipt.market == market.key(),
    )]
    pub receipt: Account<'info, UserBetReceipt>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimWinnings>) -> Result<()> {
    let receipt = &ctx.accounts.receipt;
    require!(!receipt.claimed, AichainError::AlreadyClaimed);

    let winning = ctx
        .accounts
        .market
        .winning_team
        .ok_or(error!(AichainError::MarketNotResolved))?;
    require!(receipt.team_selected == winning, AichainError::NotWinner);

    let winning_pool = if winning == 0 {
        ctx.accounts.market.pool_team_a
    } else {
        ctx.accounts.market.pool_team_b
    };
    let total_pool = ctx.accounts.market.total_pool();
    let payout = pari_mutuel_payout(receipt.amount_staked, winning_pool, total_pool)?;

    let match_id_bytes = ctx.accounts.market.match_id.to_le_bytes();
    let seeds = &[
        b"market".as_ref(),
        match_id_bytes.as_ref(),
        &[ctx.accounts.market.bump],
    ];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        payout,
    )?;

    ctx.accounts.receipt.claimed = true;

    emit!(WinningsClaimed {
        market: ctx.accounts.market.key(),
        user: ctx.accounts.user.key(),
        payout,
    });

    Ok(())
}
