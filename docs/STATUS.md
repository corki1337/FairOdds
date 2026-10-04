# STATUS — checklist projektu

Ostatnia aktualizacja: **2026-10-04**

Produkt: **FairOdds** — bukmacher na prawdziwych meczach (TheSportsDB + Switchboard).  
Programy on-chain nadal nazywają się `aichain` / `yield_park`.

## Zrobione

- [x] Scaffold Anchor + Next.js
- [x] PDA, bety, vault, claim/refund, yield_park CPI
- [x] v2: feed Switchboard pinned + `feed-lock` PDA; `set_oracle_result` usunięty
- [x] Semantyka wyniku: `intHomeScore − intAwayScore`; remis → `CANCEL_DRAW`
- [x] Faucet on-chain (mint authority = PDA), `withdraw_treasury` tylko dla authority
- [x] Katalog TheSportsDB (`fixtures.json`, 360 meczów); `/api/oracle` usunięte
- [x] UI FairOdds, kursy tylko z puli, faucet w nav
- [x] Jedna konfiguracja RPC + retry 429
- [x] Integracja `tests/program-test`: **10/10**
- [x] Upgrade obu programów na devnet (te same IDs), mint → PDA
- [x] 8 rynków prematch z płynnością po obu stronach
- [x] **Smoke OK**: Sevilla 1:3 Barcelona (`#2506233`) → claim 400 USDC

## Demo (devnet)

| Match ID | Event |
|----------|-------|
| 2494052 | Arsenal vs Leeds United |
| 2508371 | Borussia Dortmund vs Werder Bremen |
| 2489515 | Lens vs Lyon |
| 2506240 | Málaga vs Espanyol |
| 2501347 | West Ham vs QPR |
| 2513999 | Moreirense vs Gil Vicente |
| 2506246 | Rayo Vallecano vs Athletic Bilbao |
| 2489129 | PSV vs Heerenveen |
| 2506233 | Sevilla 1:3 Barcelona (smoke, rozliczony) |

## Testy

```powershell
npm test                   # yield_park unit + integration (buduje oba .so osobno)
npm run smoke:devnet       # e2e na skończonym meczu TheSportsDB
```

Workspace `cargo-build-sbf` nadpisuje `yield_park.so` stubem (`cpi` / `no-entrypoint`). Zawsze buduj `yield_park` jako ostatni.

## Program IDs

```
aichain     4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg
yield_park  6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS
```

## Deploy (skrót)

| Key | Value |
|-----|-------|
| demo-USDC mint | `9QwGwtNdA6CWPzswHNM56B8uEtdxVY4ByiRi8aswNMvZ` |
| Global PDA | `3Bu6JBP3WZzsG5aaEYeQTzfB5GYaDrcghB2FBzz4iSVt` |
| Mint authority PDA | `FP782A6boonPr6YHaP4F9LNH3ReZZY244KHXRESdfPCX` |
| Park | `BMYJWwqiuKSweGUzyhHZ6SCaZjax8ug7ngmU5S4bLiAE` |
| Admin | `4W3PzT8zz2kkKUccegRwFZNCNXL9ZwdwYZJVMzsZqBQo` |
| Fixture source | `https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id={idEvent}` |

```powershell
cd app; npm run dev
npm run markets:create
npm run markets:seed
npm run crank -- --loop
```

## Jeszcze po naszej stronie (nie blokuje demo)

- [ ] Publiczny hosting UI (Vercel) — nie jest już w path settlement
- [ ] Prywatny RPC (publiczny devnet 429)
- [ ] Dwa portfele Phantom na żywo
- [ ] `scripts/freeze-upgrade-authority.ts --yes-i-understand` — nieodwracalne, tylko za zgodą
- [ ] Publiczne repo / wideo ≤3 min
