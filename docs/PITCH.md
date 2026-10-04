# Pitch answers (Superteam judges)

## Where does the intermediary disappear?

In `programs/aichain/src/instructions/claim_winnings.rs` and `refund.rs`: payout/refund math and token transfers are enforced by the program. The vault authority is the market PDA — no admin signature is required to pay a rightful claim.

The admin also has no say in the result. Each market pins a Switchboard On-Demand PullFeed at creation (`initialize_market` stores the feed address and its job hash). In the same transaction the feed's authority is handed to the program's `feed-lock` PDA, which no instruction ever signs for, so the job (TheSportsDB `lookupevent.php`) can never be swapped and the authority can never write values directly. `resolve_market` is permissionless and only accepts oracle-signed submissions that landed after the match ended, all agreeing, decoded as the sign of `home − away`. See `programs/aichain/src/switchboard.rs`.

## What if a party disappears mid-flow?

- After `place_bet`, USDC is in the market vault (or in `yield_park` after lock).
- Anyone can `lock_market` after start and `resolve_market` after the match end — no admin needed.
- If no valid oracle result arrives before `resolve_deadline` (5 min – 30 days after end, fixed at creation), anyone can call `cancel_expired`: principal is pulled back from `yield_park` and every bettor gets a full refund.
- `claim_winnings` / `refund` have no time limit and need no counterparty.

## Permissions after deploy

| Action | Who |
|--------|-----|
| `initialize_global` / `initialize_market` | Global authority (cannot pick the result) |
| `place_bet` / `claim_winnings` / `refund` | User |
| `lock_market` / `resolve_market` / `cancel_expired` | Anyone (crank) |
| `harvest_to_treasury` | Anyone, only once every eligible bettor was paid (dust only) |
| Change result or move pool funds | Nobody |

Program upgrade authority: `scripts/freeze-upgrade-authority.ts` sets it to `None` once the demo build is final.

## Why blockchain, not a database?

A database operator is still an intermediary: they can edit balances, censor claims, or go offline with custody. Here settlement rules and custody are on Solana; explorers prove every stake and payout.

## If we had another week

1. More oracles per feed and a paid sports-data job if TheSportsDB free-tier rate limits become a problem.
2. Optional Kamino CPI behind the same yield adapter interface.
3. Multi-outcome markets + mobile polish.
