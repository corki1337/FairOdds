use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::Park, errors::YieldError};
const SETTLEMENT_PROGRAM: Pubkey = solana_program::pubkey!("4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg");
/// Only a PDA owned by the settlement program can request this CPI. The bounded
/// top-up uses unallocated reserve and never changes other positions' share price.
#[derive(Accounts)]
pub struct CoverPrincipalDust<'info> {
    #[account(owner = SETTLEMENT_PROGRAM)] pub owner: Signer<'info>,
    #[account(seeds = [b"park", park.mint.as_ref()], bump = park.bump)] pub park: Account<'info, Park>,
    #[account(mut, constraint = owner_ata.owner == owner.key(), constraint = owner_ata.mint == park.mint)] pub owner_ata: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"park-vault", park.key().as_ref()], bump = park.vault_bump)] pub park_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
pub fn handler(ctx: Context<CoverPrincipalDust>, amount:u64)->Result<()> {
    let data = ctx.accounts.owner.try_borrow_data()?;
    require!(data.len() >= 16, YieldError::InvalidSettlementOwner);
    let market_disc = anchor_lang::solana_program::hash::hash(b"account:MarketState").to_bytes();
    let season_disc = anchor_lang::solana_program::hash::hash(b"account:SeasonMarket").to_bytes();
    let seed: &[u8] = if data[..8] == market_disc[..8] { b"market" } else if data[..8] == season_disc[..8] { b"season" } else { return err!(YieldError::InvalidSettlementOwner); };
    let expected = Pubkey::find_program_address(&[b"v2", seed, &data[8..16]], &SETTLEMENT_PROGRAM).0;
    require_keys_eq!(expected, ctx.accounts.owner.key(), YieldError::InvalidSettlementOwner);
    drop(data);
    require!(amount > 0 && amount <= 1000, YieldError::ZeroAmount);
    require!(ctx.accounts.park_vault.amount.checked_sub(amount).map(|v| v >= ctx.accounts.park.total_deposits).unwrap_or(false), YieldError::InsufficientLiquidity);
    let mint = ctx.accounts.park.mint; let bump = [ctx.accounts.park.bump]; let seeds: &[&[u8]] = &[b"park", mint.as_ref(), bump.as_ref()];
    token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer { from:ctx.accounts.park_vault.to_account_info(), to:ctx.accounts.owner_ata.to_account_info(), authority:ctx.accounts.park.to_account_info() }, &[seeds]), amount)
}
