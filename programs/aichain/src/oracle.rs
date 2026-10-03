use crate::errors::AichainError;
use crate::state::OracleFeed;
use anchor_lang::prelude::*;

/// Read and validate oracle feed. Result: 0=A, 1=B, 2=cancel.
pub fn read_oracle_result(feed: &OracleFeed, expected_market: Pubkey) -> Result<u8> {
    require!(feed.market == expected_market, AichainError::OracleMismatch);
    require!(feed.finalized, AichainError::OracleNotReady);
    require!(feed.result <= 2, AichainError::InvalidOracleResult);
    Ok(feed.result)
}
