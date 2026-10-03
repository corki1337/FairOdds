use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::AichainError;
use crate::events::BetPlaced;
use crate::state::{MarketState, MarketStatus, UserBetReceipt};

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Open @ AichainError::MarketNotOpen,
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
        init_if_needed,
        payer = user,
        space = UserBetReceipt::LEN,
        seeds = [b"receipt", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, UserBetReceipt>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<PlaceBet>, amount: u64, team: u8) -> Result<()> {
    require!(amount > 0, AichainError::ZeroAmount);
    require!(team <= 1, AichainError::InvalidTeam);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < ctx.accounts.market.start_time,
        AichainError::BettingClosed
    );

    let receipt = &mut ctx.accounts.receipt;
    if receipt.amount_staked == 0 && receipt.user == Pubkey::default() {
        receipt.user = ctx.accounts.user.key();
        receipt.market = ctx.accounts.market.key();
        receipt.team_selected = team;
        receipt.claimed = false;
        receipt.bump = ctx.bumps.receipt;
    } else {
        require!(receipt.team_selected == team, AichainError::TeamMismatch);
        require!(!receipt.claimed, AichainError::AlreadyClaimed);
    }

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    let market = &mut ctx.accounts.market;
    if team == 0 {
        market.pool_team_a = market.pool_team_a.saturating_add(amount);
    } else {
        market.pool_team_b = market.pool_team_b.saturating_add(amount);
    }
    receipt.amount_staked = receipt.amount_staked.saturating_add(amount);

    emit!(BetPlaced {
        market: market.key(),
        user: ctx.accounts.user.key(),
        team,
        amount,
    });

    Ok(())
}
