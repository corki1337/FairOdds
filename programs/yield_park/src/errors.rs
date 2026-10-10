use anchor_lang::prelude::*;

#[error_code]
pub enum YieldError {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Insufficient vault liquidity")]
    InsufficientLiquidity,
    #[msg("Invalid APR")]
    InvalidApr,
    #[msg("Invalid settlement PDA") ]
    InvalidSettlementOwner,
}
