use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::AichainError;
use crate::state::{GlobalConfig, MarketState, MarketStatus};

#[derive(Accounts)]
pub struct HarvestToTreasury<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority,
        has_one = treasury,
    )]
    pub global: Account<'info, GlobalConfig>,

    #[account(
        seeds = [b"market", market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = (market.status == MarketStatus::Resolved
            || market.status == MarketStatus::Cancelled) @ AichainError::MarketNotResolved,
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
        seeds = [b"treasury", global.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<HarvestToTreasury>) -> Result<()> {
    // Dust / rounding leftovers after all claims — admin may sweep remainder.
    // Safety: only after resolved/cancelled. Leaves 0 required for pending claims
    // is the caller's responsibility on demo.
    let amount = ctx.accounts.vault.amount;
    require!(amount > 0, AichainError::NothingToHarvest);

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
                to: ctx.accounts.treasury.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    Ok(())
}
