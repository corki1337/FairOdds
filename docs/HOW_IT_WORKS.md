# Co się dzieje — od kliknięcia do USDC

Dokument dla filmu, slajdów i jurora, który otworzy repo. Wszystko poniżej **jest w kodzie**, o ile nie jest oznaczone jako wizja.

## Aktorzy

| Kto | Co może |
|-----|---------|
| Gracz | Faucet, zakład, claim, refund. Podpisuje własnym portfelem. |
| Ktokolwiek (crank) | Lock, resolve, cancel_expired, harvest (kurz). |
| Admin (authority Global) | Tworzy rynek, zdejmuje treasury (tylko yield). **Nie** ustala wyniku, **nie** rusza vaultu rynku. |
| Switchboard oracles | Podpisują wartość `home − away` po meczu. |
| Nasz serwer | Lista meczów. Zero w rozliczeniu. |

## Konta (PDA)

Prefiks wersji: `v2`.

| Konto | Seed | Po co |
|-------|------|--------|
| `GlobalConfig` | `["v2","global"]` | mint, authority, park, treasury |
| `MarketState` | `["v2","market", match_id]` | pulę, czasy, feed, status, hash joba |
| Vault rynku | `["v2","vault", market]` | USDC stawek; authority = market |
| `UserBetReceipt` | `["v2","receipt", market, user]` | strona, stawka, claimed |
| `feed-lock` | `["v2","feed-lock"]` | owner feedu; **nigdy nie podpisuje** |
| mint-auth | `["v2","mint-auth"]` | faucet |
| `FaucetReceipt` | `["v2","faucet", user]` | cooldown 24h |
| Treasury | `["v2","treasury", global]` | yield + dust |
| Park / park-vault / position | w `yield_park` | idle capital w locku |

`match_id` = `idEvent` TheSportsDB. Ten sam numer jest w URL joba oracle.

## Status rynku

`Open → Locked → Resolved | Cancelled`

- **Open** — można obstawiać, dopóki `now < start_time`.
- **Locked** — po kickoffie; pula w yield.
- **Resolved** — jest zwycięzca, claim.
- **Cancelled** — remis, pusta pula zwycięzców, albo minął deadline. Refund 1:1.

Powody anulowania: `CANCEL_NO_WINNERS` (2), `CANCEL_EXPIRED` (3), `CANCEL_DRAW` (4).

## Instrukcje — kolejność życia rynku

### 1. `initialize_global` (raz)

Admin podpina mint i `yield_park`. Potem mint authority idzie do PDA (`setup-devnet`). Od tej pory nowy USDC powstaje tylko przez `faucet_mint`.

### 2. `initialize_market`

W **jednej** transakcji z initem feedu Switchboard:

1. Job: GET TheSportsDB `lookupevent.php?id=<idEvent>`, `subtractTask` home − away.
2. Authority feedu → `feed-lock`.
3. Program sprawdza: owner = Switchboard, kolejka, authority = lock, `permit_write_by_authority = false`.
4. Zapisuje `oracle_feed` + `feed_hash`. Tego nie da się później podmienić instrukcją.

Admin wybiera *który mecz* i *okno czasu*. Nie wybiera wyniku.

### 3. `faucet_mint`

Permissionless. 1000 demo-USDC, cooldown 24h, ATA tworzona przy okazji.

### 4. `place_bet(amount, team)`

- `amount >= 1 USDC`, `team ∈ {0,1}`
- `Clock < start_time` i status `Open`
- transfer user → vault
- receipt: pierwsza stawka ustala stronę; dokładać można tylko na tę samą

Kurs na UI to nie katalog. To `całkowita_pula / pula_strony`.

### 5. `lock_market` (permissionless, po `start_time`)

CPI `yield_park.deposit`: vault → park. Rynek pamięta `locked_principal` i share’y. Od tej pory obstawianie jest zamknięte (i tak `place_bet` by padł na czasie).

### 6. `resolve_market` (permissionless, `end_time ≤ now < resolve_deadline`)

Klient (UI albo `scripts/resolve-crank.ts`) najpierw prosi Crossbar o podpisany update, **w tej samej transakcji** woła program.

Program:

1. ten sam feed, ten sam `feed_hash`, lock nadal ownerem
2. tylko próbki z timestamp ≥ `end_time`, zgodne, minimum próbek
3. wartość całkowita w `[-100, 100] × 1e18`
4. `diff > 0` → A (gospodarze), `< 0` → B, `== 0` → cancel + draw
5. wyciąga kapitał z parku; yield ponad principal → treasury
6. jeśli pula zwycięzców = 0 → cancel, nie więzi kasy

Niedokończony mecz = puste pole w TheSportsDB = oracle nie ma wartości = resolve pada. To jest *dobrze*.

### 7. `claim_winnings` / `refund`

Claim: jesteś na wygranej stronie, jeszcze nie brałeś. Transfer vault → ATA użytkownika, podpisuje **market PDA**, nie admin.

Refund: rynek `Cancelled`, ta sama matematyka z `eligible_pool = cała pula` → dostajesz swoją stawkę.

Nie ma limitu czasu. Druga strona nie musi być online.

### 8. `cancel_expired`

Jeśli nikt nie zdołał zrobić poprawnego resolve przed `resolve_deadline` — ktokolwiek zamyka i wszyscy refundują. Liveness bez nas.

### 9. `harvest_to_treasury` / `withdraw_treasury`

Harvest: kurz zaokrągleń, dopiero gdy `claimed_stake` pokrywa wszystkich uprawnionych.

Withdraw: tylko authority, tylko konto treasury. Komentarz w kodzie i constraint seedów: vaultów nie ma na liście kont.

## Skąd UI wie, co pokazać

- Rynki: `program.account.marketState.all` (działa bez walleta — read-only).
- Katalog: `GET /api/fixtures` z `fixtures.json` — nazwy, ligi, godziny. **Bez kursu operatorskiego, bez wyniku do obstawiania.**
- Resolve na stronie rynku: `app/src/lib/cranks.ts` → Switchboard + `resolve_market`.

## Devnet — konkretne adresy do filmu

| Rzecz | Adres / link |
|-------|----------------|
| Program | `4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg` |
| Smoke rynek Sevilla–Barca | https://explorer.solana.com/address/CX6iYKDwPKMWyqqZs7ToVMMDxyhgXjAUHq6exzCjYYGq?cluster=devnet |
| Feed tego rynku | https://explorer.solana.com/address/GabRgxW1RKNC7PASj2Wv9RxXxGK87uao74KD4R586nSz?cluster=devnet |
| Wynik w API | https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=2506233 |

Otwórz TheSportsDB w drugiej karcie: `intHomeScore=1`, `intAwayScore=3`, diff = −2 → goście. Tak program zobaczył Barcelonę.

---

## Automatyzacja — Keeper & Serverless Cron

Cykl życia rynków (lock po kickoffie, resolve po meczu, cancel po deadline) jest w 100% permissionless i może być obsługiwany na dwa sposoby:

1. **Lokalny / Dedykowany Bot (`scripts/keeper.ts`):**
   * Uruchamiany przez `npm run keeper`.
   * Działa w nieskończonej pętli, monitoruje rynki i wysyła transakcje.
2. **Serverless Cron na Vercelu (`/api/cron/keeper`):**
   * Endpoint Next.js: `GET /api/cron/keeper` (skonfigurowany w `vercel.json` i kompatybilny z `cron-job.org`).
   * Zmienne środowiskowe:
     * `KEEPER_PRIVATE_KEY` — klucz prywatny (tablica bajtów JSON lub Base58) portfela opłacającego gaz transakcji devnet.
     * `CRON_SECRET` — opcjonalny token zabezpieczający endpoint przed niepowołanym wywołaniem (`Authorization: Bearer <token>`).
   * Automatycznie sprawdza wszystkie otwarte i zablokowane rynki, wykonując odpowiednie przejścia stanów on-chain.

