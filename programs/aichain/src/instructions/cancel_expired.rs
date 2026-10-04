use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use yield_park::program::YieldPark;
use yield_park::state::Park;

use crate::errors::AichainError;
use crate::events::MarketResolved;
use crate::state::{
    GlobalConfig, MarketState, MarketStatus, CANCEL_EXPIRED, SEED_GLOBAL, SEED_MARKET,
    SEED_TREASURY, SEED_VAULT, SEED_VERSION,
};
use crate::yield_cpi::{settle_vault, SettleAccounts};

/// Liveness escape: if no valid oracle result arrived before `resolve_deadline`,
/// anyone can cancel and every bettor becomes refundable.
#[derive(Accounts)]
pub struct CancelExpired<'info> {
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
    )]
    pub market: Box<Account<'info, MarketState>>,

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

pub fn handler(ctx: Context<CancelExpired>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.market.resolve_deadline,
        AichainError::DeadlineNotReached
    );

    let market_key = ctx.accounts.market.key();
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
    market.status = MarketStatus::Cancelled;
    market.winning_team = None;
    market.cancel_reason = CANCEL_EXPIRED;

    emit!(MarketResolved {
        market: market_key,
        oracle_result: u8::MAX,
        winning_team: None,
        cancel_reason: CANCEL_EXPIRED,
        payout_pool: market.payout_pool,
        yield_harvested,
    });

    Ok(())
}
