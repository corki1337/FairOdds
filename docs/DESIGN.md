# Design rationale — Aichain

## Financial relationship redesigned

**Before:** Bettor ↔ Bookmaker ↔ Event outcome.  
The bookmaker is a trusted intermediary: custody of stakes, discretion over odds/payouts, unilateral risk of freeze or insolvency.

**After:** Bettor ↔ On-chain pool ↔ Oracle feed.  
Terms live in the `aichain` program. Neither party can rewrite the payout formula after betting. Custody is a PDA vault; idle capital is deposited into `yield_park` via CPI while the market is locked.

## Who the intermediary was

A licensed (or grey-market) bookmaker / prediction operator who:

1. Took custody of USDC-equivalent stakes  
2. Published odds (and could change them)  
3. Decided when/if to pay winners  

## What changes when they are removed

| Risk | Mitigation on-chain |
|------|---------------------|
| Operator absconds with pool | Funds in market vault / yield position PDAs |
| Selective payout | `claim_winnings` math is deterministic |
| Betting after kickoff | `Clock` vs `start_time` in `place_bet` |
| Fake result | `oracle_feed` pubkey bound at `initialize_market`; resolve rejects any other account |
| Match cancelled | Oracle result `2` → `Cancelled` → full `refund` |

Platform revenue is **yield on idle capital**, not a vig taken from winners (`payout = stake * total / winning_pool`, floor rounding).

## Compliance note (implementation potential)

This MVP is a **devnet demo** of mutual pools / prediction settlement. Production deployment requires jurisdiction-specific compliance (or a pivot of the same contracts to parametric insurance, milestone escrow, or B2B event settlement). The core program is domain-agnostic: only labels and oracle HTTP jobs change.

## Target user

Esports fans betting on match winners (demo: CS2 NaVi vs FaZe) who want transparent pool odds and automatic settlement.
