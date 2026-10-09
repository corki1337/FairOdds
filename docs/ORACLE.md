# Oracle: TheSportsDB (+ OpenLigaDB) via Switchboard On-Demand

FairOdds does **not** host the result. Each market pins a Switchboard PullFeed whose job reads the public TheSportsDB event and reports the score difference. Where a second keyless source covers the match (today: Bundesliga via OpenLigaDB), the market also pins a **second, independent feed** and settles only when both report the same score difference.

## Trust model

1. **Feed creation** (admin or `scripts/create-from-fixture.ts` / `scripts/keeper.ts`):
   - `pullFeedInit` with a nested `subtractTask` job:
     `intHomeScore − intAwayScore` from
     `https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=<idEvent>`
   - `pullFeedSetConfigs` hands feed authority to the aichain PDA `["v2", "feed-lock"]`
   - `initialize_market` checks owner / queue / authority / `permit_write_by_authority = false` and stores `feed_hash`
2. **Optional second feed**, same frozen setup, job on
   `https://api.openligadb.de/getmatchdata/<matchID>`:
   `$[?(@.matchIsFinished == true)].matchResults[?(@.resultTypeID == 2)].pointsTeam1 − …pointsTeam2`
   (final regular-time result, empty until the match is marked finished).
   - `attach_secondary_feed(source = 1, source_ref = matchID)` creates the PDA
     `["v2", "oracle2", market]` storing the feed key and its `feed_hash`.
   - It is accepted only while `total_pool == 0` and before `start_time`, so nobody's stake ever
     changes settlement rules. Clients send it in the **same transaction** as `initialize_market`.
   - The second feed must differ from the primary in both address and job hash, and must be locked
     to `feed-lock`.
3. Nobody can sign for `feed-lock`, so jobs and queue stay frozen for the life of the market.
4. **Resolve** (`resolve_market`, permissionless) after `end_time` and before `resolve_deadline`:
   - same feed checks plus `feed_hash` equality
   - only submissions with timestamp ≥ `end_time`, at least `MIN_ORACLE_SAMPLES`, all equal
   - value is i128 × 1e18; it must be an integer score difference in `[-100, 100]`
   - the `secondary` PDA is always passed. If it exists, `secondary_feed` must be the pinned feed,
     passes the same checks, and its score difference must be **exactly** equal to the primary's
     (same winner with a different margin is `SourcesDisagree`). Missing or stale secondary data
     fails the transaction; it never falls back to the single source.
   - `diff > 0` → home (team A), `diff < 0` → away (team B), `diff == 0` → `CANCEL_DRAW` (refunds)
   - unfinished events return no value; Switchboard cannot push anything
   - a winning side with zero stake cancels (`CANCEL_NO_WINNERS`) instead of stranding the pool
5. After `resolve_deadline` anyone calls `cancel_expired` → full refunds. This is also what happens
   when the two sources never agree.

Markets created before the second feed existed have no `oracle2` PDA and resolve exactly as before.

Clients (`app/src/lib/cranks.ts`, `scripts/common.ts`) fetch a signed update from Crossbar
(`https://crossbar.switchboardlabs.xyz`). The secondary update goes in its **own transaction** first
(Switchboard secp256k1 verify references instruction 0, so two updates cannot share one tx), then the
primary update + `resolve_market`. Compute-budget instructions go **last**.

Jobs must be POSTed to Crossbar (`storeJobs`) before `pullFeedInit`; a local-only job hash 404s.

| | devnet | mainnet (`--features mainnet`) |
|---|---|---|
| Switchboard program | `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` | `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv` |
| Queue | `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` | `A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w` |

The PullFeed layout is vendored in `programs/aichain/src/switchboard.rs` and tested against a real
devnet account dump (`programs/aichain/tests/fixtures/pull_feed.bin`).
`npm run sources:probe` checks both jobs against live Switchboard oracles (`simulateJobs`).

## Result sources

On-chain settlement only ever uses keyless public sources (Switchboard oracles must be able to fetch
them). The other sources are used off-chain by the keeper to build the catalog and to hold a crank
when anything looks wrong. All keys are optional in `.env`; a source without a key is skipped.

| Source | Key | Limit (free) | Used for |
|---|---|---|---|
| TheSportsDB | none (`3`) | ~30 req/min, 429 on bursts | catalog spine, primary feed |
| OpenLigaDB | none | generous, German leagues | catalog link, **second feed** (Bundesliga) |
| football-data.org | `FOOTBALL_DATA_KEY` | 10 req/min, top competitions | off-chain vote |
| API-Football | `API_FOOTBALL_KEY` | 100 req/day (`API_FOOTBALL_DAILY`, default 90) | off-chain vote, linked via TheSportsDB `idAPIfootball` |
| PandaScore | `PANDASCORE_TOKEN` | 1000 req/h | esports listing and vote; unlinked rows are listed but not marketable |

Off-chain consensus (`scripts/sources/match.ts`): any `void` (postponed / cancelled / abandoned /
forfeit) or any differing final score is a **dispute**; pending, missing data and 429 are abstentions.
There is no majority vote. A dispute holds the crank and is written to `data/anomalies.json`, which the
market page shows as a warning. The on-chain rule above is the binding one; the keeper guard only stops
our own crank from submitting early.

## Catalog vs settlement

`app/src/data/fixtures.json` is only a listing (`npm run fixtures:fetch` or the keeper). It is read at
runtime by `/api/fixtures`, so refreshing it needs no rebuild. It does not publish a result for
betting. The oracles never call our server.

## Keeper

`npm run keeper` (or `--once`) needs the deploy authority keypair and `deploy-config.json`:

- refreshes the catalog every `KEEPER_CATALOG_HOURS` (6)
- keeps `KEEPER_MARKETS` (8) open marketable fixtures ahead of kickoff (at least 10 min lead),
  with the second feed when available
- every `KEEPER_CRANK_SECONDS` (30): lock started markets, cancel expired ones, and resolve finished
  ones within `RESOLVE_WINDOW_MINS` unless the off-chain sources dispute the result
