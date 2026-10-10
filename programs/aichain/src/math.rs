use crate::errors::AichainError;
use anchor_lang::prelude::*;

/// Pro-rata share with floor division favoring the vault.
/// payout = floor(user_stake * distributable / eligible_pool)
///
/// Resolved: eligible_pool = winning side, distributable = market.payout_pool.
/// Cancelled: eligible_pool = total pool, distributable = market.payout_pool.
/// Since every eligible stake is <= eligible_pool, the sum of payouts never exceeds
/// `distributable`, so the vault cannot become insolvent.
pub fn pari_mutuel_payout(user_stake: u64, eligible_pool: u64, distributable: u64) -> Result<u64> {
    require!(eligible_pool > 0, AichainError::EmptyWinningPool);
    require!(user_stake <= eligible_pool, AichainError::MathOverflow);
    let payout = (user_stake as u128)
        .checked_mul(distributable as u128)
        .ok_or(error!(AichainError::MathOverflow))?
        .checked_div(eligible_pool as u128)
        .ok_or(error!(AichainError::MathOverflow))?;
    u64::try_from(payout).map_err(|_| error!(AichainError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payout_example() {
        // 100 stake on A, pool_a=300, pool_b=700, total=1000 -> 333
        assert_eq!(pari_mutuel_payout(100, 300, 1000).unwrap(), 333);
    }

    #[test]
    fn refund_is_exact_without_shortfall() {
        assert_eq!(pari_mutuel_payout(250, 1000, 1000).unwrap(), 250);
    }

    #[test]
    fn empty_pool_rejected() {
        assert!(pari_mutuel_payout(0, 0, 1000).is_err());
    }

    #[test]
    fn stake_above_pool_rejected() {
        assert!(pari_mutuel_payout(301, 300, 1000).is_err());
    }

    #[test]
    fn sum_of_payouts_never_exceeds_distributable() {
        let stakes = [1u64, 7, 13, 99, 1_000_003, 55_555_555, 3];
        let pool: u64 = stakes.iter().sum();
        for distributable in [pool, pool * 3 + 17, pool - 1, 1, 0] {
            let paid: u64 = stakes
                .iter()
                .map(|s| pari_mutuel_payout(*s, pool, distributable).unwrap())
                .sum();
            assert!(paid <= distributable);
            assert!(distributable - paid < stakes.len() as u64 + 1);
        }
    }

    #[test]
    fn large_values_do_not_overflow() {
        let max = u64::MAX / 2;
        assert_eq!(pari_mutuel_payout(max, max, max).unwrap(), max);
    }
}

/// Fee applies to positive net profit only, never principal or refunds.
pub fn profit_fee(gross: u64, stake: u64, bps: u16) -> Result<u64> {
    require!(bps <= 10_000, AichainError::MathOverflow);
    Ok(((gross.saturating_sub(stake) as u128) * bps as u128 / 10_000) as u64)
}
#[cfg(test)]
mod fee_tests {
    use super::*;
    #[test] fn only_positive_profit_is_taxed() {
        assert_eq!(profit_fee(400_000_000, 100_000_000, 50).unwrap(), 1_500_000);
        assert_eq!(profit_fee(100, 100, 50).unwrap(), 0);
        assert_eq!(profit_fee(99, 100, 50).unwrap(), 0);
        assert_eq!(profit_fee(u64::MAX, 0, 10_000).unwrap(), u64::MAX);
        assert!(profit_fee(100, 0, 10_001).is_err());
    }
}
