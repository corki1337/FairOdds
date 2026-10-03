use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::YieldError;
use crate::state::Park;

#[derive(Accounts)]
pub struct SeedReserve<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"park", park.mint.as_ref()],
        bump = park.bump,
        has_one = authority,
        has_one = mint,
    )]
    pub park: Account<'info, Park>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = authority_ata.mint == park.mint,
        constraint = authority_ata.owner == authority.key(),
    )]
    pub authority_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"park-vault", park.key().as_ref()],
        bump = park.vault_bump,
    )]
    pub park_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SeedReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, YieldError::ZeroAmount);
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.authority_ata.to_account_info(),
                to: ctx.accounts.park_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        amount,
    )?;
    ctx.accounts.park.reserve_seeded = ctx
        .accounts
        .park
        .reserve_seeded
        .saturating_add(amount);
    Ok(())
}
