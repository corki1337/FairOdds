# STATUS — checklist projektu

Ostatnia aktualizacja: **2026-10-07**

Produkt: **FairOdds** — bukmacher na prawdziwych meczach (TheSportsDB + Switchboard).  
Programy on-chain nadal nazywają się `aichain` / `yield_park`.

Dokumentacja zgłoszenia: [`../README.md`](../README.md), [`DESIGN.md`](DESIGN.md), [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md), [`NARRACJA.md`](NARRACJA.md).

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

## Wiele źródeł + drugi feed (kod gotowy, devnet jeszcze nie)

- [x] Probe na żywo (`npm run sources:probe`): Bundesliga TheSportsDB ↔ OpenLigaDB 30/30 sparowane, 20/20 zgodnych wyników, oba joby zwracają ten sam diff z oracli Switchboard
- [x] `aichain`: `SecondaryOracle` PDA `["v2","oracle2",market]`, `attach_secondary_feed` (tylko pusty rynek przed startem), `resolve_market` wymaga identycznego diffu z obu feedów (`SourcesDisagree`); stare rynki bez PDA bez zmian; layout `MarketState` nietknięty
- [x] IDL (`scripts/patch-idl.ts`), `switchboard.ts`, `cranks.ts`, `common.ts`: tworzenie z drugim feedem, resolve z osobną tx dla update'u drugiego feedu
- [x] `scripts/sources/*`: TheSportsDB, OpenLigaDB, football-data, API-Football, PandaScore; parowanie po nazwach i kickoffie, konsensus bez głosowania większością
- [x] Katalog w runtime (`/api/fixtures` czyta plik, bez rebuildu); `sources`, `marketable`
- [x] `npm run keeper`: odświeżanie katalogu, auto-rynki, crank z blokadą przy sporze → `data/anomalies.json` → baner w UI
- [x] Testy: unit `aichain` **20/20** (host, `cargo test -p aichain --lib`), adaptery **11/11** (`npm run test:sources`); integracja +3 scenariusze (zgodne / rozbieżne → refund / attach po zakładzie i po starcie) — kompiluje się, **nie uruchomione** (brak `.so`)
- [ ] `cargo-build-sbf`, uruchomienie `tests/program-test` (13), upgrade `aichain` na devnet (`solana program extend` jeśli `.so` urósł), smoke z dwoma feedami na meczu Bundesligi — wymaga Solana CLI, ~20 GB wolnego, klucza authority `4W3P…qBQo` i `deploy-config.json`

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
npm run test:sources       # adaptery źródeł, parowanie, konsensus
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
npm run keeper             # albo zamiast powyższych: katalog + rynki + crank w jednej pętli
```

## Jeszcze po naszej stronie (nie blokuje demo)

- [ ] Publiczny hosting UI (Vercel) — nie jest już w path settlement
- [ ] Prywatny RPC (publiczny devnet 429)
- [ ] Dwa portfele Phantom na żywo
- [ ] `scripts/freeze-upgrade-authority.ts --yes-i-understand` — nieodwracalne, tylko za zgodą
- [ ] Publiczne repo / wideo ≤3 min
