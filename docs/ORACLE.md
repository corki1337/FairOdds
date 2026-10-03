# Oracle + Switchboard path

## On-chain contract

- Each market creates an `OracleFeed` PDA (`seeds = ["oracle", match_id]`).
- `market.oracle_feed` is stored at init and **must** match on `resolve_market`.
- `set_oracle_result` may only be signed by the feed authority (demo: market admin).
- Resolve maps: `0` → Team A, `1` → Team B, `2` → Cancelled.

## Off-chain HTTP source (Switchboard job target)

`GET /api/oracle/[matchId]` returns `{ "result": 0|1|2 }`.

Admin `POST` sets the value before cranking resolve. In production, replace the store with a sports API and let Switchboard On-Demand oracles fetch + sign updates into the feed account (or a PullFeed / managed quote account whose pubkey is stored as `oracle_feed`).

## Why this satisfies the challenge

Settlement never trusts a raw frontend “result” argument. The program only reads the bound oracle account. The HTTP endpoint is the data plane Switchboard would call — not a backend that moves funds.
