# Pitch answers (Superteam judges)

## Where does the intermediary disappear?

In `programs/aichain/src/instructions/claim_winnings.rs` and `refund.rs`: payout/refund math and token transfers are enforced by the program. The vault authority is the market PDA — no admin signature is required to pay a rightful claim. Admin cannot change `winning_team` after resolve; only `set_oracle_result` (oracle authority) can finalize the feed **before** resolve, and resolve checks `market.oracle_feed`.

## What if a party disappears mid-flow?

- After `place_bet`, USDC is in the market vault (or in `yield_park` after lock).  
- User can wait for resolve/cancel and call `claim_winnings` / `refund` anytime — no counterparty needed.  
- If never resolved, funds remain recoverable once oracle finalizes (permissionless `resolve_market` crank).

## Permissions after deploy

| Action | Who |
|--------|-----|
| `initialize_global` / `initialize_market` | Global authority |
| `place_bet` / `claim` / `refund` | User |
| `lock_market` / `resolve_market` | Anyone (crank) |
| `set_oracle_result` | Oracle feed authority (set at market init; demo = admin) |
| Change past result | Impossible after resolve |

Recommend setting program upgrade authority to `None` for demo honesty, or disclose multisig.

## Why blockchain, not a database?

A database operator is still an intermediary: they can edit balances, censor claims, or go offline with custody. Here settlement rules and custody are on Solana; explorers prove every stake and payout.

## If we had another week

1. Wire Switchboard On-Demand managed updates end-to-end (job already designed against `/api/oracle/[id]`).  
2. Replace demo HTTP result with HLTV / sports API.  
3. Optional Kamino CPI behind the same yield adapter interface.  
4. Multi-outcome markets + mobile polish.
