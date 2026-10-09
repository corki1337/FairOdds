use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use yield_park::program::YieldPark;
use yield_park::state::Park;

use crate::errors::AichainError;
use crate::events::MarketResolved;
use crate::state::{
    GlobalConfig, MarketState, MarketStatus, SecondaryOracle, CANCEL_DRAW, CANCEL_NONE,
    CANCEL_NO_WINNERS, MIN_ORACLE_SAMPLES, SEED_FEED_LOCK, SEED_GLOBAL, SEED_MARKET,
    SEED_ORACLE2, SEED_TREASURY, SEED_VAULT, SEED_VERSION,
};
use crate::switchboard::{agreed_diff, outcome_of_diff, PullFeedView, OUTCOME_DRAW};
use crate::yield_cpi::{settle_vault, SettleAccounts};

/// Permissionless: anyone may crank once the match is over and the pinned
/// Switchboard feed carries a post-match, unanimous result.
#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [SEED_VERSION, SEED_GLOBAL],
        bump = global.bump,
        has_one = treasury,
    )]
    pub global: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_MARKET, market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = (market.status == MarketStatus::Open
            || market.status == MarketStatus::Locked) @ AichainError::MarketFinal,
        constraint = market.oracle_feed == oracle_feed.key() @ AichainError::OracleMismatch,
    )]
    pub market: Box<Account<'info, MarketState>>,

    /// CHECK: owner, queue, authority lock, job hash and submissions validated in handler
    pub oracle_feed: UncheckedAccount<'info>,

    /// CHECK: PDA that must own the feed; never signs
    #[account(seeds = [SEED_VERSION, SEED_FEED_LOCK], bump)]
    pub feed_lock: UncheckedAccount<'info>,

    /// CHECK: always this market's derived PDA; empty means the market has a single feed
    #[account(seeds = [SEED_VERSION, SEED_ORACLE2, market.key().as_ref()], bump)]
    pub secondary: UncheckedAccount<'info>,

    /// CHECK: required and validated against `secondary` when that account exists
    pub secondary_feed: Option<UncheckedAccount<'info>>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_VAULT, market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_TREASURY, global.key().as_ref()],
        bump,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"park", global.usdc_mint.as_ref()],
        bump = park.bump,
        seeds::program = yield_park_program.key(),
    )]
    pub park: Box<Account<'info, Park>>,

    #[account(
        mut,
        seeds = [b"park-vault", park.key().as_ref()],
        bump = park.vault_bump,
        seeds::program = yield_park_program.key(),
    )]
    pub park_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: yield position PDA for market (seeds checked by yield_park on withdraw)
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    pub yield_park_program: Program<'info, YieldPark>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let end_time = ctx.accounts.market.end_time;
    require!(now >= end_time, AichainError::ResolveTooEarly);
    require!(
        now < ctx.accounts.market.resolve_deadline,
        AichainError::ResolveWindowClosed
    );

    let feed = PullFeedView::load(&ctx.accounts.oracle_feed.to_account_info())?;
    feed.verify_immutable(&ctx.accounts.feed_lock.key())?;
    require!(
        feed.feed_hash == ctx.accounts.market.feed_hash,
        AichainError::FeedHashMismatch
    );
    let primary = feed.score_diff(end_time, MIN_ORACLE_SAMPLES)?;
    let market_key = ctx.accounts.market.key();
    let secondary = secondary_diff(
        &ctx.accounts.secondary.to_account_info(),
        ctx.accounts.secondary_feed.as_ref().map(|f| f.to_account_info()),
        &market_key,
        &ctx.accounts.feed_lock.key(),
        end_time,
    )?;
    let result = outcome_of_diff(agreed_diff(primary, secondary)?);

    let yield_harvested = settle_vault(SettleAccounts {
        market: &mut ctx.accounts.market,
        vault: &mut ctx.accounts.vault,
        treasury: ctx.accounts.treasury.to_account_info(),
        park: ctx.accounts.park.to_account_info(),
        park_vault: ctx.accounts.park_vault.to_account_info(),
        position: ctx.accounts.position.to_account_info(),
        yield_program: ctx.accounts.yield_park_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    })?;

    let market = &mut ctx.accounts.market;
    let cancel_reason = if result == OUTCOME_DRAW {
        CANCEL_DRAW
    } else if market.pool_of(result) == 0 {
        CANCEL_NO_WINNERS
    } else {
        CANCEL_NONE
    };

    if cancel_reason == CANCEL_NONE {
        market.status = MarketStatus::Resolved;
        market.winning_team = Some(result);
    } else {
        market.status = MarketStatus::Cancelled;
        market.winning_team = None;
    }
    market.cancel_reason = cancel_reason;

    emit!(MarketResolved {
        market: market_key,
        oracle_result: result,
        winning_team: market.winning_team,
        cancel_reason,
        payout_pool: market.payout_pool,
        yield_harvested,
    });

    Ok(())
}

fn secondary_diff(
    secondary: &AccountInfo,
    feed: Option<AccountInfo>,
    market: &Pubkey,
    feed_lock: &Pubkey,
    end_time: i64,
) -> Result<Option<i128>> {
    if secondary.data_is_empty() {
        return Ok(None);
    }
    require_keys_eq!(*secondary.owner, crate::ID, AichainError::SecondaryFeedMismatch);
    let pinned = {
        let data = secondary.try_borrow_data()?;
        SecondaryOracle::try_deserialize(&mut &data[..])?
    };
    require_keys_eq!(pinned.market, *market, AichainError::SecondaryFeedMismatch);
    let feed = feed.ok_or(error!(AichainError::SecondaryFeedMismatch))?;
    require_keys_eq!(feed.key(), pinned.feed, AichainError::SecondaryFeedMismatch);

    let view = PullFeedView::load(&feed)?;
    view.verify_immutable(feed_lock)?;
    require!(view.feed_hash == pinned.feed_hash, AichainError::FeedHashMismatch);
    Ok(Some(view.score_diff(end_time, MIN_ORACLE_SAMPLES)?))
}
