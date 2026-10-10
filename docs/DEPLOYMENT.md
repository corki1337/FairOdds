# Wdrożenie po mergu

Kod jest przygotowany na devnet. Merge nie aktualizuje programów Solana. Przed uruchomieniem nowego frontu trzeba zaktualizować **oba programy**, skonfigurować hosting oraz przygotować rynki sezonowe. Nie zmieniaj istniejących adresów programu ani mintu. Nie uruchamiaj ponownie `setup:devnet` na istniejącym środowisku.

## Pobranie implementacji z GitHuba

W istniejącym klonie repozytorium pobierz gałąź implementacji:

```bash
git fetch origin
git switch codex/implementation
git pull --ff-only
```

Po zmergowaniu PR do main: `git switch main` i `git pull --ff-only`. Konfigurację dopisz do ignorowanych `.env` / `app/.env.local` lub środowiska hostingu; sekrety nie trafiają do commita.

## Aktualizacja GitHub Actions

Użyte logowanie do GitHuba pozwala publikować kod, ale nie zmieniać `.github/workflows/ci.yml` (brak scope `workflow`). Aktualizacja CI jest dołączona jako `docs/CI_UPDATE.patch`: Node 24, testy API, kontrola TypeScript i oba programy Rust. Właściciel z uprawnieniem do workflows stosuje ją i wysyła osobnym commitem:

```bash
git apply docs/CI_UPDATE.patch
git add .github/workflows/ci.yml
git commit -m "Update CI for FairOdds implementation"
git push
```

## Środowisko i weryfikacja

Node 24 (`.nvmrc`), Rust/Cargo, Python 3, Agave `cargo-build-sbf` 4.3.0/platform-tools v1.57 lub kompatybilny toolchain, Solana CLI. Stary build-sbf 1.18 z nowym lockfile może nie obsługiwać edition 2024. Docker jest alternatywą, ale obraz również musi mieć kompatybilny toolchain.

```bash
npm ci --legacy-peer-deps
npm --prefix app ci --legacy-peer-deps
npm run typecheck
npm run test:sources
npm run test:api
npm run test:rust
npm run test:integration
npm run idl:generate
npm --prefix app run build
```

Build tworzy `target/deploy/aichain.so` i `yield_park.so`. Automatycznie wygenerowane pliki `*-keypair.json` w target **nie są** kluczami istniejących programów i nie potwierdzają prawa do upgrade'u. Integracje wykonują rzeczywiste binaria SBF w program-test; nie wymagają API keys ani działającego devnet.

## Klucze i zmienne

Skopiuj `.env.example` do root `.env` dla skryptów i `app/.env.example` do `app/.env.local` dla aplikacji. Na Vercelu ustaw te same serwerowe zmienne, root projektu `app/`, Node 24, build `npm run build`.

- `FOOTBALL_DATA_KEY`: tabela i strzelcy drugiego źródła sezonów; plan dostawcy musi obejmować użyte endpointy i rok.
- `PANDASCORE_TOKEN`: katalog e-sportu i wykonanie jego jobów przez keepera. Brak tego klucza nie przeszkadza meczom TheSportsDB/OpenLigaDB.
- `API_FOOTBALL_KEY` opcjonalny do dodatkowego sprawdzania wyników; `API_FOOTBALL_DAILY` ogranicza budżet zapytań.
- `RPC_URL` i `RPC_FALLBACKS`: prywatne serwerowe devnet RPC. Publiczne `NEXT_PUBLIC_RPC_URL` i `NEXT_PUBLIC_RPC_FALLBACKS` są widoczne w przeglądarce; użyj publicznego/restrykcyjnego endpointu, bez prywatnego sekretu.
- `NEXT_PUBLIC_APP_URL`: finalny HTTPS origin do ikon Actions/OpenGraph.
- `NEXT_PUBLIC_CLUSTER=devnet`, `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_GLOBAL_PDA`: istniejące wartości z lokalnego `deploy-config.json`; identyfikatory programów są zapisane w `app/src/lib/ids.ts`.
- `KEEPER_PRIVATE_KEY`: **oddzielny** portfel devnet z SOL do opłat, JSON tablica 64 bajtów lub base58. Keeper rozlicza permissionless; nie potrzebuje klucza upgrade authority. `CRANK_PRIVATE_KEY` jest starszym aliasem; brak fallbacku do admin key.
- `CRON_SECRET`: długi losowy token; tylko nagłówek `Authorization: Bearer …`.
- `KV_REST_API_URL` i `KV_REST_API_TOKEN`: wspólny Redis REST do katalogu, manifestów, anomalii, rate limitów i blokady keepera. Wymagane do trwałych zapisów na Vercelu. Lokalnie są atomowe pliki.
- `ANCHOR_WALLET`: lokalna ścieżka do authority do tworzenia rynków przez CLI; `ANCHOR_PROVIDER_URL` na devnet. Tego pliku nie wysyłaj do API, repo ani browser env.
- `SEASON_ALIASES_PATH`, `SEASON_CONFIG_PATH`, `SEASON_CUTOFF`, `SEASON_END_TIME`: przygotowanie sezonów według `SEASON_MARKETS.md`.

Wszystkie klucze są serwerowe; żaden nie może mieć prefiksu `NEXT_PUBLIC_`. W starym przykładzie/env oraz jobie PandaScore występowały rzeczywiste wartości: właściciel powinien je **zrotować u dostawców** przed publikacją. Usunięcie z aktualnego pliku nie usuwa historii gita ani wcześniej opublikowanego joba.

## Upgrade na istniejące adresy

Właściciel sprawdza oba `solana program show` i odpowiadające im upgrade authority. Klucz authority i keypair programu to różne rzeczy. Poniższe polecenia używają **istniejących adresów** oraz rzeczywistej, lokalnej authority:

```bash
solana program show 6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS --url devnet
solana program show 4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg --url devnet
solana program deploy target/deploy/yield_park.so --program-id 6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS --upgrade-authority /SAFE/PATH/park-authority.json --keypair /SAFE/PATH/fee-payer.json --url devnet
solana program deploy target/deploy/aichain.so --program-id 4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg --upgrade-authority /SAFE/PATH/aichain-authority.json --keypair /SAFE/PATH/fee-payer.json --url devnet
```

Kolejność: **yield_park, potem aichain**. Nowy aichain korzysta z nowej instrukcji pokrycia minimalnego zaokrąglenia z wolnej rezerwy. Jeżeli pojemność ProgramData jest niewystarczająca, authority wykonuje `solana program extend PROGRAM_ID DODATKOWE_BAJTY --url devnet` zgodnie z rozmiarem `.so`, używaną wersją CLI i wymaganym SOL. Zachowaj hash poprzednich binariów i adresy. Nie zamrażaj upgrade authority.

Układ istniejącego `MarketState` został zachowany; nowe zasady są w osobnym policy PDA. Stare rynki mają 0% fee. Nowe tworzenie atomowo dołącza 50 bps od dodatniego zysku i anulowanie jednostronnej puli. Instrukcje `lock_market`/`claim_winnings` potrzebują teraz dodatkowych kont — wdrażaj front i skrypty razem z programem. Starsze, niezgodne konta sprzed v2 są pomijane przez listę; ich migracja nie jest częścią tego upgrade'u.

## Hosting, katalog i keeper

Po konfiguracji Redis wykonaj `npm run catalog:publish`, a dla sezonów przygotowanie i przegląd manifestów z `SEASON_MARKETS.md`. CLI `npm run keeper` odświeża katalog, tworzy mecze authority i korzysta z tej samej logiki rozliczeń co hosting. Hosting cron tylko rozlicza; nie ma admin authority do tworzenia rynków.

`app/vercel.json` ustawia dzienny cron, zgodny z ograniczonym planem hostingowym. Dla ciągłego rozliczania uruchom keeper CLI lub ustaw częstszy harmonogram na planie, który go obsługuje. Cron przetwarza maksymalnie 10 kwalifikujących się rynków w jednej iteracji; błędy oracle są ponawiane. Redis blokuje nakładające się uruchomienia. Sam hosting statycznego katalogu nie odświeża fixture providers.

Po upgrade: sprawdź istniejący claim/refund, nowy dwustronny mecz (fee), jednostronny zwrot na kickoffie i historyczny sezon z dwoma feedami. Keeper musi mieć SOL; park potrzebuje finansowanej **wolnej rezerwy** do demo yieldu i ewentualnego zaokrąglenia. Reserve nie może pokrywać rzeczywistych strat ani wypłacać depozytów innych użytkowników. Faucet/seed służą tylko demo-USDC.

Na finalnym HTTPS origin sprawdź `/actions.json`, OPTIONS, GET/POST Actions w `dial.to/?cluster=devnet`, dwie drużyny/kwotę i rzeczywisty podpis w Phantom. Zapisz Explorer linki nowego smoke testu, nagraj materiał według `DEMO_CHECKLIST.md`, dopiero potem publikuj zgłoszenie/repo po przeglądzie sekretów.

## Ograniczenia wydania

Next.js zaktualizowany do 16.4.0; produkcyjny build sprawdzony. npm audit nadal raportuje 18 podatności przechodnich (7 moderate, 11 high) w legacy ekosystemie Anchor/Solana/Switchboard i zależnościach tooling. Brak critical w sprawdzonym lockfile aplikacji. Bezpieczny audit fix wykonano; `--force` proponuje niezgodne wersje, więc nie jest częścią wdrożenia. To demo devnet, nie audyt mainnet. `yield_park` to rezerwa demonstracyjna, **nie wdrożone Kamino** i nie gwarantowane APY.
