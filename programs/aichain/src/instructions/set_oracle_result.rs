use anchor_lang::prelude::*;

use crate::errors::AichainError;
use crate::state::{MarketState, OracleFeed};

#[derive(Accounts)]
pub struct SetOracleResult<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.oracle_feed == oracle_feed.key() @ AichainError::OracleMismatch,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [b"oracle", market.match_id.to_le_bytes().as_ref()],
        bump = oracle_feed.bump,
        has_one = authority @ AichainError::Unauthorized,
        constraint = oracle_feed.market == market.key() @ AichainError::OracleMismatch,
    )]
    pub oracle_feed: Account<'info, OracleFeed>,
}

pub fn handler(ctx: Context<SetOracleResult>, result: u8) -> Result<()> {
    require!(result <= 2, AichainError::InvalidOracleResult);
    let clock = Clock::get()?;
    let oracle = &mut ctx.accounts.oracle_feed;
    oracle.result = result;
    oracle.updated_at = clock.unix_timestamp;
    oracle.finalized = true;
    Ok(())
}
