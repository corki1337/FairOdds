# STATUS — checklist projektu

Ostatnia aktualizacja: **2026-10-03**  
Pełny opis przeniesienia: [`HANDOFF.md`](HANDOFF.md)

## Zrobione

- [x] Scaffold Anchor (aichain + yield_park) + Next.js + Anchor.toml (devnet IDs)
- [x] State PDA + `initialize_global` / `initialize_market` + `place_bet` + vault ATA + floor math
- [x] `claim_winnings` + `refund` + status machine
- [x] Oracle HTTP API + on-chain `OracleFeed` / `set_oracle_result` / `resolve_market`
- [x] `yield_park` deposit/withdraw/APR/shares + seed + CPI z lock/resolve
- [x] UI: lista rynków, bet/claim, admin create/lock/oracle/resolve
- [x] `scripts/setup-devnet.ts` + `demo-prepare.ts` + `docs/DEMO_CHECKLIST.md`
- [x] README, DESIGN, PITCH, ORACLE, slides
- [x] Lokalny build `.so` na Windows (D: + platform-tools v1.56 / sbfv2)

## Do zrobienia (na nowym PC)

- [ ] Skopiować repo **razem z** `target/deploy/*-keypair.json`
- [ ] Zainstalować toolchain (Rust, Solana, Anchor 0.30.1, Node)
- [ ] `anchor build` + skopiować świeże IDL → `app/src/lib/idl/`
- [ ] `anchor test` — domknąć na zielono
- [ ] `anchor deploy` (devnet)
- [ ] Odpalic `setup-devnet.ts` → `.env.local`
- [ ] Smoke test UI (bet → lock → oracle → resolve → claim)
- [ ] Pierwszy commit + remote (keypairów nie publikować)
- [ ] Submission extras: public repo, wideo ≤3 min, PDF ze slajdów

## Program IDs

```
aichain     CYizbVKeAyuiZUh9RBKhSw9m2o2CzFDxg95yLJWhJvUW
yield_park  H6wcSEryWtp2rmEu56qCi7zXMd6pmrAMH9cKHxDuM4ET
```
