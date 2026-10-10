# FairOdds developer API

Devnet only. Demo-USDC has no monetary value. All monetary amounts are **decimal strings** with at most six fractional digits; the minimum stake is `"1"`. Exact integer amounts in API responses use string fields ending in `Units`. The API accepts public keys and returns unsigned transactions. Signing keys stay in your wallet or bot process.

## Markets

- `GET /api/v1/markets?status=open&limit=20&offset=0` returns `{ markets, total, limit, offset, cluster }`. Limit 1–100. Status: `open`, `locked`, `resolved`, `cancelled`. An open account can already have passed its kickoff; check `startTime` before betting.
- `GET /api/v1/markets/{id}` returns one canonical v2 match: teams, pools, `poolUnits`, `odds`, timestamps, fee basis points, vault, pinned oracle addresses/hash. Odds are `null` if either side is empty; `balanceNeeded` is the difference between pools.
- `POST /api/v1/markets/{id}/bet` body `{ "wallet": "PUBLIC_KEY", "side": 0, "amount": "10.25" }` returns `transaction` (base64 legacy Solana transaction), `blockhash`, `lastValidBlockHeight`, `cluster`, `message`.
- `GET /api/v1/seasons` lists created on-chain seasons. `GET /api/v1/seasons/catalog` lists reviewed manifests awaiting creation. `GET /api/v1/seasons/{id}` describes participant pools. `GET /api/v1/seasons/{id}/manifest` returns the oracle manifest. `POST /api/v1/seasons/{id}/bet` uses the same body, with `side` equal to a participant's zero-based index.
- `/api/agent/market/{id}` provides the match read model; POST accepts `{ "userPubkey": "PUBLIC_KEY", "team": 0, "amount": "10" }`. Compatible with an agent tool or a plain HTTP client; no dependency on an LLM framework.

```bash
curl "$FAIRODDS_URL/api/v1/markets?status=open&limit=20"
curl -X POST "$FAIRODDS_URL/api/v1/markets/123/bet" \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"YOUR_PUBLIC_KEY","side":0,"amount":"10"}'
```

Verify the returned program IDs, canonical account addresses, instruction amount/side and fee payer before signing. Submit to a devnet RPC, confirm using the returned expiry, and request a fresh transaction if the blockhash expires. On-chain checks remain authoritative when a market changes between preparation and signing. Amounts are not JavaScript floating point numbers.

## Errors and limits

JSON errors include a stable code and message. Invalid input is 400, missing market 404, cutoff/receipt conflict 409, oversized request 413, throttling 429, unavailable network/store 503. Bodies are limited to 4 KiB. The default limit is 60 requests/minute per forwarded client address; Redis makes it shared across instances. Without Redis the bounded local limiter is per instance. Hosting must overwrite forwarded headers at its trusted edge. Public CORS allows browser clients; the keeper endpoint is authenticated separately.

## Starter bot

`examples/bot/simple-bot.ts` finds an open market with an empty side and prepares one fixed-budget bet. Node 24, root `npm ci --legacy-peer-deps`, local funded devnet wallet, demo-USDC from the UI faucet. Configure `BOT_WALLET_PATH`, `FAIRODDS_URL`, `BOT_STAKE`; run `npm run bot`. It previews by default. Set `BOT_SEND=1` to sign and send. Treat the API origin as trusted and review the transaction checks before expanding this demo strategy.

## Solana Actions / Blinks

`GET /api/actions/market/{id}` describes both teams and an amount parameter. POST accepts `{ "account": "PUBLIC_KEY", "data": { "team": 0, "amount": "10" } }` or `?team=0&amount=10`. Metadata links supply query parameters automatically. Action transactions include a public FairOdds memo alongside ATA creation and the bet instruction. `/actions.json` maps shareable `/markets/*` URLs to actions. Responses and OPTIONS include public CORS and devnet `X-Blockchain-Ids` / action-version headers. A live Dialect/Blink-client test requires the deployed HTTPS URL and a funded devnet wallet; local route validation does not substitute for that test.
