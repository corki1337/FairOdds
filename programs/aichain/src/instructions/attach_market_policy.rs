use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::AichainError;
#[derive(Accounts)]
pub struct AttachMarketPolicy<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(seeds = [SEED_VERSION, SEED_GLOBAL], bump = global.bump, has_one = authority)]
    pub global: Account<'info, GlobalConfig>,
    #[account(seeds = [SEED_VERSION, SEED_MARKET, market.match_id.to_le_bytes().as_ref()], bump = market.bump, has_one = authority)]
    pub market: Account<'info, MarketState>,
    #[account(init, payer = authority, space = MarketPolicy::LEN, seeds = [SEED_VERSION, SEED_POLICY, market.key().as_ref()], bump)]
    pub policy: Account<'info, MarketPolicy>,
    pub system_program: Program<'info, System>,
}
pub fn handler(ctx: Context<AttachMarketPolicy>) -> Result<()> {
    let m = &ctx.accounts.market;
    require!(m.status == MarketStatus::Open && m.total_pool() == 0 && Clock::get()?.unix_timestamp < m.start_time, AichainError::MarketHasBets);
    let p = &mut ctx.accounts.policy;
    p.market = m.key(); p.fee_bps = 50; p.cancel_one_sided = true; p.bump = ctx.bumps.policy;
    Ok(())
}
