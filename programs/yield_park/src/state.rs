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

    pub fn accrue(&mut self, now: i64) {
        if self.total_deposits == 0 || now <= self.last_update_ts {
            self.last_update_ts = now;
            return;
        }
        let elapsed = (now - self.last_update_ts) as u128;
        let interest = (self.total_deposits as u128)
            .saturating_mul(self.apr_bps as u128)
            .saturating_mul(elapsed)
            / (10_000u128 * 31_536_000u128);
        self.total_deposits = self.total_deposits.saturating_add(interest as u64);
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
