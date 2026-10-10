use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Transfer};
use yield_park::cpi::accounts::{Deposit as YieldDeposit, Withdraw as YieldWithdraw};

use crate::errors::AichainError;
use crate::market_signer;
use crate::state::{MarketState, PRINCIPAL_DUST_TOLERANCE};

/// Deposit market vault USDC into yield_park via CPI. Market PDA is the owner.
#[allow(clippy::too_many_arguments)]
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
    market_signer!(market, id, bump, seeds);
    let signer = &[seeds];

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
#[allow(clippy::too_many_arguments)]
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
    market_signer!(market, id, bump, seeds);
    let signer = &[seeds];

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

pub struct SettleAccounts<'a, 'info> {
    pub market: &'a mut Box<Account<'info, MarketState>>,
    pub vault: &'a mut Box<Account<'info, TokenAccount>>,
    pub treasury: AccountInfo<'info>,
    pub park: AccountInfo<'info>,
    pub park_vault: AccountInfo<'info>,
    pub position: AccountInfo<'info>,
    pub yield_program: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

/// Pulls principal + yield back from yield_park (if locked), sends anything above the
/// bettors' total pool to the treasury and fixes `payout_pool`. Returns the yield sent.
pub fn settle_vault(a: SettleAccounts) -> Result<u64> {
    let shares = a.market.yield_shares;
    if shares > 0 {
        let before = a.vault.amount;
        withdraw_from_park(
            a.market,
            a.market.to_account_info(),
            a.yield_program.clone(),
            a.park.clone(),
            a.vault.to_account_info(),
            a.park_vault.clone(),
            a.position.clone(),
            a.token_program.clone(),
            shares,
        )?;
        a.vault.reload()?;
        let returned = a.vault.amount.saturating_sub(before);
        require!(
            returned.saturating_add(PRINCIPAL_DUST_TOLERANCE) >= a.market.locked_principal,
            AichainError::PrincipalShortfall
        );
        a.market.yield_shares = 0;
    }

    let total_pool = a.market.total_pool();
    if a.vault.amount < total_pool {
        let shortfall = total_pool - a.vault.amount;
        require!(shortfall <= PRINCIPAL_DUST_TOLERANCE, AichainError::PrincipalShortfall);
        market_signer!(a.market, id, bump, seeds);
        yield_park::cpi::cover_principal_dust(CpiContext::new_with_signer(a.yield_program.clone(), yield_park::cpi::accounts::CoverPrincipalDust {
            owner: a.market.to_account_info(), park: a.park.clone(), owner_ata: a.vault.to_account_info(), park_vault: a.park_vault.clone(), token_program: a.token_program.clone(),
        }, &[seeds]), shortfall)?;
        a.vault.reload()?;
    }
    let balance = a.vault.amount;
    require!(balance >= total_pool, AichainError::PrincipalShortfall);
    let surplus = balance.saturating_sub(total_pool);
    if surplus > 0 {
        market_signer!(a.market, id, bump, seeds);
        token::transfer(
            CpiContext::new_with_signer(
                a.token_program.clone(),
                Transfer {
                    from: a.vault.to_account_info(),
                    to: a.treasury.clone(),
                    authority: a.market.to_account_info(),
                },
                &[seeds],
            ),
            surplus,
        )?;
    }

    a.market.payout_pool = balance.min(total_pool);
    a.market.total_yield_harvested = surplus;
    Ok(surplus)
}
