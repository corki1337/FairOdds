# Aichain

Pari-mutuel prediction pools on **Solana** with idle-capital yield.  
Superteam Poland — *Finance Without Intermediaries*.

> **Przenosisz projekt na inny PC?** Zacznij od **[`docs/HANDOFF.md`](docs/HANDOFF.md)** — status, keypairy, TODO, setup od zera.

## What it is

- Binary markets (Team A vs Team B), e.g. **NaVi vs FaZe**
- Shared pool payouts (no bookmaker margin)
- On lock, vault USDC moves via **CPI** into `yield_park`
- On resolve, capital returns; surplus yield → platform treasury
- Settlement via **OracleFeed** PDA + HTTP `/api/oracle/[matchId]`

## Program IDs (fixed by deploy keypairs)

| Program | ID |
|---------|-----|
| `aichain` | `CYizbVKeAyuiZUh9RBKhSw9m2o2CzFDxg95yLJWhJvUW` |
| `yield_park` | `H6wcSEryWtp2rmEu56qCi7zXMd6pmrAMH9cKHxDuM4ET` |

**Keep** `target/deploy/*-keypair.json` when moving machines (folder is gitignored).

## Repo layout

| Path | Role |
|------|------|
| `programs/aichain` | Markets, bets, resolve, claim, refund |
| `programs/yield_park` | Deposit / withdraw / APR share accounting |
| `app/` | Next.js UI + oracle HTTP API |
| `tests/` | Anchor e2e tests |
| `scripts/` | Devnet setup + demo prepare |
| `docs/` | Design, pitch, oracle, demo, **handoff** |
| `presentation/` | Judge slides |

## Status (2026-10-03)

| Area | State |
|------|--------|
| On-chain programs (source) | Done |
| Compiled `.so` (last machine) | Done — rebuild on new PC |
| Frontend + oracle API | Done (uses stub IDL until `anchor build`) |
| Scripts / tests (source) | Done |
| Docs / slides | Done |
| `anchor test` green | **Not verified** |
| Devnet deploy + `setup-devnet` | **Not done** |
| Git remote / public repo | **Not done** |

## Prerequisites

- Rust (rustup), Solana CLI, **Anchor 0.30.1**, Node 18+
- Devnet SOL for deploy wallet

```bash
avm install 0.30.1 && avm use 0.30.1
solana config set --url devnet
```

## Build & test

```bash
yarn install          # repo root
cd app && npm install && cd ..

anchor build
cp target/idl/aichain.json app/src/lib/idl/
cp target/idl/yield_park.json app/src/lib/idl/

anchor test
```

### Windows note (only if system drive is full)

On the previous machine C: was full — caches lived on D: via `scripts/env-d-drive.ps1` and build used:

```powershell
cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\<name>\Cargo.toml
```

On a normal machine prefer plain `anchor build`. Details: `docs/HANDOFF.md` §5.

## Deploy (devnet)

```bash
anchor deploy --provider.cluster devnet

ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/setup-devnet.ts
```

Create `app/.env.local` from `deploy-config.json` (`NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_GLOBAL_PDA`, RPC).

```bash
cd app && npm run dev
```

Open `http://localhost:3000` — Phantom on **Devnet** → **Admin** to create a market.

## Demo (judges)

See `docs/DEMO_CHECKLIST.md`. Short path:

1. Two wallets bet on NaVi vs FaZe  
2. **Lock** → CPI into `yield_park`  
3. Oracle + **Resolve** → winner **Claim**  
4. Optional cancel (`result = 2`) → **Refund**  
5. Treasury = yield, not vig  

## Design (one-liner)

Vault PDA + permissionless claim + pari-mutuel + fixed oracle feed at init = no bookmaker intermediary. Details: `docs/DESIGN.md`, `docs/PITCH.md`.

## License

Hackathon / MIT-style for submission code. Briefs: `aichain.pdf`, `zasady.pdf`.
