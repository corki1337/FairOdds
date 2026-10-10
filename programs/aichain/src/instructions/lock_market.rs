use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token::{Token, TokenAccount};
use yield_park::program::YieldPark;
use yield_park::state::{Park, Position};

use crate::errors::AichainError;
use crate::events::MarketLocked;
use crate::state::{GlobalConfig, MarketState, MarketStatus, SEED_GLOBAL, SEED_MARKET, SEED_VAULT, SEED_VERSION};
use crate::yield_cpi;
use crate::state::{load_policy, SEED_POLICY, CANCEL_ONE_SIDED};

#[derive(Accounts)]
pub struct LockMarket<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(seeds = [SEED_VERSION, SEED_GLOBAL], bump = global.bump)]
    pub global: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [SEED_VERSION, SEED_MARKET, market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Open @ AichainError::MarketNotOpen,
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

    /// CHECK: init_if_needed inside yield_park CPI (seeds checked there)
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    pub yield_park_program: Program<'info, YieldPark>,
    pub system_program: Program<'info, System>,
    /// CHECK: mandatory derived policy; absence preserves legacy rules
    #[account(seeds = [SEED_VERSION, SEED_POLICY, market.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<LockMarket>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= ctx.accounts.market.start_time,
        AichainError::CannotLock
    );
    require!(
        clock.unix_timestamp < ctx.accounts.market.resolve_deadline,
        AichainError::ResolveWindowClosed
    );

    let policy = load_policy(&ctx.accounts.policy.to_account_info(), &ctx.accounts.market.key())?;
    if policy.map(|p| p.cancel_one_sided).unwrap_or(false)
        && (ctx.accounts.market.pool_team_a == 0 || ctx.accounts.market.pool_team_b == 0) {
        let market = &mut ctx.accounts.market;
        require!(ctx.accounts.vault.amount >= market.total_pool(), AichainError::PrincipalShortfall);
        market.status = MarketStatus::Cancelled;
        market.cancel_reason = CANCEL_ONE_SIDED;
        market.payout_pool = market.total_pool();
        emit!(crate::events::MarketResolved { market: market.key(), oracle_result: u8::MAX, winning_team: None, cancel_reason: CANCEL_ONE_SIDED, payout_pool: market.payout_pool, yield_harvested: 0 });
        return Ok(());
    }
    let amount = ctx.accounts.vault.amount;
    let market_key = ctx.accounts.market.key();

    if amount > 0 {
        yield_cpi::deposit_to_park(
            &ctx.accounts.market,
            ctx.accounts.market.to_account_info(),
            ctx.accounts.crank.to_account_info(),
            ctx.accounts.yield_park_program.to_account_info(),
            ctx.accounts.park.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.park_vault.to_account_info(),
            ctx.accounts.position.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            amount,
        )?;

        let position_data = ctx.accounts.position.try_borrow_data()?;
        let mut data_slice: &[u8] = &position_data;
        let position_state = Position::try_deserialize(&mut data_slice)?;
        let shares = position_state.shares;
        drop(position_data);

        let market = &mut ctx.accounts.market;
        market.locked_principal = amount;
        market.yield_shares = shares;
    }

    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Locked;

    emit!(MarketLocked {
        market: market_key,
        principal: market.locked_principal,
        shares: market.yield_shares,
    });

    Ok(())
}
