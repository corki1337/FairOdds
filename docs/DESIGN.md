# FairOdds implementation design

## Compatible match policy

The existing v2 `MarketState` layout is unchanged. `MarketPolicy` lives at `["policy", market]` and is attached by the GlobalConfig authority only while a market is empty and before kickoff. New clients initialize market + policy atomically. Its fixed 50 bps charge applies only to `max(grossPayout - stake, 0)`; fee arithmetic uses u128 and floors. A missing canonical policy represents legacy zero fee/no immediate one-sided cancellation. Lock and claim instructions require the canonical policy address even when uninitialized; clients must update with the program.

At lock, opted-in one-sided pools cancel directly without yield deposit. Otherwise principal parks until settlement. Refunds preserve principal; gross winner entitlement and fee + net transfer are atomic. Claimed bookkeeping tracks gross liabilities. Final eligible claims/harvest sweep rounding dust only after obligations are complete.

## Seasons

`SeasonMarket` and `SeasonReceipt` have independent seeds and layouts. Up to 32 names/pools are fixed at creation, kind indicates champion/scorer, and a visible historical-demo flag distinguishes known-result demonstrations. A wallet picks one ordinal and can only top up that ordinal before cutoff. Every stake deposits via CPI immediately. Two different immutable feed hashes and addresses are fixed with the season. Result 1..N maps to ordinal, 0 final tie, negative/pending invalid. Both feeds must agree with samples at/after end time. A tied/empty winner or expired deadline cancels. Payouts use full principal and zero fee; all actual surplus is treasury revenue.

## Demo reserve

`yield_park` is an explicitly funded reserve with share accounting. It does not execute Kamino lending. Settlement checks returned principal; a shortage exceeding 1,000 atomic units fails. Bounded smaller rounding is covered only from unallocated park-vault balance, leaving `park.total_deposits` covered. The cover caller must be a signing canonical aichain match/season PDA, with valid program owner, discriminator and ID-derived address. A system-created account merely owned by aichain cannot drain the reserve. Transfer, bookkeeping and CPI failures roll back atomically. Exhausted reserve never silently haircuts another depositor.

## Sources and ownership

New TheSportsDB jobs require `strStatus=FT`; new PandaScore jobs require finished/non-forfeit, matching scores by opponent IDs. Existing football feed hashes use original immutable jobs. Unsupported historical hashes cannot be silently replaced; keeper holds them for deadline refund. OpenLigaDB final scores require matchIsFinished and Endergebnis. TheSportsDB semantics are provider-specific; competitions with extra time require reviewed source/rule selection before real use.

Season jobs check full double round-robin team-game totals before ID translation. Only reviewed provider ID mappings are published. Unknown IDs wait rather than select a guessed winner. Scorer ties cancel; tournaments/playoffs need their own reviewed finality job. Credentials remain server environment variables, passed to the oracle execution request as overrides; stored jobs contain variable placeholders.

GlobalConfig authority controls creation and feed selection before acceptance of stakes. Immutable feed-lock authority prevents later job edits; upgrade authority still controls upgradeable program code. Sports providers and Switchboard remain trust dependencies. Off-chain extra-source dispute guards are not enforced against all permissionless callers of a single-feed match.

## API and hosting

Amounts are exact decimal strings -> u64 units. Builders validate key, side, cutoff and existing receipt, create the canonical ATA idempotently and return an unsigned transaction. On-chain checks cover races after building. Reader wallets cannot sign. Private RPC/provider/keeper keys never use NEXT_PUBLIC env names. Requests are capped at 4 KiB and 60/min/client; Redis shares counters between hosts.

Catalog, manifests and anomalies use Redis REST on serverless hosting; local writes use unique temporary files + atomic rename. Both keeper modes share lock/refetch/resolve/timeout decisions and season settlement. Cron authenticates Bearer tokens with timing-safe comparison and uses a Redis lease. Root CLI retains authority for creating fixtures; hosting keeper has a separate funded permissionless signer. Network retries rotate endpoints with finite timeouts.
