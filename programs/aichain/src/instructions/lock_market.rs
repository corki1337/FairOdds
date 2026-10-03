use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token::{Token, TokenAccount};
use yield_park::program::YieldPark;
use yield_park::state::{Park, Position};

use crate::errors::AichainError;
use crate::events::MarketLocked;
use crate::state::{GlobalConfig, MarketState, MarketStatus};
use crate::yield_cpi;

#[derive(Accounts)]
pub struct LockMarket<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [b"market", market.match_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Open @ AichainError::MarketNotOpen,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"park", global.usdc_mint.as_ref()],
        bump = park.bump,
        seeds::program = yield_park_program.key(),
    )]
    pub park: Account<'info, Park>,

    #[account(
        mut,
        seeds = [b"park-vault", park.key().as_ref()],
        bump = park.vault_bump,
        seeds::program = yield_park_program.key(),
    )]
    pub park_vault: Account<'info, TokenAccount>,

    /// CHECK: init_if_needed inside yield_park CPI
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    pub yield_park_program: Program<'info, YieldPark>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<LockMarket>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= ctx.accounts.market.start_time,
        AichainError::CannotLock
    );

    let amount = ctx.accounts.vault.amount;
    let market_key = ctx.accounts.market.key();

    if amount > 0 {
        // Snapshot shares before deposit
        let shares_before = {
            // Position may not exist yet
            0u64
        };
        let _ = shares_before;

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

        // After CPI, read position shares from account data via try_deserialize
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
