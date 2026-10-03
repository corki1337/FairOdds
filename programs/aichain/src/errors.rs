use anchor_lang::prelude::*;

#[error_code]
pub enum AichainError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid team selection (use 0 or 1)")]
    InvalidTeam,
    #[msg("Bet amount must be > 0")]
    ZeroAmount,
    #[msg("Market is not open for bets")]
    MarketNotOpen,
    #[msg("Betting window has closed")]
    BettingClosed,
    #[msg("Cannot change team on existing receipt")]
    TeamMismatch,
    #[msg("Market cannot be locked yet")]
    CannotLock,
    #[msg("Market is not locked")]
    MarketNotLocked,
    #[msg("Oracle feed mismatch")]
    OracleMismatch,
    #[msg("Oracle result not finalized")]
    OracleNotReady,
    #[msg("Invalid oracle result")]
    InvalidOracleResult,
    #[msg("Market not resolved")]
    MarketNotResolved,
    #[msg("Market not cancelled")]
    MarketNotCancelled,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Not a winning bet")]
    NotWinner,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Winning pool is empty")]
    EmptyWinningPool,
    #[msg("Nothing to harvest")]
    NothingToHarvest,
    #[msg("Invalid time window")]
    InvalidTimeWindow,
}
