use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use yield_park::program::YieldPark;
use yield_park::state::Park;

use crate::errors::AichainError;
use crate::events::MarketResolved;
use crate::oracle::read_oracle_result;
use crate::state::{GlobalConfig, MarketState, MarketStatus, OracleFeed};
use crate::yield_cpi;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = treasury,
    )]
    pub global: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [b"market", market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Locked @ AichainError::MarketNotLocked,
        constraint = market.oracle_feed == oracle_feed.key() @ AichainError::OracleMismatch,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        seeds = [b"oracle", market.match_id.to_le_bytes().as_ref()],
        bump = oracle_feed.bump,
    )]
    pub oracle_feed: Account<'info, OracleFeed>,

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

    #[account(
        mut,
        seeds = [b"park", global.usdc_mint.as_ref()],
        bump = park.bump,
        seeds::program = yield_park_program.key(),
    )]
    pub park: Account<'info, Park>,

    #[account(
        mut,
        seeds = [b"park-vault", park.key().as_ref()],
        bump = park.vault_bump,
        seeds::program = yield_park_program.key(),
    )]
    pub park_vault: Account<'info, TokenAccount>,

    /// CHECK: yield position PDA for market
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    pub yield_park_program: Program<'info, YieldPark>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let result = read_oracle_result(&ctx.accounts.oracle_feed, ctx.accounts.market.key())?;

    let principal = ctx.accounts.market.locked_principal;
    let shares = ctx.accounts.market.yield_shares;
    let market_key = ctx.accounts.market.key();

    let mut yield_harvested = 0u64;

    if shares > 0 {
        let vault_before = ctx.accounts.vault.amount;

        yield_cpi::withdraw_from_park(
            &ctx.accounts.market,
            ctx.accounts.market.to_account_info(),
            ctx.accounts.yield_park_program.to_account_info(),
            ctx.accounts.park.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.park_vault.to_account_info(),
            ctx.accounts.position.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            shares,
        )?;

        // Reload vault amount after CPI
        ctx.accounts.vault.reload()?;
        let vault_after = ctx.accounts.vault.amount;
        let returned = vault_after.saturating_sub(vault_before);

        if returned > principal {
            yield_harvested = returned.saturating_sub(principal);
            // Transfer yield surplus to treasury (market PDA signs)
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
                yield_harvested,
            )?;
        }
    }

    let market = &mut ctx.accounts.market;
    market.total_yield_harvested = yield_harvested;
    market.yield_shares = 0;

    let cancelled = result == 2;
    if cancelled {
        market.status = MarketStatus::Cancelled;
        market.winning_team = None;
    } else {
        market.status = MarketStatus::Resolved;
        market.winning_team = Some(result);
    }

    emit!(MarketResolved {
        market: market_key,
        winning_team: market.winning_team,
        cancelled,
        yield_harvested,
    });

    Ok(())
}
