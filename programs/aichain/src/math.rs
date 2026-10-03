use crate::errors::AichainError;
use anchor_lang::prelude::*;

/// Pari-mutuel payout with floor division favoring the protocol.
/// payout = floor(user_stake * total_pool / winning_pool)
pub fn pari_mutuel_payout(user_stake: u64, winning_pool: u64, total_pool: u64) -> Result<u64> {
    require!(winning_pool > 0, AichainError::EmptyWinningPool);
    let payout = (user_stake as u128)
        .checked_mul(total_pool as u128)
        .ok_or(error!(AichainError::MathOverflow))?
        .checked_div(winning_pool as u128)
        .ok_or(error!(AichainError::MathOverflow))?;
    Ok(payout as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payout_example() {
        // 100 stake on A, pool_a=300, pool_b=700, total=1000 -> 333
        assert_eq!(pari_mutuel_payout(100, 300, 1000).unwrap(), 333);
    }
}
