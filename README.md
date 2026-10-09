# FairOdds Protocol


**Bookmaker Without the Bookie.** Trustless, zero-vig pari-mutuel prediction markets and yield-bearing settlement on Solana.

Built for the **Colosseum Hackathon (Crypto World's Fair)** — *DeFi Track* · In partnership with **Superteam**.

[![Solana Devnet](https://img.shields.io/badge/Solana-Devnet-14F195?logo=solana&logoColor=black)](https://explorer.solana.com/address/4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg?cluster=devnet)
[![Anchor Framework](https://img.shields.io/badge/Anchor-0.30.1-blue)](https://www.anchor-lang.com/)
[![Switchboard](https://img.shields.io/badge/Oracle-Switchboard_On--Demand-orange)](https://switchboard.xyz/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> *Polish documentation available at [`README.pl.md`](README.pl.md).*

---

## 💡 Executive Summary

Traditional sports betting and centralized prediction markets are fundamentally adversarial:
1. **Custodial Risk:** Bookmakers hold your deposit; withdrawals can be delayed, limited, or blocked.
2. **House Margins (Vig):** Operators extract 5–10% from every market, degrading player returns.
3. **Discretionary Resolution:** A centralized trading desk decides when to cancel bets, alter odds, or freeze accounts.

**FairOdds eliminates the bookmaker entirely.** Bettors interact with programmatic Program Derived Addresses (PDAs) on Solana:
* **Zero Vig:** 100% of the pool is distributed to winners. Odds are derived purely from peer-to-peer pool ratios: `Odds = Total Pool / Winning Pool`.
* **Yield-Bearing Escrow:** Between kickoff and settlement, idle pool capital is deposited via Cross-Program Invocation (CPI) into a DeFi lending module (`yield_park`), generating yield while the game is played.
* **Tamper-Proof Oracles:** Match results (`Home Score − Away Score`) are pulled directly by Switchboard On-Demand oracles from verified sports APIs (TheSportsDB & OpenLigaDB). Oracle authority is locked into an un-signable PDA (`feed-lock`), mathematically preventing admin manipulation.
* **Permissionless Lifecycle:** Resolving markets, claiming winnings, and claiming refunds are completely permissionless. If an oracle feed stalls or a match ends in a draw, players claim a 100% refund.

---

## ⚡ What Is Working Today (Verified on Solana Devnet)

FairOdds is **not a mockup or slide deck**. The complete on-chain pipeline is deployed and verifiable on Solana Devnet:

1. **On-Chain Faucet:** Anyone can mint 1,000 demo-USDC every 24 hours directly through a program PDA.
2. **Prematch Betting:** Bettors deposit USDC into binary PDA vaults (`Team A` vs `Team B`) before the kickoff timestamp (`Clock::get() < start_time`).
3. **Automated Capital Lock & Yield CPI:** At kickoff, betting locks and pooled funds are automatically routed into `yield_park` via CPI to accrue yield during the match.
4. **Oracle Settlement:** Post-match, **anyone** can trigger `resolve_market`. Switchboard On-Demand attests `intHomeScore − intAwayScore`.
5. **Permissionless Claims & Refunds:**
   - Winner Claims: Program calculates `floor(stake × total_pool / winning_pool)` and transfers USDC instantly.
   - Draws / Expired Deadlines: Triggers `cancel_expired` or `CANCEL_DRAW` granting an instant 100% refund.

### 🔍 Verified Live Smoke Test
- **Match:** Sevilla **1:3** Barcelona ([TheSportsDB Event #2506233](https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=2506233))
- **Payout:** Winner successfully claimed **400.00 USDC**
- **Solana Explorer:** [View Market PDA on Devnet](https://explorer.solana.com/address/CX6iYKDwPKMWyqqZs7ToVMMDxyhgXjAUHq6exzCjYYGq?cluster=devnet)
- **Active Markets:** 8 live prematch markets seeded with liquidity on Devnet (Arsenal vs Leeds, Dortmund vs Bremen, Lens vs Lyon, etc.).

---

## 🏛️ System Architecture

```
User A (Home) ──► [place_bet] ──┐
                                ▼
User B (Away) ──► [place_bet] ──► Market Vault PDA ──► [CPI Lock] ──► yield_park (DeFi Yield)
                                        │
                                        │ (Kickoff to Final Whistle)
                                        ▼
                         Switchboard On-Demand Oracle
                         (TheSportsDB + OpenLigaDB)
                                        │
                                        ▼
                     [resolve_market] / [cancel_expired]
                                        │
                                        ▼
                     [claim_winnings] / [refund] (Permissionless)
```

### On-Chain Programs & Devnet Addresses

| Component | Devnet Program ID / Address | Role |
|---|---|---|
| **`aichain`** | `4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg` | Core market state, bet escrow, oracle validation, claims & refunds |
| **`yield_park`** | `6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS` | Mock lending pool; accrues yield on idle escrowed capital via CPI |
| **demo-USDC** | `9QwGwtNdA6CWPzswHNM56B8uEtdxVY4ByiRi8aswNMvZ` | SPL token used for staking and payouts |
| **Global State PDA** | `3Bu6JBP3WZzsG5aaEYeQTzfB5GYaDrcghB2FBzz4iSVt` | Protocol parameter registry |
| **Feed-Lock PDA** | `825vzqeb9iWcWjM5rgL3f3mFQFb4kSp8ghz9zM1HRwDM` | Un-signable authority preventing oracle feed tampering |

---

## 🛡️ Trust & Security Model

| Threat / Risk | Traditional Bookmaker | FairOdds Solana Protocol |
|---|---|---|
| **Operator Exit Scam / Custody** | High (Funds in corporate bank/custody) | **Zero** — Funds locked in deterministic PDAs; admin has no withdrawal key |
| **Selective / Blocked Payouts** | High (Accounts frozen after winning) | **Zero** — Payout is purely on-chain math (`floor(stake × pool / win_pool)`) |
| **Late Bets (Post-Kickoff)** | Risk of operator accepting skewed lines | **Zero** — Solana `Clock::get()` strictly enforces `start_time` |
| **Falsified Scores** | High (Trading desk decides result) | **Zero** — Switchboard SGX enclave pulls signed API data; feed locked to PDA |
| **Disputed / Divergent Results** | Operator pockets losing stakes | **Protected** — Multi-source consensus engine triggers automatic 100% refund |

---

## 🚀 Key Hackathon Features

### 1. Dual-Feed Consensus Engine (v2)
To eliminate reliance on a single data source, FairOdds introduces multi-oracle consensus for Bundesliga fixtures:
* Connects **TheSportsDB** and **OpenLigaDB** via independent Switchboard jobs.
* Both feeds must report the **identical goal differential** (`intHomeScore − intAwayScore`).
* If sources disagree, the automated keeper halts resolution and the protocol unlocks 100% refunds after deadline.

### 2. Solana Actions & Blinks Ready
FairOdds supports the latest Solana standard:
* Users can view and place bets directly inside X/Twitter feeds via Solana Blinks (`/api/actions/market/[id]`).
* Full compatibility with Dialect and Phantom on Devnet (`dial.to/?cluster=devnet`).

### 3. Autonomous AI Bettors (Solana Agent Kit)
* Solves the liquidity chicken-and-egg problem in pari-mutuel markets.
* Dedicated agent API endpoints (`/api/agent/market/[id]`) allow autonomous AI bots to monitor pool disparities and inject liquidity into unbacked sides.

### 4. Beyond Sports: Parametric Settlement Engine
The underlying architecture (`programs/aichain`) is domain-agnostic:
* **Parametric Flight Insurance:** Flight cancelled in API → automatic instant compensation from escrow.
* **Milestone Escrow:** GitHub PR merge / deliverable confirmed → permissionless treasury release.

---

## 💻 Local Development & Testing

### Prerequisites
* Rust 1.75+
* Solana CLI 1.18+ (or Agave 2.0+)
* Anchor CLI 0.30.1
* Node.js 18+

### Setup

```bash
# Clone the repository
git clone https://github.com/corki1337/FairOdds.git
cd FairOdds

# Install root & frontend dependencies
npm install
cd app && npm install && cd ..
```

### Running Tests

```bash
# Run unit & integration tests
npm test

# Run multi-source oracle consensus tests
npm run test:sources
```

### Starting the Frontend

```bash
cd app
npm run dev
# Open http://localhost:3000 -> Connect Phantom on Solana Devnet
```

### Running the Keeper Bot

```bash
# Runs market sync, keeper crank, and anomaly detection loop
npm run keeper
```

---

## 📁 Repository Structure

```
FairOdds/
├── programs/
│   ├── aichain/            # Core market program (Anchor)
│   └── yield_park/         # Yield generation program (CPI target)
├── app/                    # Next.js 14 frontend, Blinks, Agent APIs
│   ├── src/app/            # App router pages (/markets/[id], /admin, etc.)
│   ├── src/lib/            # Solana & Switchboard integration libraries
│   └── public/             # Static assets, actions.json
├── scripts/
│   ├── sources/            # Multi-source API adapters (TheSportsDB, OpenLigaDB, etc.)
│   ├── keeper.ts           # Automated lifecycle keeper
│   └── cranks.ts           # Permissionless crank runners
├── docs/                   # Technical deep-dives (DESIGN, HOW_IT_WORKS, PLAN, STATUS)
├── presentation/           # 10-slide HTML pitch deck (Print to PDF)
└── tests/                  # Integration tests on compiled .so binaries
```

---

## 🗺️ Roadmap Post-Colosseum

1. **Mainnet DeFi Integration:** Replace `yield_park` with direct CPI into production **Kamino Finance / Marginfi** vaults.
2. **Multi-Outcome Markets (1X2):** Extend binary pools into full 3-way markets (Home / Draw / Away).
3. **Freeze Program Authority:** Execute `scripts/freeze-upgrade-authority.ts` following formal smart contract audits to achieve immutable decentralization.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
