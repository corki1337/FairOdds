use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("H6wcSEryWtp2rmEu56qCi7zXMd6pmrAMH9cKHxDuM4ET");

#[program]
pub mod yield_park {
    use super::*;

    pub fn initialize_park(ctx: Context<InitializePark>, apr_bps: u16) -> Result<()> {
        instructions::initialize_park::handler(ctx, apr_bps)
    }

    pub fn seed_reserve(ctx: Context<SeedReserve>, amount: u64) -> Result<()> {
        instructions::seed_reserve::handler(ctx, amount)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, shares)
    }
}
