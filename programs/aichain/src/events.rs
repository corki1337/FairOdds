use anchor_lang::prelude::*;

#[event]
pub struct MarketInitialized {
    pub match_id: u64,
    pub market: Pubkey,
    pub oracle_feed: Pubkey,
    pub feed_hash: [u8; 32],
    pub start_time: i64,
    pub end_time: i64,
    pub resolve_deadline: i64,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub user: Pubkey,
    pub team: u8,
    pub amount: u64,
}

#[event]
pub struct MarketLocked {
    pub market: Pubkey,
    pub principal: u64,
    pub shares: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    /// Raw oracle outcome (0/1/2), or u8::MAX when cancelled on deadline.
    pub oracle_result: u8,
    pub winning_team: Option<u8>,
    pub cancel_reason: u8,
    pub payout_pool: u64,
    pub yield_harvested: u64,
}

#[event]
pub struct WinningsClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub payout: u64,
}

#[event]
pub struct BetRefunded {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ProtocolFeePaid { pub market: Pubkey, pub user: Pubkey, pub fee: u64 }
