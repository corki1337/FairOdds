# FairOdds

Rynki sportowe na Solana devnet: wspólne pule, podpis we własnym portfelu i wypłata z vaultów PDA. Wynik dostarcza Switchboard On-Demand. Demo-USDC nie ma wartości pieniężnej.

Nowe mecze pobierają **0,5% dodatniego zysku** przy odbiorze wygranej. Przykład: stawka 100, wypłata brutto 400, fee 1,50, netto 398,50 USDC. Stawki i zwroty bez fee; stare rynki bez policy PDA zachowują 0%. Pusta strona na kickoffie nowego rynku oznacza anulowanie i pełny zwrot. Remis, pusta zwycięska pula i upływ deadline również odblokowują zwroty.

Sezony mają osobne konto z 2–32 drużynami/zawodnikami i **0% prowizji**. Depozyt od razu trafia do demonstracyjnego `yield_park`; cały kapitał dzielą zwycięzcy, nadwyżka trafia do treasury. To rezerwa demo, nie wdrożone Kamino ani gwarantowany APY. Dwa przypięte feedy muszą potwierdzić tego samego uczestnika po zakończeniu sezonu. Remis króla strzelców oznacza zwrot. Historyczne demo jest oznaczone jako znany wynik.

Front przebudowano wspólnie dla listy, meczu, sezonu i admina, z przełącznikiem PL/EN i układem mobilnym. Publiczne REST API, API agentów i Solana Actions przygotowują niepodpisane transakcje; żaden endpoint nie przyjmuje klucza prywatnego użytkownika. Keeper CLI i hosting używają wspólnej logiki oraz Redis REST na hostingu.

Publiczne demo: [fairodds1338.vercel.app](https://fairodds1338.vercel.app). Oba programy są zaktualizowane na devnecie. Portfel bez demo-USDC dostaje dzienny faucet w tej samej transakcji co pierwszy zakład; potrzebne jest tylko trochę devnet SOL na opłaty ([faucet.solana.com](https://faucet.solana.com)). Po zakładzie link „Wyzwij znajomego” otwiera mecz z zaznaczoną przeciwną stroną. Oba rynki sezonowe są oznaczone jako demo historyczne. dial.to Dialecta jest obecnie wyłączone, więc Blinka na devnecie testuje się na `/blinks?market={id}`.

Uruchomienie lokalne: Node 24, `npm ci --legacy-peer-deps`, `npm --prefix app ci --legacy-peer-deps`, konfiguracja przykładów env, `npm --prefix app run dev`. Pełne instrukcje i lista kluczy są w [DEPLOYMENT](docs/DEPLOYMENT.md). Push na `main` automatycznie wdraża publiczne demo.

Dokumentacja: [API botów](docs/BOT_API.md), [sezony i mapowanie](docs/SEASON_MARKETS.md), [model i zabezpieczenia](docs/DESIGN.md), [wyniki weryfikacji](docs/STATUS.md). Materiały demo są w `presentation/` i [DEMO_CHECKLIST](docs/DEMO_CHECKLIST.md). Publikacja repo, upgrade authority i rzeczywiste nagranie transakcji wymagają środowiska właściciela. Nie przeprowadzono audytu mainnet.
