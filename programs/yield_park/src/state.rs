use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Park {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub total_shares: u64,
    pub total_deposits: u64,
    pub reserve_seeded: u64,
    pub apr_bps: u16,
    pub last_update_ts: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Park {
    pub const LEN: usize = 8 + Self::INIT_SPACE;

    /// Accrues simulated APR, never letting depositor claims exceed tokens actually
    /// held in the park vault (principal + seeded reserve).
    pub fn accrue(&mut self, now: i64, vault_balance: u64) {
        if self.total_deposits == 0 || now <= self.last_update_ts {
            self.last_update_ts = now.max(self.last_update_ts);
            return;
        }
        let elapsed = (now - self.last_update_ts) as u128;
        let interest = (self.total_deposits as u128)
            .saturating_mul(self.apr_bps as u128)
            .saturating_mul(elapsed)
            / (10_000u128 * 31_536_000u128);
        let interest = u64::try_from(interest).unwrap_or(u64::MAX);
        let accrued = self.total_deposits.saturating_add(interest);
        self.total_deposits = accrued.min(vault_balance.max(self.total_deposits));
        self.last_update_ts = now;
    }

    pub fn shares_for_amount(&self, amount: u64) -> Result<u64> {
        if self.total_shares == 0 || self.total_deposits == 0 {
            return Ok(amount);
        }
        let shares = (amount as u128)
            .checked_mul(self.total_shares as u128)
            .ok_or(error!(crate::errors::YieldError::MathOverflow))?
            .checked_div(self.total_deposits as u128)
            .ok_or(error!(crate::errors::YieldError::MathOverflow))?;
        Ok(shares as u64)
    }

    pub fn amount_for_shares(&self, shares: u64) -> Result<u64> {
        if self.total_shares == 0 {
            return Ok(0);
        }
        let amount = (shares as u128)
            .checked_mul(self.total_deposits as u128)
            .ok_or(error!(crate::errors::YieldError::MathOverflow))?
            .checked_div(self.total_shares as u128)
            .ok_or(error!(crate::errors::YieldError::MathOverflow))?;
        Ok(amount as u64)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub park: Pubkey,
    pub shares: u64,
    pub bump: u8,
}

impl Position {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn park(deposits: u64, shares: u64, apr_bps: u16) -> Park {
        Park {
            authority: Pubkey::default(),
            mint: Pubkey::default(),
            vault: Pubkey::default(),
            total_shares: shares,
            total_deposits: deposits,
            reserve_seeded: 0,
            apr_bps,
            last_update_ts: 0,
            bump: 0,
            vault_bump: 0,
        }
    }

    #[test]
    fn accrual_capped_by_vault_balance() {
        let mut p = park(1_000_000, 1_000_000, 10_000);
        // A full year at 100% APR would double deposits, but the vault only holds 1.2x.
        p.accrue(31_536_000, 1_200_000);
        assert_eq!(p.total_deposits, 1_200_000);
        let owed = p.amount_for_shares(p.total_shares).unwrap();
        assert!(owed <= 1_200_000);
    }

    #[test]
    fn accrual_uncapped_when_reserve_is_large() {
        let mut p = park(1_000_000, 1_000_000, 1_000);
        p.accrue(31_536_000, 10_000_000);
        assert_eq!(p.total_deposits, 1_100_000);
    }

    #[test]
    fn accrual_never_reduces_deposits() {
        let mut p = park(1_000_000, 1_000_000, 1_000);
        p.accrue(31_536_000, 500_000);
        assert_eq!(p.total_deposits, 1_000_000);
    }

    #[test]
    fn clock_going_backwards_is_ignored() {
        let mut p = park(1_000_000, 1_000_000, 1_000);
        p.last_update_ts = 100;
        p.accrue(50, 10_000_000);
        assert_eq!(p.last_update_ts, 100);
        assert_eq!(p.total_deposits, 1_000_000);
    }
}
