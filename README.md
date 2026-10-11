# FairOdds


**Sports markets with shared pools on Solana devnet.** Bettors choose a side, sign with their own wallet and claim from program-owned vaults. Pool ratios determine indicative odds; Switchboard On-Demand supplies pinned sports results.

[Live demo](https://fairodds1338.vercel.app) · [Pitch](docs/PITCH.md) · [Polski](README.pl.md) · [Deployment](docs/DEPLOYMENT.md) · [Bot API](docs/BOT_API.md) · [Season markets](docs/SEASON_MARKETS.md) · [Verification status](docs/STATUS.md)

## Try it in one minute

1. Install Phantom, switch it to **devnet** and get a little devnet SOL for fees from [faucet.solana.com](https://faucet.solana.com).
2. Open an upcoming match, pick a side and stake. If the wallet has no demo-USDC, the daily faucet is added to the same transaction.
3. Share the challenge link with friends. It opens the match with the other side selected, so everyone plays into the same pool.
4. After the final whistle, the Switchboard result settles the market and winners claim from the program vault.

## Economics

New match markets charge **0.5% of positive profit**, collected when the winner claims. Stake and refunds are exempt. Existing markets without a policy account keep their original 0% fee. Example: 100 USDC stake, 400 gross payout, 1.50 fee, 398.50 net. Neither losing stakes nor gross payouts are charged 0.5%.

Season champion/top-scorer markets charge **0%**. Winners receive the full principal pool pro rata. Deposits enter `yield_park` immediately; its surplus goes to protocol treasury. `yield_park` is a **funded demonstration reserve**, not deployed Kamino or guaranteed real lending yield. All tokens are demo-USDC with no monetary value.

A new match with either side empty at kickoff cancels for full refunds. Draws, an empty winning pool and expired oracle deadlines also enable refunds. A wallet may top up its existing side, but cannot switch. Claim controls distinguish no receipt, losing receipt and already claimed funds.

## Architecture

- `programs/aichain`: match/season lifecycle, PDA vaults, receipts, checked payouts, immutable feed validation and permissionless settlement.
- `programs/yield_park`: share accounting, demo reserve and CPI deposits/withdrawals. Bounded rounding cover authenticates canonical settlement PDAs and preserves other deposits.
- `app`: Next.js 16, wallet adapters, English/Polish UI, mobile layouts, Solana Actions and noncustodial REST transactions.
- `scripts/sources`: TheSportsDB, OpenLigaDB, football-data, API-Football and PandaScore adapters, consensus, validated dates and reviewed season ID mapping.
- Keeper CLI and authenticated cron share settlement logic. Redis REST stores hosted catalog/manifests/anomalies, throttles requests and leases keeper runs; local development uses atomic files.

New match jobs require an explicit final status. Esports scores follow opponent IDs, not result-array order. Bundesliga matches can attach independent OpenLigaDB feeds. Seasons require **two pinned feeds** to agree on a mapped participant ordinal after the full double round-robin season. An oracle disagreement holds settlement until agreement or deadline refund. The permissionless program enforces pinned feeds; off-chain checks against extra providers are an additional keeper guard, not a global veto.

## Local development

Node 24, Cargo, Python 3, compatible Agave SBF toolchain. See deployment instructions for tested versions and setup.

```bash
npm ci --legacy-peer-deps
npm --prefix app ci --legacy-peer-deps
cp .env.example .env
cp app/.env.example app/.env.local
npm run test:rust
npm run test:sources
npm run test:api
npm run test:integration
npm --prefix app run build
npm --prefix app run dev
```

`npm run idl:generate` regenerates both checked-in IDLs from Anchor's Rust output. `npm run seasons:prepare -- champion 2024 --demo` prepares a historical season **after keys and reviewed aliases are configured**; the repository ships no invented manifest. Creating markets requires the existing GlobalConfig authority. Reading, betting and claiming use the user's own wallet.

## Integrations

Public `/api/v1/markets` and `/api/v1/seasons` expose exact pool units, deadlines and unsigned bet transactions. `/api/agent/market/{id}` supports agent tool calls. `/api/actions/market/{id}` and `/actions.json` provide devnet Actions/Blinks. The [starter bot](examples/bot/simple-bot.ts) prepares a fixed-budget counter-bet, verifies instructions, signs locally and confirms on devnet.

## Release state

Both programs are upgraded on devnet and the app is live at **[fairodds1338.vercel.app](https://fairodds1338.vercel.app)**. Local SBF tests cover legacy settlement, fees, one-sided refunds, seasons and reserve authorization. TypeScript, API/source tests and the production build run in CI; details are in [STATUS](docs/STATUS.md). Both season markets are labeled historical demos with a known result.

Dialect's hosted `dial.to` renderer is currently offline (503), and X only unfurls registered mainnet Actions. On devnet, open `/blinks?market={id}` to render and sign the same Action.

Existing addresses: [aichain](https://explorer.solana.com/address/4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg?cluster=devnet), [yield_park](https://explorer.solana.com/address/6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS?cluster=devnet). The prior Sevilla–Barcelona smoke test is recorded on [this legacy market](https://explorer.solana.com/address/CX6iYKDwPKMWyqqZs7ToVMMDxyhgXjAUHq6exzCjYYGq?cluster=devnet); it is not proof that the new release has been deployed.

This is an upgradeable devnet prototype. Next.js was upgraded and safe dependency fixes applied; legacy SDK transitive advisories remain, documented in the deployment guide. Rotate previously exposed provider keys before public release. Mainnet, production lending and freezing upgrade authority require separate review.
