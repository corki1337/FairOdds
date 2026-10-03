use anchor_lang::prelude::*;

#[event]
pub struct MarketInitialized {
    pub match_id: u64,
    pub market: Pubkey,
    pub start_time: i64,
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
    pub winning_team: Option<u8>,
    pub cancelled: bool,
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
