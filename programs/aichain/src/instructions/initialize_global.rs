use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::{GlobalConfig, SEED_GLOBAL, SEED_TREASURY, SEED_VERSION};

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = GlobalConfig::LEN,
        seeds = [SEED_VERSION, SEED_GLOBAL],
        bump
    )]
    pub global: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = authority,
        seeds = [SEED_VERSION, SEED_TREASURY, global.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = global,
    )]
    pub treasury: Account<'info, TokenAccount>,

    /// CHECK: must be the yield_park program this build was compiled against
    #[account(address = yield_park::ID)]
    pub yield_park_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeGlobal>, _yield_park: Pubkey) -> Result<()> {
    let global = &mut ctx.accounts.global;
    global.authority = ctx.accounts.authority.key();
    global.usdc_mint = ctx.accounts.usdc_mint.key();
    global.treasury = ctx.accounts.treasury.key();
    global.yield_park = ctx.accounts.yield_park_program.key();
    global.bump = ctx.bumps.global;
    Ok(())
}
