# FairOdds

Pari-mutuel bookmaker on **real sports matches**, settled on Solana.  
Superteam Poland — *Finance Without Intermediaries*.

Product name in the UI is **FairOdds**. On-chain crate names stay `aichain` / `yield_park` (fixed Program IDs).

## How it works

- Markets are real fixtures from [TheSportsDB](https://www.thesportsdb.com) (`idEvent` = on-chain `match_id`).
- Betting is **prematch only** — the market locks at kickoff.
- Odds come only from the pool split (no catalog / bookmaker line).
- Idle vault USDC sits in `yield_park` while the match is locked.
- Settlement: Switchboard On-Demand oracles fetch `lookupevent.php?id=<idEvent>` and report **home − away**. Sign of the difference is the winner; `0` cancels and refunds (`CANCEL_DRAW`).
- Our server is **not** in the settlement path. There is no `/api/oracle`.
- Demo-USDC faucet is on-chain (PDA mint authority, 24h cooldown).

See `docs/ORACLE.md`.

## Program IDs (devnet)

| Program | ID |
|---------|-----|
| `aichain` | `4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg` |
| `yield_park` | `6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS` |

Keep `target/deploy/*-keypair.json` when moving machines (gitignored).

## Repo layout

| Path | Role |
|------|------|
| `programs/aichain` | Markets, bets, resolve, claim, refund, faucet, treasury |
| `programs/yield_park` | Deposit / withdraw / APR share accounting |
| `app/` | Next.js UI + fixture catalog API |
| `tests/program-test` | Integration tests against built `.so` |
| `scripts/` | Devnet setup, markets, crank, smoke |
| `docs/` | Design, oracle, demo, handoff |

## Status (2026-10-04)

| Area | State |
|------|--------|
| Programs (score-diff + faucet + treasury) | Deployed to the same Program IDs |
| Integration tests | 10/10 |
| Catalog | 360 TheSportsDB fixtures (`npm run fixtures:fetch`) |
| UI | FairOdds, pool odds only, on-chain faucet |
| Smoke | Sevilla 1:3 Barcelona → winner claimed 400 USDC |

## Build & test

`anchor build` needs a working Agave install. On this machine the SBF binaries are built per crate (workspace build of `aichain` also compiles `yield-park` with `cpi` / `no-entrypoint` and would overwrite `yield_park.so` with a stub):

```bash
npm install
cd app && npm install && cd ..

cargo-build-sbf --arch v0 --manifest-path programs/aichain/Cargo.toml
cargo-build-sbf --arch v0 --manifest-path programs/yield_park/Cargo.toml
npm run idl:patch

npm test
```

`npm run test:integration` already builds both crates in that order.

## Deploy (devnet)

```bash
solana program deploy --program-id 4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg target/deploy/aichain.so
solana program deploy --program-id 6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS target/deploy/yield_park.so

ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node --transpile-only scripts/setup-devnet.ts

npm run markets:create
npm run markets:seed
npm run smoke:devnet
```

`setup-devnet` reuses the existing Global PDA when the programs are already initialized, then hands mint authority to the faucet PDA.

```bash
cd app && npm run dev
```

Phantom on **Devnet** → **Faucet** → bet on an open market. After the match, anyone can **Resolve** (Switchboard + TheSportsDB).

## Demo

See `docs/DEMO_CHECKLIST.md`. Short path:

1. Two wallets bet opposite sides of a real fixture
2. **Lock** at kickoff → CPI into `yield_park`
3. **Resolve** from TheSportsDB via Switchboard → winner **Claim**
4. Draw or missed deadline → full refund
5. Treasury = yield, not vig

## License

Hackathon / MIT-style for submission code. Briefs: `aichain.pdf`, `zasady.pdf`.
