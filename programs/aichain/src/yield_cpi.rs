use anchor_lang::prelude::*;
use yield_park::cpi::accounts::{Deposit as YieldDeposit, Withdraw as YieldWithdraw};

use crate::errors::AichainError;
use crate::state::MarketState;

/// Deposit market vault USDC into yield_park via CPI. Market PDA is the owner.
pub fn deposit_to_park<'info>(
    market: &Account<'info, MarketState>,
    market_ai: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    yield_program: AccountInfo<'info>,
    park: AccountInfo<'info>,
    market_vault: AccountInfo<'info>,
    park_vault: AccountInfo<'info>,
    position: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, AichainError::ZeroAmount);
    let match_id_bytes = market.match_id.to_le_bytes();
    let seeds = &[
        b"market".as_ref(),
        match_id_bytes.as_ref(),
        &[market.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = YieldDeposit {
        owner: market_ai,
        payer,
        park,
        owner_ata: market_vault,
        park_vault,
        position,
        system_program,
        token_program,
    };
    let cpi_ctx = CpiContext::new_with_signer(yield_program, cpi_accounts, signer);
    yield_park::cpi::deposit(cpi_ctx, amount)
}

/// Withdraw shares from yield_park back to market vault.
pub fn withdraw_from_park<'info>(
    market: &Account<'info, MarketState>,
    market_ai: AccountInfo<'info>,
    yield_program: AccountInfo<'info>,
    park: AccountInfo<'info>,
    market_vault: AccountInfo<'info>,
    park_vault: AccountInfo<'info>,
    position: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    shares: u64,
) -> Result<()> {
    require!(shares > 0, AichainError::ZeroAmount);
    let match_id_bytes = market.match_id.to_le_bytes();
    let seeds = &[
        b"market".as_ref(),
        match_id_bytes.as_ref(),
        &[market.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = YieldWithdraw {
        owner: market_ai,
        park,
        owner_ata: market_vault,
        park_vault,
        position,
        token_program,
    };
    let cpi_ctx = CpiContext::new_with_signer(yield_program, cpi_accounts, signer);
    yield_park::cpi::withdraw(cpi_ctx, shares)
}
