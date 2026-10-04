# Oracle: TheSportsDB via Switchboard On-Demand

FairOdds does **not** host the result. Each market pins a Switchboard PullFeed whose job reads the public TheSportsDB event and reports the score difference.

## Trust model

1. **Feed creation** (admin or `scripts/create-from-fixture.ts`) in one transaction:
   - `pullFeedInit` with a nested `subtractTask` job:
     `intHomeScore − intAwayScore` from
     `https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=<idEvent>`
   - `pullFeedSetConfigs` hands feed authority to the aichain PDA `["v2", "feed-lock"]`
   - `initialize_market` checks owner / queue / authority / `permit_write_by_authority = false` and stores `feed_hash`
2. Nobody can sign for `feed-lock`, so the job and queue stay frozen for the life of the market.
3. **Resolve** (`resolve_market`, permissionless) after `end_time` and before `resolve_deadline`:
   - same feed checks plus `feed_hash` equality
   - only submissions with timestamp ≥ `end_time`, at least `MIN_ORACLE_SAMPLES`, all equal
   - value is i128 × 1e18; it must be an integer score difference in `[-100, 100]`
   - `diff > 0` → home (team A), `diff < 0` → away (team B), `diff == 0` → `CANCEL_DRAW` (refunds)
   - unfinished events return no value; Switchboard cannot push anything
   - a winning side with zero stake cancels (`CANCEL_NO_WINNERS`) instead of stranding the pool
4. After `resolve_deadline` anyone calls `cancel_expired` → full refunds.

Clients (`app/src/lib/cranks.ts`, `scripts/resolve-crank.ts`) fetch a signed update from
Crossbar (`https://crossbar.switchboardlabs.xyz`) and send it in the same transaction as `resolve_market`.
Compute-budget instructions go **last** (Switchboard secp256k1 verify references instruction 0).

Jobs must be POSTed to Crossbar (`storeJobs`) before `pullFeedInit`; a local-only job hash 404s.

| | devnet | mainnet (`--features mainnet`) |
|---|---|---|
| Switchboard program | `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` | `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv` |
| Queue | `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` | `A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w` |

The PullFeed layout is vendored in `programs/aichain/src/switchboard.rs` and tested against a real
devnet account dump (`programs/aichain/tests/fixtures/pull_feed.bin`).

## Catalog vs settlement

`app/src/data/fixtures.json` is only a listing (`npm run fixtures:fetch`). `/api/fixtures` does not
publish a result for betting. The oracles never call our server.
