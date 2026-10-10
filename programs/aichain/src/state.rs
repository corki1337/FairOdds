use anchor_lang::prelude::*;

/// Prefix for every PDA of this program version; v1 accounts are never read.
pub const SEED_VERSION: &[u8] = b"v2";
pub const SEED_GLOBAL: &[u8] = b"global";
pub const SEED_TREASURY: &[u8] = b"treasury";
pub const SEED_MARKET: &[u8] = b"market";
pub const SEED_VAULT: &[u8] = b"vault";
pub const SEED_RECEIPT: &[u8] = b"receipt";
pub const SEED_FAUCET: &[u8] = b"faucet";
/// Holds the demo-USDC mint authority so the faucet needs no human signer.
pub const SEED_MINT_AUTH: &[u8] = b"mint-auth";
/// Switchboard feed authority must be this PDA. No instruction signs with it,
/// so a feed handed over to it can never be reconfigured.
pub const SEED_FEED_LOCK: &[u8] = b"feed-lock";
/// Optional second result feed of a market. Its address is derived from the market, so a
/// resolver cannot hide it by leaving it out of the transaction.
pub const SEED_ORACLE2: &[u8] = b"oracle2";

/// `SecondaryOracle::source`: OpenLigaDB `getmatchdata/{source_ref}`.
pub const SOURCE_OPENLIGADB: u8 = 1;

/// 1 USDC (6 decimals). Keeps receipts from being spammed with dust.
pub const MIN_BET: u64 = 1_000_000;
pub const MIN_ORACLE_SAMPLES: usize = 1;
pub const MIN_RESOLVE_WINDOW: i64 = 5 * 60;
pub const MAX_RESOLVE_WINDOW: i64 = 30 * 24 * 60 * 60;
/// Max rounding loss tolerated when shares are redeemed from yield_park.
pub const PRINCIPAL_DUST_TOLERANCE: u64 = 1_000;

/// Demo-USDC faucet: enough to try a few bets, once a day per wallet.
pub const FAUCET_AMOUNT: u64 = 1_000_000_000;
pub const FAUCET_COOLDOWN: i64 = 24 * 60 * 60;

pub const CANCEL_NONE: u8 = 0;
pub const CANCEL_NO_WINNERS: u8 = 2;
pub const CANCEL_EXPIRED: u8 = 3;
pub const CANCEL_DRAW: u8 = 4;

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
    /// Switchboard PullFeed pinned at creation.
    pub oracle_feed: Pubkey,
    /// Job definition hash of `oracle_feed` at creation; resolve rejects any other.
    pub feed_hash: [u8; 32],
    pub start_time: i64,
    pub end_time: i64,
    /// After this, anyone may cancel and every bettor gets a refund.
    pub resolve_deadline: i64,
    pub pool_team_a: u64,
    pub pool_team_b: u64,
    pub status: MarketStatus,
    pub winning_team: Option<u8>,
    pub cancel_reason: u8,
    pub team_a: [u8; 32],
    pub team_b: [u8; 32],
    pub total_yield_harvested: u64,
    pub locked_principal: u64,
    pub yield_shares: u64,
    /// Amount distributed pro-rata to winners (Resolved) or all bettors (Cancelled).
    pub payout_pool: u64,
    /// Sum of stakes whose receipts were already paid out.
    pub claimed_stake: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl MarketState {
    pub const LEN: usize = 8 + Self::INIT_SPACE;

    pub fn total_pool(&self) -> u64 {
        self.pool_team_a.saturating_add(self.pool_team_b)
    }

    pub fn pool_of(&self, team: u8) -> u64 {
        if team == 0 {
            self.pool_team_a
        } else {
            self.pool_team_b
        }
    }

    /// Stake that still has a claim on the vault once the market is final.
    pub fn eligible_stake(&self) -> u64 {
        match (self.status, self.winning_team) {
            (MarketStatus::Resolved, Some(team)) => self.pool_of(team),
            (MarketStatus::Cancelled, _) => self.total_pool(),
            _ => u64::MAX,
        }
    }

    pub fn obligations_settled(&self) -> bool {
        self.claimed_stake >= self.eligible_stake()
    }
}

/// Second Switchboard feed pinned to a market from an independent provider. When present,
/// `resolve_market` settles only if both feeds report the same score difference.
#[account]
#[derive(InitSpace)]
pub struct SecondaryOracle {
    pub market: Pubkey,
    pub feed: Pubkey,
    pub feed_hash: [u8; 32],
    pub source: u8,
    /// Provider's own event id, so any client can rebuild the job and request an update.
    pub source_ref: u64,
    pub bump: u8,
}

impl SecondaryOracle {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
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

#[account]
#[derive(InitSpace)]
pub struct FaucetReceipt {
    pub user: Pubkey,
    pub last_claim: i64,
    pub bump: u8,
}

impl FaucetReceipt {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

/// Signer seeds for the market PDA (vault authority).
#[macro_export]
macro_rules! market_signer {
    ($market:expr, $id:ident, $bump:ident, $seeds:ident) => {
        let $id = $market.match_id.to_le_bytes();
        let $bump = [$market.bump];
        let $seeds: &[&[u8]] = &[
            $crate::state::SEED_VERSION,
            $crate::state::SEED_MARKET,
            $id.as_ref(),
            $bump.as_ref(),
        ];
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn market(status: MarketStatus, winning: Option<u8>, a: u64, b: u64, claimed: u64) -> MarketState {
        MarketState {
            match_id: 1,
            authority: Pubkey::default(),
            usdc_mint: Pubkey::default(),
            oracle_feed: Pubkey::default(),
            feed_hash: [0; 32],
            start_time: 0,
            end_time: 0,
            resolve_deadline: 0,
            pool_team_a: a,
            pool_team_b: b,
            status,
            winning_team: winning,
            cancel_reason: 0,
            team_a: [0; 32],
            team_b: [0; 32],
            total_yield_harvested: 0,
            locked_principal: 0,
            yield_shares: 0,
            payout_pool: a + b,
            claimed_stake: claimed,
            bump: 0,
            vault_bump: 0,
        }
    }

    #[test]
    fn open_or_locked_markets_never_settled() {
        assert!(!market(MarketStatus::Open, None, 0, 0, 0).obligations_settled());
        assert!(!market(MarketStatus::Locked, None, 5, 5, 10).obligations_settled());
    }

    #[test]
    fn resolved_requires_all_winning_stake_claimed() {
        assert!(!market(MarketStatus::Resolved, Some(0), 300, 700, 299).obligations_settled());
        assert!(market(MarketStatus::Resolved, Some(0), 300, 700, 300).obligations_settled());
        assert!(market(MarketStatus::Resolved, Some(1), 300, 700, 700).obligations_settled());
    }

    #[test]
    fn cancelled_requires_every_refund() {
        assert!(!market(MarketStatus::Cancelled, None, 300, 700, 300).obligations_settled());
        assert!(market(MarketStatus::Cancelled, None, 300, 700, 1000).obligations_settled());
        assert!(market(MarketStatus::Cancelled, None, 0, 0, 0).obligations_settled());
    }
}

/// Immutable opt-in rules for newly created match markets. Legacy markets have no policy.
pub const SEED_POLICY: &[u8] = b"policy";
pub const CANCEL_ONE_SIDED: u8 = 5;
#[account]
#[derive(InitSpace)]
pub struct MarketPolicy {
    pub market: Pubkey,
    pub fee_bps: u16,
    pub cancel_one_sided: bool,
    pub bump: u8,
}
impl MarketPolicy { pub const LEN: usize = 8 + Self::INIT_SPACE; }

pub fn load_policy(info: &AccountInfo, market: &Pubkey) -> Result<Option<MarketPolicy>> {
    if info.data_is_empty() { return Ok(None); }
    require_keys_eq!(*info.owner, crate::ID, crate::errors::AichainError::Unauthorized);
    let data = info.try_borrow_data()?;
    let policy = MarketPolicy::try_deserialize(&mut &data[..])?;
    require_keys_eq!(policy.market, *market, crate::errors::AichainError::Unauthorized);
    Ok(Some(policy))
}
