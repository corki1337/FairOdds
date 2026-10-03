use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury: Pubkey,
    pub yield_park: Pubkey,
    pub bump: u8,
}

impl GlobalConfig {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Open,
    Locked,
    Resolved,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub match_id: u64,
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub oracle_feed: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub pool_team_a: u64,
    pub pool_team_b: u64,
    pub status: MarketStatus,
    pub winning_team: Option<u8>,
    pub team_a: [u8; 32],
    pub team_b: [u8; 32],
    pub total_yield_harvested: u64,
    pub locked_principal: u64,
    pub yield_shares: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl MarketState {
    pub const LEN: usize = 8 + Self::INIT_SPACE;

    pub fn total_pool(&self) -> u64 {
        self.pool_team_a.saturating_add(self.pool_team_b)
    }
}

#[account]
#[derive(InitSpace)]
pub struct UserBetReceipt {
    pub user: Pubkey,
    pub market: Pubkey,
    pub team_selected: u8,
    pub amount_staked: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl UserBetReceipt {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

/// Oracle feed account written by the designated oracle authority.
/// Resolve only trusts `market.oracle_feed` pubkey set at market initialization.
/// HTTP source for Switchboard jobs: `/api/oracle/[matchId]`.
#[account]
#[derive(InitSpace)]
pub struct OracleFeed {
    pub authority: Pubkey,
    pub match_id: u64,
    pub market: Pubkey,
    /// 0 = Team A, 1 = Team B, 2 = Cancelled/draw
    pub result: u8,
    pub updated_at: i64,
    pub finalized: bool,
    pub bump: u8,
}

impl OracleFeed {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}
