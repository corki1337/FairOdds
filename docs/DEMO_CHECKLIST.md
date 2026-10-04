# FairOdds — Demo checklist

## Before stage

- [ ] Devnet SOL on admin + 2 demo wallets
- [ ] `app/.env.local` loaded (mint + global PDA)
- [ ] `cd app && npm run dev`; Phantom on **Devnet**
- [ ] Open prematch market with both sides funded (see `docs/STATUS.md`)
- [ ] Faucet button in the nav works (1000 demo-USDC / 24h)
- [ ] Explorer tabs ready (program id, last tx)

## Live path

1. Connect wallet → **Faucet** if empty
2. Wallet A bets home; Wallet B bets away → two signatures, pool odds move
3. At kickoff **Lock** → inner CPI to `yield_park`
4. After the match **Resolve** — Switchboard pulls TheSportsDB (`home − away`). No admin result.
5. Winner **Claim**. Draw / missed deadline → **Refund**
6. 30s: DESIGN slide — no bookmaker in settlement

## Failure modes to narrate

- Match not finished → oracle has no value, resolve fails (good)
- Wrong feed / hash → tx fails (good)
- Draw (`diff == 0`) → `CANCEL_DRAW`, 100% refund
- Resolve deadline passed → `cancel_expired`, 100% refund
