use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::AichainError;
use crate::events::MarketInitialized;
use crate::state::{
    GlobalConfig, MarketState, MarketStatus, CANCEL_NONE, MAX_RESOLVE_WINDOW, MIN_RESOLVE_WINDOW,
    SEED_FEED_LOCK, SEED_GLOBAL, SEED_MARKET, SEED_VAULT, SEED_VERSION,
};
use crate::switchboard::PullFeedView;

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [SEED_VERSION, SEED_GLOBAL],
        bump = global.bump,
        has_one = authority,
        has_one = usdc_mint,
    )]
    pub global: Box<Account<'info, GlobalConfig>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        space = MarketState::LEN,
        seeds = [SEED_VERSION, SEED_MARKET, match_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Box<Account<'info, MarketState>>,

    #[account(
        init,
        payer = authority,
        seeds = [SEED_VERSION, SEED_VAULT, market.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = market,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Switchboard PullFeed; owner, queue, authority lock and job hash validated in handler
    pub oracle_feed: UncheckedAccount<'info>,

    /// CHECK: PDA that must own the feed; never signs
    #[account(seeds = [SEED_VERSION, SEED_FEED_LOCK], bump)]
    pub feed_lock: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeMarket>,
    match_id: u64,
    start_time: i64,
    end_time: i64,
    resolve_deadline: i64,
    team_a: [u8; 32],
    team_b: [u8; 32],
) -> Result<()> {
    require!(end_time > start_time, AichainError::InvalidTimeWindow);
    let clock = Clock::get()?;
    require!(start_time > clock.unix_timestamp, AichainError::InvalidTimeWindow);
    let window = resolve_deadline
        .checked_sub(end_time)
        .ok_or(error!(AichainError::InvalidResolveDeadline))?;
    require!(
        (MIN_RESOLVE_WINDOW..=MAX_RESOLVE_WINDOW).contains(&window),
        AichainError::InvalidResolveDeadline
    );

    let feed = PullFeedView::load(&ctx.accounts.oracle_feed.to_account_info())?;
    feed.verify_immutable(&ctx.accounts.feed_lock.key())?;

    let market = &mut ctx.accounts.market;
    market.match_id = match_id;
    market.authority = ctx.accounts.authority.key();
    market.usdc_mint = ctx.accounts.usdc_mint.key();
    market.oracle_feed = ctx.accounts.oracle_feed.key();
    market.feed_hash = feed.feed_hash;
    market.start_time = start_time;
    market.end_time = end_time;
    market.resolve_deadline = resolve_deadline;
    market.pool_team_a = 0;
    market.pool_team_b = 0;
    market.status = MarketStatus::Open;
    market.winning_team = None;
    market.cancel_reason = CANCEL_NONE;
    market.team_a = team_a;
    market.team_b = team_b;
    market.total_yield_harvested = 0;
    market.locked_principal = 0;
    market.yield_shares = 0;
    market.payout_pool = 0;
    market.claimed_stake = 0;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.vault;

    emit!(MarketInitialized {
        match_id,
        market: market.key(),
        oracle_feed: market.oracle_feed,
        feed_hash: market.feed_hash,
        start_time,
        end_time,
        resolve_deadline,
    });

    Ok(())
}
