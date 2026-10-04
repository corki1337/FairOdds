use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::YieldError;
use crate::state::{Park, Position};

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// Position owner (can be a PDA signer via CPI).
    pub owner: Signer<'info>,

    /// Pays rent for position account when first created.
    #[account(mut)]
    pub payer: Signer<'info>,

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
        init_if_needed,
        payer = payer,
        space = Position::LEN,
        seeds = [b"position", park.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, YieldError::ZeroAmount);

    let park = &mut ctx.accounts.park;
    let clock = Clock::get()?;
    park.accrue(clock.unix_timestamp, ctx.accounts.park_vault.amount);

    let shares = park.shares_for_amount(amount)?;
    require!(shares > 0, YieldError::ZeroAmount);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_ata.to_account_info(),
                to: ctx.accounts.park_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    park.total_deposits = park
        .total_deposits
        .checked_add(amount)
        .ok_or(error!(YieldError::MathOverflow))?;
    park.total_shares = park
        .total_shares
        .checked_add(shares)
        .ok_or(error!(YieldError::MathOverflow))?;

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.owner.key();
        position.park = park.key();
        position.bump = ctx.bumps.position;
    }
    position.shares = position.shares.saturating_add(shares);

    Ok(())
}
