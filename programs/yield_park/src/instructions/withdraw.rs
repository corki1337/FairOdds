use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::YieldError;
use crate::state::{Park, Position};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"park", park.mint.as_ref()],
        bump = park.bump,
    )]
    pub park: Account<'info, Park>,

    #[account(
        mut,
        constraint = owner_ata.mint == park.mint,
        constraint = owner_ata.owner == owner.key(),
    )]
    pub owner_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"park-vault", park.key().as_ref()],
        bump = park.vault_bump,
    )]
    pub park_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"position", park.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = park,
    )]
    pub position: Account<'info, Position>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
    require!(shares > 0, YieldError::ZeroAmount);
    require!(
        ctx.accounts.position.shares >= shares,
        YieldError::InsufficientShares
    );

    let park = &mut ctx.accounts.park;
    let clock = Clock::get()?;
    park.accrue(clock.unix_timestamp);

    let amount = park.amount_for_shares(shares)?;
    require!(
        ctx.accounts.park_vault.amount >= amount,
        YieldError::InsufficientLiquidity
    );

    let mint_key = park.mint;
    let seeds = &[b"park", mint_key.as_ref(), &[park.bump]];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.park_vault.to_account_info(),
                to: ctx.accounts.owner_ata.to_account_info(),
                authority: park.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    park.total_shares = park.total_shares.saturating_sub(shares);
    park.total_deposits = park.total_deposits.saturating_sub(amount);
    ctx.accounts.position.shares = ctx.accounts.position.shares.saturating_sub(shares);

    Ok(())
}
