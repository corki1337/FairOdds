use anchor_lang::prelude::*;

use crate::errors::AichainError;
use crate::state::{
    GlobalConfig, MarketState, MarketStatus, SecondaryOracle, SEED_FEED_LOCK, SEED_GLOBAL,
    SEED_MARKET, SEED_ORACLE2, SEED_VERSION, SOURCE_OPENLIGADB,
};
use crate::switchboard::PullFeedView;

/// Pins a second, independent result feed to a market. Only allowed while nobody has bet
/// yet, so the settlement rule a bettor sees is the one that applies to their stake.
#[derive(Accounts)]
pub struct AttachSecondaryFeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_VERSION, SEED_GLOBAL],
        bump = global.bump,
        has_one = authority,
    )]
    pub global: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [SEED_VERSION, SEED_MARKET, market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Open @ AichainError::MarketNotOpen,
    )]
    pub market: Box<Account<'info, MarketState>>,

    #[account(
        init,
        payer = authority,
        space = SecondaryOracle::LEN,
        seeds = [SEED_VERSION, SEED_ORACLE2, market.key().as_ref()],
        bump,
    )]
    pub secondary: Box<Account<'info, SecondaryOracle>>,

    /// CHECK: Switchboard PullFeed; owner, queue, authority lock and job hash validated in handler
    pub secondary_feed: UncheckedAccount<'info>,

    /// CHECK: PDA that must own the feed; never signs
    #[account(seeds = [SEED_VERSION, SEED_FEED_LOCK], bump)]
    pub feed_lock: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AttachSecondaryFeed>, source: u8, source_ref: u64) -> Result<()> {
    require!(source == SOURCE_OPENLIGADB, AichainError::UnknownSource);
    let market = &ctx.accounts.market;
    let now = Clock::get()?.unix_timestamp;
    require!(
        market.total_pool() == 0 && now < market.start_time,
        AichainError::MarketHasBets
    );
    require!(
        ctx.accounts.secondary_feed.key() != market.oracle_feed,
        AichainError::SecondaryFeedDuplicate
    );

    let feed = PullFeedView::load(&ctx.accounts.secondary_feed.to_account_info())?;
    feed.verify_immutable(&ctx.accounts.feed_lock.key())?;
    require!(
        feed.feed_hash != market.feed_hash,
        AichainError::SecondaryFeedDuplicate
    );

    let secondary = &mut ctx.accounts.secondary;
    secondary.market = market.key();
    secondary.feed = ctx.accounts.secondary_feed.key();
    secondary.feed_hash = feed.feed_hash;
    secondary.source = source;
    secondary.source_ref = source_ref;
    secondary.bump = ctx.bumps.secondary;
    Ok(())
}
