use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::errors::AichainError;
use crate::state::{
    FaucetReceipt, GlobalConfig, FAUCET_AMOUNT, FAUCET_COOLDOWN, SEED_FAUCET, SEED_GLOBAL,
    SEED_MINT_AUTH, SEED_VERSION,
};

/// Demo-USDC tap. Permissionless so anyone can try the product with an empty wallet,
/// rate limited per wallet so the supply stays meaningful.
#[derive(Accounts)]
pub struct FaucetMint<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [SEED_VERSION, SEED_GLOBAL],
        bump = global.bump,
        has_one = usdc_mint,
    )]
    pub global: Account<'info, GlobalConfig>,

    #[account(mut, mint::authority = mint_authority)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: PDA holding the demo mint authority; signs nowhere else
    #[account(seeds = [SEED_VERSION, SEED_MINT_AUTH], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = FaucetReceipt::LEN,
        seeds = [SEED_VERSION, SEED_FAUCET, user.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, FaucetReceipt>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
    )]
    pub user_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<FaucetMint>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let receipt = &mut ctx.accounts.receipt;
    require!(
        receipt.user == Pubkey::default()
            || now.saturating_sub(receipt.last_claim) >= FAUCET_COOLDOWN,
        AichainError::FaucetCooldown
    );
    receipt.user = ctx.accounts.user.key();
    receipt.last_claim = now;
    receipt.bump = ctx.bumps.receipt;

    let bump = [ctx.bumps.mint_authority];
    let seeds: &[&[u8]] = &[SEED_VERSION, SEED_MINT_AUTH, bump.as_ref()];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            &[seeds],
        ),
        FAUCET_AMOUNT,
    )?;

    Ok(())
}
