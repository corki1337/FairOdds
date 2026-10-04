use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::AichainError;
use crate::state::{GlobalConfig, SEED_GLOBAL, SEED_TREASURY, SEED_VERSION};

/// Treasury holds protocol yield and rounding dust. Only the protocol authority may move it,
/// and it can never touch a market vault, so bettor funds stay out of reach.
#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_VERSION, SEED_GLOBAL],
        bump = global.bump,
        has_one = authority,
        has_one = treasury,
    )]
    pub global: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_TREASURY, global.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = destination.mint == global.usdc_mint @ AichainError::InvalidMint,
    )]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    require!(amount > 0, AichainError::ZeroAmount);
    require!(
        amount <= ctx.accounts.treasury.amount,
        AichainError::InsufficientTreasury
    );

    let bump = [ctx.accounts.global.bump];
    let seeds: &[&[u8]] = &[SEED_VERSION, SEED_GLOBAL, bump.as_ref()];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.global.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    Ok(())
}
