use anchor_lang::prelude::*;

#[error_code]
pub enum AichainError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid team selection (use 0 or 1)")]
    InvalidTeam,
    #[msg("Bet amount must be > 0")]
    ZeroAmount,
    #[msg("Bet below minimum stake")]
    BetTooSmall,
    #[msg("Market is not open for bets")]
    MarketNotOpen,
    #[msg("Betting window has closed")]
    BettingClosed,
    #[msg("Cannot change team on existing receipt")]
    TeamMismatch,
    #[msg("Market cannot be locked yet")]
    CannotLock,
    #[msg("Market is already final")]
    MarketFinal,
    #[msg("Oracle feed mismatch")]
    OracleMismatch,
    #[msg("Invalid oracle result")]
    InvalidOracleResult,
    #[msg("Feed is not owned by the Switchboard program")]
    FeedOwnerMismatch,
    #[msg("Feed account data is invalid")]
    FeedInvalid,
    #[msg("Feed job hash differs from the one pinned at market creation")]
    FeedHashMismatch,
    #[msg("Feed is on an unexpected oracle queue")]
    FeedQueueMismatch,
    #[msg("Feed authority must be the program feed-lock PDA")]
    FeedAuthorityNotLocked,
    #[msg("Feed allows direct writes by its authority")]
    FeedWritableByAuthority,
    #[msg("No oracle submission after match end")]
    FeedStale,
    #[msg("Not enough oracle samples after match end")]
    InsufficientSamples,
    #[msg("Oracle submissions disagree")]
    OracleDisagreement,
    #[msg("Match has not ended yet")]
    ResolveTooEarly,
    #[msg("Resolve window closed; cancel the market instead")]
    ResolveWindowClosed,
    #[msg("Resolve deadline not reached")]
    DeadlineNotReached,
    #[msg("Invalid resolve deadline")]
    InvalidResolveDeadline,
    #[msg("Yield park returned less than locked principal")]
    PrincipalShortfall,
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
    #[msg("Payouts still outstanding")]
    ObligationsOutstanding,
    #[msg("Nothing to harvest")]
    NothingToHarvest,
    #[msg("Invalid time window")]
    InvalidTimeWindow,
    #[msg("Faucet already used within the last 24h")]
    FaucetCooldown,
    #[msg("Token account has the wrong mint")]
    InvalidMint,
    #[msg("Amount exceeds treasury balance")]
    InsufficientTreasury,
}
