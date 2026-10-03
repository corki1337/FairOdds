use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::YieldError;
use crate::state::Park;

#[derive(Accounts)]
pub struct InitializePark<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = Park::LEN,
        seeds = [b"park", mint.key().as_ref()],
        bump
    )]
    pub park: Account<'info, Park>,

    #[account(
        init,
        payer = authority,
        seeds = [b"park-vault", park.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = park,
    )]
    pub park_vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializePark>, apr_bps: u16) -> Result<()> {
    require!(apr_bps > 0 && apr_bps <= 10_000, YieldError::InvalidApr);
    let park = &mut ctx.accounts.park;
    let clock = Clock::get()?;
    park.authority = ctx.accounts.authority.key();
    park.mint = ctx.accounts.mint.key();
    park.vault = ctx.accounts.park_vault.key();
    park.total_shares = 0;
    park.total_deposits = 0;
    park.reserve_seeded = 0;
    park.apr_bps = apr_bps;
    park.last_update_ts = clock.unix_timestamp;
    park.bump = ctx.bumps.park;
    park.vault_bump = ctx.bumps.park_vault;
    Ok(())
}
