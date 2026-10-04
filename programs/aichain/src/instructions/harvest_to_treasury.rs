use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::AichainError;
use crate::market_signer;
use crate::state::{
    GlobalConfig, MarketState, MarketStatus, SEED_GLOBAL, SEED_MARKET, SEED_TREASURY, SEED_VAULT,
    SEED_VERSION,
};

/// Permissionless sweep of rounding dust, only once every eligible receipt was paid.
#[derive(Accounts)]
pub struct HarvestToTreasury<'info> {
    pub crank: Signer<'info>,

    #[account(
        seeds = [SEED_VERSION, SEED_GLOBAL],
        bump = global.bump,
        has_one = treasury,
    )]
    pub global: Account<'info, GlobalConfig>,

    #[account(
        seeds = [SEED_VERSION, SEED_MARKET, market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = (market.status == MarketStatus::Resolved
            || market.status == MarketStatus::Cancelled) @ AichainError::MarketNotResolved,
        constraint = market.obligations_settled() @ AichainError::ObligationsOutstanding,
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
        seeds = [SEED_VERSION, SEED_TREASURY, global.key().as_ref()],
        bump,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<HarvestToTreasury>) -> Result<()> {
    let amount = ctx.accounts.vault.amount;
    require!(amount > 0, AichainError::NothingToHarvest);

    let market = &ctx.accounts.market;
    market_signer!(market, id, bump, seeds);
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    Ok(())
}
