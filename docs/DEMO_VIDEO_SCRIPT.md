# FairOdds Demo Video Script (Colosseum)

- **Target duration:** 2:30 – 2:50 (hard cap under 3:00)
- **Environment:** production HTTPS, e.g. `https://fairodds1338.vercel.app` (devnet)
- **Language:** English UI + English voiceover
- **Tone:** Clear founder pitch — confident, precise, no hype that the product cannot show

Before recording, follow [DEMO_CHECKLIST.md](DEMO_CHECKLIST.md): funded Phantom on **devnet**, demo-USDC faucet, one open match with both pools, one season market (historical demo OK if labeled), a settled/claimable market or Explorer links from a real prior run, working Actions URL. Never show env files, key material, or terminal secrets.

---

## Scene breakdown

### Scene 1 — Hook (0:00 – 0:25)

**On screen**

1. Open `/` (English).
2. Brief pan: match board, category tabs if present, live pool cards — no fake odds on empty sides.
3. Optional: tap language toggle PL → EN to show bilingual UI, then stay on EN.

**Voiceover**

> Traditional sportsbooks take huge margins, can restrict winners, and leave locked stakes earning nothing. Order books struggle with thin liquidity on live sports.
>
> FairOdds is a pari-mutuel prediction protocol on Solana: shared pools, wallet-signed bets, and results pinned to immutable oracles — for football, esports, and developers.

---

### Scene 2 — Noncustodial bet + fair fee (0:25 – 1:05)

**On screen**

1. Connect Phantom (devnet).
2. Open an **open** match with both sides funded.
3. Stake e.g. `10` demo-USDC on one team → Confirm in wallet.
4. Show confirmation, pools updating, indicative odds changing.
5. Point to the **0.5% of positive profit** fee note (not a fee on stake or refunds).
6. If useful: briefly show an empty-side card (“waiting for counter-bets”) so odds stay honest.

**Voiceover**

> Bets are noncustodial. The API builds an unsigned transaction; your wallet signs. Funds sit in program-owned vaults — not in our hot wallet.
>
> You bet against the pool, not a bookmaker, so the protocol has no reason to ban winners. Settlement uses exact on-chain amounts. New match markets charge only half a percent of positive profit; principal and refunds stay fee-free. Empty sides never invent odds.

---

### Scene 3 — Season markets + dual feeds + demo park (1:05 – 1:45)

**On screen**

1. Go to `/seasons`, open a season (champion or top scorer).
2. Show participant table, **0% fee**, and **Historical demo** label if present.
3. Hover/scroll to pinned feed addresses (and Explorer links if on the detail page).
4. Mention Yield Park / park status as a **funded demo reserve** — do not show invented APY charts.

**Voiceover**

> Season markets — league champion or top scorer — charge zero protocol fee. Winners share the full principal pool.
>
> Every deposit parks immediately in Yield Park, our funded demonstration reserve on Solana. Surplus can go to treasury; this is not deployed production lending and not a guaranteed APY.
>
> Settlement requires two independent, immutable Switchboard feeds to agree on the mapped result after the season is final. If they disagree or data never arrives, the resolve deadline unlocks full refunds.

---

### Scene 4 — Blinks + developer / agent API (1:45 – 2:20)

**On screen**

1. Open `/blinks` and/or Dial / Actions client for  
   `https://YOUR_HOST/api/actions/market/{id}` (devnet cluster).
2. Show one-click team + amount flow (or GET Action metadata if live Dial is unavailable — be honest).
3. Cut to terminal or browser: `GET /api/v1/markets` JSON (pools, `poolUnits`, deadlines, oracle).
4. Optional 3–5s: `examples/bot/simple-bot.ts` preview — unsigned tx, local sign (`BOT_SEND` only if you will show a real confirm).

**Voiceover**

> Sports culture is social. FairOdds ships Solana Actions and Blinks so a fan can bet from a feed with the same on-chain rules.
>
> The same noncustodial surface powers bots and agents: public REST and agent endpoints return exact pool units and unsigned transactions. Keys never leave the client. A permissionless keeper crank locks, resolves, or refunds when deadlines hit.

---

### Scene 5 — Claim, safety, close (2:20 – 2:45)

**On screen**

1. Open a **resolved** (or refund) market → Claim / refund with wallet → Explorer tx.
2. Show disabled already-claimed state if available.
3. Quick mobile-width snap (home or match) if time allows.
4. End on brand + live HTTPS URL + public repo.

**Voiceover**

> When the market resolves, winners claim from the vault with a receipt-aware flow — losers and repeat claims stay blocked.
>
> FairOdds began with a second-place finish at HackYeah. Now we’re building in the open for Colosseum: transparent pools, pinned oracles, and developer-ready Actions on Solana. This recording is a live devnet prototype. Mainnet and production lending are the next, separately reviewed steps. Thanks for watching.

---

## Full voiceover (ElevenLabs / read-through)

Approx. **2:35–2:50** spoken at a steady pace. Cut Scene 4 bot shot first if you need time.

```text
Traditional sportsbooks take huge margins, can restrict winners, and leave locked stakes earning nothing. Order books struggle with thin liquidity on live sports.

FairOdds is a pari-mutuel prediction protocol on Solana: shared pools, wallet-signed bets, and results pinned to immutable oracles — for football, esports, and developers.

Bets are noncustodial. The API builds an unsigned transaction; your wallet signs. Funds sit in program-owned vaults — not in our hot wallet.

You bet against the pool, not a bookmaker, so the protocol has no reason to ban winners. Settlement uses exact on-chain amounts. New match markets charge only half a percent of positive profit; principal and refunds stay fee-free. Empty sides never invent odds.

Season markets — league champion or top scorer — charge zero protocol fee. Winners share the full principal pool.

Every deposit parks immediately in Yield Park, our funded demonstration reserve on Solana. Surplus can go to treasury; this is not deployed production lending and not a guaranteed APY.

Settlement requires two independent, immutable Switchboard feeds to agree on the mapped result after the season is final. If they disagree or data never arrives, the resolve deadline unlocks full refunds.

Sports culture is social. FairOdds ships Solana Actions and Blinks so a fan can bet from a feed with the same on-chain rules.

The same noncustodial surface powers bots and agents: public REST and agent endpoints return exact pool units and unsigned transactions. Keys never leave the client. A permissionless keeper crank locks, resolves, or refunds when deadlines hit.

When the market resolves, winners claim from the vault with a receipt-aware flow — losers and repeat claims stay blocked.

FairOdds began with a second-place finish at HackYeah. Now we’re building in the open for Colosseum: transparent pools, pinned oracles, and developer-ready Actions on Solana. This recording is a live devnet prototype. Mainnet and production lending are the next, separately reviewed steps. Thanks for watching.
```

---

## What this script is selling (keep on camera)

| Strength | How it appears |
|---|---|
| Pari-mutuel, no bookmaker ban incentive | Scene 2 VO + pools |
| Noncustodial unsigned txs | Wallet popup + API JSON |
| 0.5% profit-only match fee | Fee badge |
| Season 0% + full principal | `/seasons` |
| Dual immutable feeds + deadline refunds | Feed links / settle or refund |
| Yield Park as honest demo reserve | Park copy, no fake APY |
| Actions / Blinks + bot/agent API | `/blinks` + REST |
| Receipt-aware claim | Claim + Explorer |
| Team credibility | HackYeah → Colosseum close |

---

## Recording tips

1. Phantom on **devnet**; faucet for demo-USDC; enough SOL for fees.
2. Prefer a real bet → (pre-recorded or live) settle → claim chain; if oracle stalls, show the **refund deadline** path and Explorer — never a mocked success.
3. Use real Action path: `/api/actions/market/{id}` and `/actions.json` (not legacy query shapes).
4. Chrome/Brave, clean window; 100–110% zoom; capture 1080p.
5. If over 2:50 when spoken: drop the bot terminal cut and the PL/EN toggle; keep dual-feed + noncustodial lines.
)
