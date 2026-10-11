# FairOdds - stan implementacji

Aktualizacja: **2026-10-11**. Oba programy zaktualizowane na devnecie (ostatni deploy `aichain` 2026-10-10 22:04 UTC). Publiczne demo: [fairodds1338.vercel.app](https://fairodds1338.vercel.app), wdrażane automatycznie z `main`. CI na `main` zielone.

Stan on-chain 2026-10-11: 20 rynków meczów (4 otwarte, 3 rozliczone przez wyrocznię, 4 zwroty), 2 rynki sezonowe oznaczone jako historyczne demo, 86 kuponów z 21 portfeli, w większości testowych portfeli zespołu.

Zmiany 2026-10-11:

- Sezon „Bundesliga 2024/25” miał on-chain `historicalDemo=false` mimo znanego wyniku. Manifest i API oznaczają go teraz jako demo; UI pokazuje „wynik już znany”.
- Automatyczny faucet: zakład z UI lub Blinka dla portfela bez demo-USDC dokłada w tej samej transakcji dzienny `faucet_mint`. Bot API ma to jako opcję `autoFaucet` (domyślnie wyłączone). Ostrzeżenie przy braku devnet SOL.
- Wyzwanie dla znajomego: po zakładzie link do X, Telegrama i WhatsAppa otwiera mecz z zaznaczoną przeciwną stroną (`?side=`).
- `/blinks` renderuje Action bez dial.to (Dialect: 503, deployment paused), z linkiem `?market=` i kopiowaniem `solana-action:` URL.
- Tablica ukrywa zamknięte rynki bez żadnej stawki i puste kategorie; kwoty w UI bez sześciu zer.
- Keeper i cron nie były zmieniane.

Poniżej stan wydania v2 z 2026-10-10.

## Wykonane

- Nowe mecze: osobne policy PDA, 50 bps wyłącznie od dodatniego zysku przy claim, brak fee od zwrotów. Stare rynki bez policy zachowują 0%; layout MarketState zachowany.
- Jednostronne nowe mecze anulowane na kickoffie. Vault pozostaje dostępny dla pełnych zwrotów.
- Osobne rynki mistrza ligi i króla strzelców: 2–32 uczestników, jedna pozycja/portfel, top-up, natychmiastowy park depozytu, 0% fee, pełna pula kapitału dla zwycięzców.
- Dwa niezmienne feedy sezonowe, finalność ligi przed rozliczeniem, mapowanie provider IDs do ordinali. Rozbieżność czeka; deadline, remis strzelców lub pusta zwycięska pula umożliwiają zwrot. Jawnie oznaczone historyczne demo.
- Dokładne kwoty u64, CPI yield, kontrola principal i rezerwy zaokrągleń z autoryzacją kanonicznego PDA. Zablokowany atak przez konto należące do programu, ale kontrolowane przez klucz atakującego.
- REST API meczów/sezonów, API agentów, unsigned transakcje, starter bot z lokalnym podpisem, dokumentacja, devnet Actions/Blinks, CORS, body limit i rate limit.
- Wspólny keeper CLI/hosting dla meczów i sezonów, deadline przed oracle, refetch po lock, rotacja pracy i rozdzielenie budżetu sezonów/meczów. Redis REST dla trwałych danych, limiterów i lease; lokalnie atomowe pliki.
- Audyt dat: zachowanie offsetów, fallback do daty z timeTBD, blokada tworzenia rynków bez ustalonej godziny, dodatkowy fallback PandaScore. Nowe joby sprawdzają final status; PandaScore wynik przypisany do opponent ID.
- Nowy UI listy, meczu, sezonu, admina, nawigacji i faucetu. PL/EN, układ mobilny, brak fałszywych kursów, receipt-aware claim/refund.
- Next.js 16.4.0 / React 19, Node 24, zaktualizowane lockfile; CI zaktualizowane w `.github/workflows/ci.yml`. IDL obu programów generowane z Rust, a nie ręcznie poprawiane.
- Bezpieczne przykłady env, wycofany publiczny/hardcoded provider token, oddzielny keeper signer. Logo 512 px, OpenGraph 1200×630, angielskie README i slajdy, PDF, scenariusz ≤3-minutowego demo.

## Zweryfikowane lokalnie

- Unit Rust: **aichain 21/21**, **yield_park 5/5**.
- **20/20 integracji SBF**, z rzeczywistymi skompilowanymi programami w solana-program-test. Legacy lifecycle, pinning/dual feed, brak strat principal, claim/refund/dust, nowe fee i one-sided cancellation, season deposit/resolve/claim/tie/timeout, podmienione i stare feedy, cutoff, spoofed reserve owner.
- **13/13 testów źródeł**: consensus, mapowanie, finalność, daty i timeTBD.
- **11/11 testów API**: dokładne kwoty, unsigned instrukcje obu typów zakładów, u64, receipt/cutoff/side, job finality, credential placeholders i memo Actions zachowujące kwotę/stronę oraz jedyny podpis portfela.
- Root TypeScript i produkcyjny build Next.js: **PASS**.
- **11/11 kontroli przeglądarkowych/HTTP**: rzeczywista lista 46 kanonicznych v2 rynków devnet; API input/body/auth; Actions GET/OPTIONS/CORS; English bez portfela, trwały PL, data na meczu i zablokowany claim bez receipt; brak overflow na 390 px dla home/match/seasons/admin; season table i pojedyncze pole stawki na wyraźnie odseparowanej fixturze. Brak błędów pageerror.
- Zrzuty desktop/mobile i nagranie read-only: `docs/qa/`. Sezonów nie utworzono na żywym chainie; ich on-chain przepływy sprawdzają integracje SBF.
- PDF: 8 stron, każda wyrenderowana do PNG i sprawdzona wizualnie; brak obcięć/overlap.
- `git diff --check`: PASS. Brak śledzonych `.env`, keypairów i deploy-config. Dwie wcześniejsze wartości provider keys są w historii Git, brak ich w aktualnym publicznym bundlu. Właściciel musi wykonać rotację.
- npm audit aplikacji: 18 pozostałych transitive advisories (7 moderate, 11 high, 0 critical). Next zaktualizowany i bezpieczne fixy wykonane; niezgodny `audit fix --force` nie został zastosowany.

## Do uruchomienia w środowisku właściciela

1. Zrotować wcześniej ujawnione API credentials; skonfigurować klucze według `DEPLOYMENT.md` i przykładów env. Nie potrzebujemy przesyłać ich do czatu.
2. Zupgrade'ować istniejący **yield_park, potem aichain** rzeczywistą upgrade authority. Automatycznie wygenerowane target keypairs nie zastępują istniejących kluczy.
3. Wdrożyć app/keeper, prywatny serwerowy RPC, Redis i CRON_SECRET; opublikować katalog, ustawić częstotliwość keepera zgodnie z planem hostingu.
4. Z FOOTBALL_DATA_KEY przygotować i przejrzeć kompletne mapowania mistrza/strzelców, utworzyć oba sezonowe demo. Repo dostarcza pusty manifest zamiast niezweryfikowanego zwycięzcy.
5. Wykonać wallet smoke: legacy claim, nowy fee, one-sided refund, dwa feedy, sezon, Actions na finalnym HTTPS URL. Zapisać nowe Explorer linki i nagrać rzeczywiste bet → settle → claim.
6. Po przeglądzie sekretów zatwierdzić publiczne repo i zgłoszenie. Zamrożenie upgrade authority i produkcyjne Kamino/mainnet pozostają osobnym zakresem.

Szczegółowe polecenia: [DEPLOYMENT](DEPLOYMENT.md). Kontrakt API: [BOT_API](BOT_API.md). Manifesty i zasady sezonów: [SEASON_MARKETS](SEASON_MARKETS.md). Pierwotny plan: [PLAN](archive/PLAN.md).
