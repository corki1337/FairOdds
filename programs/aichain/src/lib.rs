use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod switchboard;
pub mod yield_cpi;

use instructions::*;

declare_id!("4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg");

#[program]
pub mod aichain {
    use super::*;

    pub fn initialize_global(
        ctx: Context<InitializeGlobal>,
        yield_park: Pubkey,
    ) -> Result<()> {
        instructions::initialize_global::handler(ctx, yield_park)
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        match_id: u64,
        start_time: i64,
        end_time: i64,
        resolve_deadline: i64,
        team_a: [u8; 32],
        team_b: [u8; 32],
    ) -> Result<()> {
        instructions::initialize_market::handler(
            ctx,
            match_id,
            start_time,
            end_time,
            resolve_deadline,
            team_a,
            team_b,
        )
    }

    pub fn attach_secondary_feed(
        ctx: Context<AttachSecondaryFeed>,
        source: u8,
        source_ref: u64,
    ) -> Result<()> {
        instructions::attach_secondary_feed::handler(ctx, source, source_ref)
    }

    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, team: u8) -> Result<()> {
        instructions::place_bet::handler(ctx, amount, team)
    }

    pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
        instructions::lock_market::handler(ctx)
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        instructions::resolve_market::handler(ctx)
    }

    pub fn cancel_expired(ctx: Context<CancelExpired>) -> Result<()> {
        instructions::cancel_expired::handler(ctx)
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        instructions::claim_winnings::handler(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handler(ctx)
    }

    pub fn harvest_to_treasury(ctx: Context<HarvestToTreasury>) -> Result<()> {
        instructions::harvest_to_treasury::handler(ctx)
    }

    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        instructions::withdraw_treasury::handler(ctx, amount)
    }

    pub fn faucet_mint(ctx: Context<FaucetMint>) -> Result<()> {
        instructions::faucet_mint::handler(ctx)
    }
}
