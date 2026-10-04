//! Minimal read-only view of a Switchboard On-Demand `PullFeedAccountData` account.
//!
//! The upstream `switchboard-on-demand` crate requires Anchor 0.31 / Solana 2.x, so the
//! layout is vendored here as fixed byte offsets (account is `#[repr(C)]` zero-copy and
//! has no implicit padding). Offsets are pinned by a test against a real devnet account.

use anchor_lang::prelude::*;
use solana_program::pubkey;

use crate::errors::AichainError;

#[cfg(not(feature = "mainnet"))]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = pubkey!("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");
#[cfg(feature = "mainnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = pubkey!("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv");

#[cfg(not(feature = "mainnet"))]
pub const SWITCHBOARD_QUEUE: Pubkey = pubkey!("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");
#[cfg(feature = "mainnet")]
pub const SWITCHBOARD_QUEUE: Pubkey = pubkey!("A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w");

pub const PULL_FEED_DISCRIMINATOR: [u8; 8] = [196, 27, 108, 196, 10, 215, 219, 40];

/// Switchboard values are i128 fixed-point with 18 decimals.
pub const FEED_SCALE: i128 = 1_000_000_000_000_000_000;

const MAX_SUBMISSIONS: usize = 32;
const SUBMISSION_SIZE: usize = 64;

// Offsets relative to the start of account data (discriminator included).
const OFF_SUBMISSIONS: usize = 8;
const OFF_AUTHORITY: usize = 8 + 2048;
const OFF_QUEUE: usize = 8 + 2080;
const OFF_FEED_HASH: usize = 8 + 2112;
const OFF_PERMIT_WRITE_BY_AUTHORITY: usize = 8 + 2205;
const OFF_LAST_UPDATE_TIMESTAMP: usize = 8 + 2208;
const OFF_SUBMISSION_TIMESTAMPS: usize = 8 + 2944;
pub const PULL_FEED_ACCOUNT_LEN: usize = 8 + 3200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Submission {
    pub oracle: Pubkey,
    pub value: i128,
    pub timestamp: i64,
}

#[derive(Clone, Debug)]
pub struct PullFeedView {
    pub authority: Pubkey,
    pub queue: Pubkey,
    pub feed_hash: [u8; 32],
    pub permit_write_by_authority: bool,
    pub last_update_timestamp: i64,
    pub submissions: Vec<Submission>,
}

fn read_pubkey(data: &[u8], off: usize) -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(&data[off..off + 32]);
    Pubkey::new_from_array(b)
}

fn read_i64(data: &[u8], off: usize) -> i64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[off..off + 8]);
    i64::from_le_bytes(b)
}

fn read_i128(data: &[u8], off: usize) -> i128 {
    let mut b = [0u8; 16];
    b.copy_from_slice(&data[off..off + 16]);
    i128::from_le_bytes(b)
}

impl PullFeedView {
    pub fn parse(data: &[u8]) -> Result<Self> {
        require!(data.len() >= PULL_FEED_ACCOUNT_LEN, AichainError::FeedInvalid);
        require!(data[..8] == PULL_FEED_DISCRIMINATOR, AichainError::FeedInvalid);

        let mut submissions = Vec::new();
        for i in 0..MAX_SUBMISSIONS {
            let off = OFF_SUBMISSIONS + i * SUBMISSION_SIZE;
            let oracle = read_pubkey(data, off);
            if oracle == Pubkey::default() {
                continue;
            }
            submissions.push(Submission {
                oracle,
                value: read_i128(data, off + 48),
                timestamp: read_i64(data, OFF_SUBMISSION_TIMESTAMPS + i * 8),
            });
        }

        let mut feed_hash = [0u8; 32];
        feed_hash.copy_from_slice(&data[OFF_FEED_HASH..OFF_FEED_HASH + 32]);

        Ok(Self {
            authority: read_pubkey(data, OFF_AUTHORITY),
            queue: read_pubkey(data, OFF_QUEUE),
            feed_hash,
            permit_write_by_authority: data[OFF_PERMIT_WRITE_BY_AUTHORITY] != 0,
            last_update_timestamp: read_i64(data, OFF_LAST_UPDATE_TIMESTAMP),
            submissions,
        })
    }

    pub fn load(feed: &AccountInfo) -> Result<Self> {
        require_keys_eq!(*feed.owner, SWITCHBOARD_PROGRAM_ID, AichainError::FeedOwnerMismatch);
        let data = feed.try_borrow_data()?;
        Self::parse(&data)
    }

    /// Checks that nobody can reconfigure the feed (job hash, queue) or write values directly:
    /// authority must be the program-owned lock PDA, which no instruction ever signs for.
    pub fn verify_immutable(&self, expected_authority: &Pubkey) -> Result<()> {
        require_keys_eq!(self.queue, SWITCHBOARD_QUEUE, AichainError::FeedQueueMismatch);
        require_keys_eq!(self.authority, *expected_authority, AichainError::FeedAuthorityNotLocked);
        require!(!self.permit_write_by_authority, AichainError::FeedWritableByAuthority);
        require!(self.feed_hash != [0u8; 32], AichainError::FeedInvalid);
        Ok(())
    }

    /// Outcome from oracle submissions that landed at or after `not_before`.
    /// Requires at least `min_samples` such submissions and that they all agree
    /// on the exact score difference.
    pub fn outcome(&self, not_before: i64, min_samples: usize) -> Result<u8> {
        let fresh: Vec<&Submission> = self
            .submissions
            .iter()
            .filter(|s| s.timestamp >= not_before)
            .collect();
        require!(!fresh.is_empty(), AichainError::FeedStale);
        require!(fresh.len() >= min_samples, AichainError::InsufficientSamples);
        let value = fresh[0].value;
        require!(
            fresh.iter().all(|s| s.value == value),
            AichainError::OracleDisagreement
        );
        decode_outcome(value)
    }
}

/// Team A is always the home side and team B the away side.
pub const OUTCOME_TEAM_A: u8 = 0;
pub const OUTCOME_TEAM_B: u8 = 1;
pub const OUTCOME_DRAW: u8 = 2;

/// No real fixture ends with a larger goal/round difference; beyond this the feed is broken.
pub const MAX_SCORE_DIFF: i128 = 100;

/// The feed carries `home_score - away_score`, so a match that has not finished yet simply
/// produces no value at all and the oracles cannot push anything.
pub fn decode_outcome(value: i128) -> Result<u8> {
    require!(
        value % FEED_SCALE == 0,
        AichainError::InvalidOracleResult
    );
    let diff = value / FEED_SCALE;
    require!(
        (-MAX_SCORE_DIFF..=MAX_SCORE_DIFF).contains(&diff),
        AichainError::InvalidOracleResult
    );
    Ok(if diff > 0 {
        OUTCOME_TEAM_A
    } else if diff < 0 {
        OUTCOME_TEAM_B
    } else {
        OUTCOME_DRAW
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    /// Real devnet PullFeed account dumped after one oracle update with value 1.
    const FIXTURE: &[u8] = include_bytes!("../tests/fixtures/pull_feed.bin");

    #[test]
    fn parses_real_devnet_account() {
        assert_eq!(FIXTURE.len(), PULL_FEED_ACCOUNT_LEN);
        let feed = PullFeedView::parse(FIXTURE).unwrap();
        assert_eq!(
            feed.queue,
            Pubkey::from_str("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7").unwrap()
        );
        assert_eq!(
            feed.authority,
            Pubkey::from_str("4W3PzT8zz2kkKUccegRwFZNCNXL9ZwdwYZJVMzsZqBQo").unwrap()
        );
        assert_eq!(
            hex(&feed.feed_hash),
            "68da9b842b429b7798dd136e82161addf7f97bc4cf4c6758dfa317aaf6d3f6f1"
        );
        assert!(!feed.permit_write_by_authority);
        assert_eq!(feed.last_update_timestamp, 1_791_073_601);
        assert_eq!(feed.submissions.len(), 1);
        assert_eq!(feed.submissions[0].value, FEED_SCALE);
        assert_eq!(feed.submissions[0].timestamp, 1_791_073_601);
        // +1 goal difference means the home side won.
        assert_eq!(feed.outcome(1_791_073_601, 1).unwrap(), OUTCOME_TEAM_A);
    }

    #[test]
    fn rejects_submissions_before_end_time() {
        let feed = PullFeedView::parse(FIXTURE).unwrap();
        assert!(feed.outcome(1_791_073_602, 1).is_err());
    }

    #[test]
    fn requires_min_samples() {
        let feed = PullFeedView::parse(FIXTURE).unwrap();
        assert!(feed.outcome(0, 2).is_err());
    }

    #[test]
    fn rejects_bad_discriminator_and_short_data() {
        let mut bad = FIXTURE.to_vec();
        bad[0] ^= 1;
        assert!(PullFeedView::parse(&bad).is_err());
        assert!(PullFeedView::parse(&FIXTURE[..PULL_FEED_ACCOUNT_LEN - 1]).is_err());
    }

    #[test]
    fn rejects_disagreeing_oracles() {
        let mut data = FIXTURE.to_vec();
        let off = OFF_SUBMISSIONS + SUBMISSION_SIZE;
        data[off..off + 32].copy_from_slice(&[7u8; 32]);
        data[off + 48..off + 64].copy_from_slice(&0i128.to_le_bytes());
        let ts = OFF_SUBMISSION_TIMESTAMPS + 8;
        data[ts..ts + 8].copy_from_slice(&1_791_073_700i64.to_le_bytes());
        let feed = PullFeedView::parse(&data).unwrap();
        assert!(feed.outcome(0, 2).is_err());
        // Only the newer submission counts after its timestamp.
        assert_eq!(feed.outcome(1_791_073_650, 1).unwrap(), OUTCOME_DRAW);
    }

    #[test]
    fn verify_immutable_checks_authority_and_write_flag() {
        let feed = PullFeedView::parse(FIXTURE).unwrap();
        let lock = Pubkey::new_unique();
        assert!(feed.verify_immutable(&lock).is_err());
        assert!(feed.verify_immutable(&feed.authority.clone()).is_ok());

        let mut data = FIXTURE.to_vec();
        data[OFF_PERMIT_WRITE_BY_AUTHORITY] = 1;
        let writable = PullFeedView::parse(&data).unwrap();
        assert!(writable.verify_immutable(&writable.authority.clone()).is_err());
    }

    #[test]
    fn decodes_score_difference_sign() {
        assert_eq!(decode_outcome(0).unwrap(), OUTCOME_DRAW);
        assert_eq!(decode_outcome(FEED_SCALE).unwrap(), OUTCOME_TEAM_A);
        assert_eq!(decode_outcome(7 * FEED_SCALE).unwrap(), OUTCOME_TEAM_A);
        assert_eq!(decode_outcome(-FEED_SCALE).unwrap(), OUTCOME_TEAM_B);
        assert_eq!(decode_outcome(-2 * FEED_SCALE).unwrap(), OUTCOME_TEAM_B);
    }

    #[test]
    fn rejects_fractional_and_absurd_differences() {
        assert!(decode_outcome(FEED_SCALE - 1).is_err());
        assert!(decode_outcome(FEED_SCALE / 2).is_err());
        assert!(decode_outcome((MAX_SCORE_DIFF + 1) * FEED_SCALE).is_err());
        assert!(decode_outcome(-(MAX_SCORE_DIFF + 1) * FEED_SCALE).is_err());
        assert!(decode_outcome(i128::MAX).is_err());
        assert!(decode_outcome(i128::MIN + 1).is_err());
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{:02x}", x)).collect()
    }
}
