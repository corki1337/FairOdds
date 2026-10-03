use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::AichainError;
use crate::events::MarketInitialized;
use crate::state::{GlobalConfig, MarketState, MarketStatus, OracleFeed};

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority,
        has_one = usdc_mint,
    )]
    pub global: Account<'info, GlobalConfig>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = MarketState::LEN,
        seeds = [b"market", match_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        init,
        payer = authority,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        space = OracleFeed::LEN,
        seeds = [b"oracle", match_id.to_le_bytes().as_ref()],
        bump
    )]
    pub oracle_feed: Account<'info, OracleFeed>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeMarket>,
    match_id: u64,
    start_time: i64,
    end_time: i64,
    team_a: [u8; 32],
    team_b: [u8; 32],
) -> Result<()> {
    require!(end_time > start_time, AichainError::InvalidTimeWindow);
    let clock = Clock::get()?;
    require!(start_time > clock.unix_timestamp, AichainError::InvalidTimeWindow);

    let market = &mut ctx.accounts.market;
    market.match_id = match_id;
    market.authority = ctx.accounts.authority.key();
    market.usdc_mint = ctx.accounts.usdc_mint.key();
    market.oracle_feed = ctx.accounts.oracle_feed.key();
    market.start_time = start_time;
    market.end_time = end_time;
    market.pool_team_a = 0;
    market.pool_team_b = 0;
    market.status = MarketStatus::Open;
    market.winning_team = None;
    market.team_a = team_a;
    market.team_b = team_b;
    market.total_yield_harvested = 0;
    market.locked_principal = 0;
    market.yield_shares = 0;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.vault;

    let oracle = &mut ctx.accounts.oracle_feed;
    oracle.authority = ctx.accounts.authority.key();
    oracle.match_id = match_id;
    oracle.market = market.key();
    oracle.result = 0;
    oracle.updated_at = 0;
    oracle.finalized = false;
    oracle.bump = ctx.bumps.oracle_feed;

    emit!(MarketInitialized {
        match_id,
        market: market.key(),
        start_time,
    });

    Ok(())
}
