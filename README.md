# FairOdds

**Bukmacher bez bukmachera.** Prematch na prawdziwe mecze, pula wzajemna, rozliczenie na Solanie.

Superteam Poland Challenge — *Finance Without Intermediaries*.

> Osoba obstawiająca mecz nie musi ufać ani przeciwnikowi, ani operatorowi. Stawka leży w PDA, kurs wynika z podziału puli, wynik przychodzi z TheSportsDB przez Switchboard. Nasz serwer nie sędziuje.

| | |
|---|---|
| Produkt | FairOdds (UI) |
| Programy | `aichain` + `yield_park` |
| Sieć | Solana **devnet** |
| Demo live | `cd app && npm run dev` → Phantom na Devnet |
| Film / slajdy | [`docs/NARRACJA.md`](docs/NARRACJA.md) |
| Co się dzieje w kodzie | [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md) |
| Uzasadnienie projektowe | [`docs/DESIGN.md`](docs/DESIGN.md) |

---

## Dla kogo to budujemy

**Odbiorca (nazywamy go wprost):** osoby, które dziś obstawiają prawdziwe mecze — piłka, esport — i muszą zaufać bukmacherowi: że nie zmieni kursu po zakładzie, nie zniknie ze stawką i wypłaci wygraną.

To nie jest narzędzie dla deweloperów. Interfejs jest po polsku, ukrywa PDA i IDL. Phantom i explorer są tylko po to, żeby juror zobaczył transakcję na łańcuchu.

Drugi, świadomy odbiorca *po* hackathonie: operator, który chce ten sam program pod licencją, albo zespół budujący **ubezpieczenie parametryczne / escrow kamieni milowych** — ten sam wzorzec: pula, warunek, automatyczna wypłata.

---

## Jaka relacja, kto był pośrednikiem, co znika

Klasyczny zakład: **gracz ↔ bukmacher ↔ wynik meczu**.

Bukmacher robi trzy rzeczy, za które bierze prowizję i władzę:

1. **Trzyma kasę** — możesz nie dostać wypłaty.
2. **Ustala kurs** — może go ciąć, zamykać rynek, unieważniać kupon.
3. **Orzeka wynik** — jego trading desk decyduje, kto wygrał.

FairOdds rozdziela to na regułę, której nikt nie podpisuje ręcznie:

| Ryzyko u bukmachera | Reguła on-chain |
|---------------------|-----------------|
| Operator znika z pulą | USDC w vault PDA rynku (albo w `yield_park` po locku). Admin nie ma klucza do vaultów. |
| Selektywna wypłata | `claim_winnings` — `floor(stawka × pula / pula_zwycięzców)`. Bez podpisu operatora. |
| Zakład po gwizdku | `Clock` vs `start_time` w `place_bet`. |
| Podmieniony wynik | Feed Switchboard przypięty przy tworzeniu rynku; authority na PDA `feed-lock`, której nikt nie podpisuje. Job = TheSportsDB `lookupevent.php`. |
| Remis / brak wyniku | `diff == 0` albo minął `resolve_deadline` → zwrot 100% stawek. |

Platforma nie żyje z vig. Żyje z **yieldu na bezczynnym kapitale** między kickoffem a rozliczeniem.

Szczegóły: [`docs/DESIGN.md`](docs/DESIGN.md). Odpowiedzi na pytania jurorów: [`docs/PITCH.md`](docs/PITCH.md).

---

## Co działa dziś (devnet, nie mockup)

Pełna ścieżka, którą można kliknąć i pokazać na explorerze:

1. Phantom → **Faucet** (1000 demo-USDC / 24h, mint authority = PDA programu).
2. Zakład na gospodarzach albo gościach **przed kickoffem**.
3. Od startu meczu nikt już nie obstawia. **Lock** wrzuca pulę do `yield_park` (CPI).
4. Po meczu **ktokolwiek** woła Resolve: Switchboard ściąga `intHomeScore − intAwayScore`.
5. Znak różnicy = zwycięzca. `0` = remis = zwrot. Zwycięzca **Claim**. Przegrany nie może.

To nie jest nagranie. Smoke na żywym meczu:

- Sevilla **1:3** Barcelona (`idEvent` `2506233`)
- zwycięzca dostał **400 USDC**
- [rynek na explorerze](https://explorer.solana.com/address/CX6iYKDwPKMWyqqZs7ToVMMDxyhgXjAUHq6exzCjYYGq?cluster=devnet)
- źródło: [TheSportsDB lookupevent](https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=2506233)

Osiem otwartych rynków prematch (Arsenal–Leeds, Dortmund–Bremen, Lens–Lyon, …) ma pulę po obu stronach.

Testy integracyjne programu: **10/10**.

---

## Jak to działa w jednym akapicie

Rynek = jeden prawdziwy mecz. `match_id` = `idEvent` z TheSportsDB. Katalog (`/api/fixtures`) tylko listuje — **nie podaje wyniku do rozliczenia**. Każdy rynek dostaje własny feed Switchboard z jobem „home minus away”. Authority feedu idzie do PDA, której program nigdy nie używa jako sygnatury. Po końcu meczu crank prosi Crossbar o podpisane update, program sprawdza hash joba, czas próbki i jednomyślność, potem ustawia stronę albo anuluje. Wypłata jest permissionless.

Pełny przebieg kont i instrukcji: [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md). Oracle: [`docs/ORACLE.md`](docs/ORACLE.md).

```
gracz A ──place_bet──► vault PDA ──lock──► yield_park
gracz B ──place_bet──┘                         │
                                               ▼
                              Switchboard + TheSportsDB
                                               │
                         resolve / cancel_expired / CANCEL_DRAW
                                               │
                              claim_winnings / refund
```

Wzór: `payout = floor(user_stake × payout_pool / winning_pool)`. Resztki zostają w vault (dust → treasury dopiero gdy wszyscy uprawnieni odebrali).

---

## Co jest pomysłem, a nie kodem

Jurorzy oceniają rozumowanie tak samo jak kod. Poniższe rzeczy **nie są zaimplementowane** — opowiadamy je na filmie i slajdach jako kierunek, nie jako demo.

| Pomysł | Po co |
|--------|--------|
| Ten sam program pod **ubezpieczenie parametryczne** (mecz odwołany → automatyczny zwrot składki) i **escrow milestone** (merge PR / dostawa = wypłata) | Pokazuje, że to nie „kolejny betting UI”, tylko wzorzec *warunek → pula → wypłata bez pośrednika* |
| Yield z **Kamino / Marginfi** zamiast demo `yield_park` | Produkcyjny procent na bezczynnym USDC; `yield_park` jest adapterem na hackathon |
| Rynki 1X2, over/under, serie BO3 | Ten sam vault i claim, inny dekoder wyniku |
| Kilka niezależnych feedów (TheSportsDB + płatne API) | Mniejszy single-source risk |
| Geo / KYC przy wejściu do UI, program bez zmian | Ścieżka licencyjna, nie zmiana matematyki |
| Freeze upgrade authority | Po audycie nikt — w tym my — nie wgra innego `.so` |
| Publiczny crank (keeper) | Lock/resolve bez naszego laptopa |

Skrypt filmu i 10 slajdów: [`docs/NARRACJA.md`](docs/NARRACJA.md). HTML do eksportu PDF: [`presentation/slides.html`](presentation/slides.html).

---

## Świadome ograniczenia (mówimy o nich)

Zasady cenią świadomość ograniczeń wyżej niż udawanie, że ich nie ma.

- **Upgrade authority** jest nadal na walletcie deployera. Możemy wgrać nowy program, dopóki nie odpalimy `scripts/freeze-upgrade-authority.ts`. Na demo mówimy to wprost.
- **TheSportsDB + Switchboard** to zewnętrzne zaufanie do *danych*, nie do custody. Operator FairOdds nie ustala wyniku.
- Admin **listuje** mecze (`initialize_market`). Nie ustala wyniku, nie rusza vaultów, nie zmienia wzoru.
- Token to **demo-USDC**, nie prawdziwe pieniądze. Devnet wystarczy według zasad.
- Publiczny RPC devnet potrafi oddać 429 — do filmu miej explorer z zapisaną sygnaturą.

---

## Repo — co gdzie leży

| Ścieżka | Rola |
|---------|------|
| `programs/aichain` | Rynki, zakłady, resolve, claim, refund, faucet, treasury |
| `programs/yield_park` | Depozyt / withdraw / udział w APR |
| `app/` | Next.js: lista, rynek, faucet, admin |
| `app/src/data/fixtures.json` | Katalog TheSportsDB (listing) |
| `tests/program-test` | Integracja na prawdziwych `.so` |
| `scripts/` | Setup, rynki, seed, crank, smoke |
| `docs/` | Design, flow, narracja filmu, oracle |
| `presentation/` | Slajdy HTML → drukuj do PDF |

Nazwy crate’ów zostają `aichain` / `yield_park` — Program IDs są przypięte do keypairów.

### Program IDs (devnet)

| Program | ID |
|---------|-----|
| `aichain` | `4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg` |
| `yield_park` | `6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS` |
| demo-USDC | `9QwGwtNdA6CWPzswHNM56B8uEtdxVY4ByiRi8aswNMvZ` |
| Global | `3Bu6JBP3WZzsG5aaEYeQTzfB5GYaDrcghB2FBzz4iSVt` |
| Feed-lock PDA | `825vzqeb9iWcWjM5rgL3f3mFQFb4kSp8ghz9zM1HRwDM` |

---

## Uruchomienie

```bash
npm install
cd app && npm install && cd ..
cd app && npm run dev
```

Phantom → sieć **Devnet** → Faucet → zakład.

Testy:

```bash
npm test
```

SBF buduj **osobno, `yield_park` na końcu**. Workspace `cargo-build-sbf` kompiluje `yield-park` z `cpi` i nadpisuje `yield_park.so` pustym stubem.

```bash
cargo-build-sbf --arch v0 --manifest-path programs/aichain/Cargo.toml
cargo-build-sbf --arch v0 --manifest-path programs/yield_park/Cargo.toml
```

Pełny deploy i smoke: `docs/STATUS.md`.

---

## Zgłoszenie (zasady §4)

- **Tytuł:** FairOdds — finanse bez bukmachera
- **Opis + uzasadnienie:** ten plik + `docs/DESIGN.md`
- **Prezentacja PDF ≤ 10 slajdów:** wyeksportuj `presentation/slides.html` (Print → PDF)
- **Film ≤ 3 min:** scenariusz w `docs/NARRACJA.md` — wrzuć na YouTube/Drive i wklej link
- **Repo:** ten kod; na czas oceny ma być **publiczne**

---

Hackathon / MIT-style. Briefy: `zasady.pdf`, `aichain.pdf`.
