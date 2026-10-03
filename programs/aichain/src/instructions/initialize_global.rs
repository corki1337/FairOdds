use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::GlobalConfig;

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = GlobalConfig::LEN,
        seeds = [b"global"],
        bump
    )]
    pub global: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = authority,
        seeds = [b"treasury", global.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = global,
    )]
    pub treasury: Account<'info, TokenAccount>,

    /// CHECK: yield park program id stored for reference / future validation
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
