# FairOdds — plan realizacji całości do zatwierdzenia

Data: 2026-10-10. Status: zatwierdzony przez użytkownika; implementacja lokalna wykonana. Wyniki w STATUS.md, działania zewnętrzne w DEPLOYMENT.md.

Podstawa: `docs/PLAN.md` (19 punktów), `docs/STATUS.md`, obecny kod Rust/Next.js, skrypty keepera i źródeł oraz testy integracyjne. Ten dokument ustala kolejność, zakres i kryteria odbioru. Oryginalny plan pozostaje zachowany.

## Zakres i założenia do zatwierdzenia

- Dostarczamy kompletne demo **devnet z demo-USDC**: mecze, rynki sezonowe, nowy interfejs PL/EN, API dla botów i agentów, Blinks, hosting i materiały prezentacyjne.
- Mecze: 0,5% wyłącznie od dodatniego zysku zwycięzcy, przy odbiorze wypłaty. Stawka i zwroty bez tej opłaty. Sezony: 0% prowizji, yield trafia do treasury.
- Rynki sezonowe obejmują mistrza ligi oraz króla strzelców. Wspólny mechanizm wielu uczestników, ale osobne reguły ustalania wyniku. Wielu równorzędnych królów strzelców oznacza anulowanie i zwrot w pierwszej wersji; tę zasadę pokazujemy przed stawką i zapisujemy przy utworzeniu rynku.
- Zachowujemy rozliczalność istniejących rynków i ich dotychczasowe warunki. Nowych opłat nie nakładamy wstecz.
- Na demo korzystamy z istniejącego `yield_park`. Produkcyjna integracja Kamino oraz mainnet wymagają osobnego zakresu i weryfikacji. Nie deklarujemy gwarantowanego APY ani rzeczywistego lendingu, którego obecny kod nie realizuje.
- Historyczny sezon służy do jawnie oznaczonego scenariusza demonstracyjnego. Nie prezentujemy obstawiania znanego już wyniku jako rzeczywistego rynku sezonowego.
- Najpierw wykonujemy kod, testy i przegląd wyników. Zewnętrzne wdrożenia oraz publikacja repozytorium mają osobną bramkę opisaną niżej. Zamrożenie upgrade authority nie należy do tego planu.

## Ustalenia z przeglądu repozytorium

- Są programy `aichain` i `yield_park`, dwuargumentowy rynek meczu, vaulty, receipt, faucet, claim/refund i przypięcie drugiego feedu.
- Jest 13 scenariuszy integracyjnych w `tests/program-test/integration.rs`. Dokumentacja podaje wcześniejsze wyniki części testów, ale podczas przygotowania tego planu nie uruchamiałem ich ponownie.
- Dual-feed jest obecny w kodzie; `STATUS.md` mówi o braku jego wdrożenia na devnet. Stan sieci trzeba potwierdzić przed upgrade'em.
- W UI występuje `pool || 1`, powodujące mylące kursy przy pustej stronie. Claim i Refund są dostępne bez pełnej kontroli receipt i uprawnień do wypłaty.
- Szczegóły rynku już wyświetlają `startTime` jako zamknięcie zakładów. Audyt dat obejmie czytelność i spójność, a nie założenie, że pole całkowicie nie istnieje.
- `scripts/sources/` zawiera adaptery meczów. Brak implementacji sezonowych `standings`, `scorers` i `getgoalgetters`, mimo sugestii w starym planie, że są już zintegrowane.
- TheSportsDB może odrzucać wydarzenia bez godziny; parser dopisuje `Z` również do timestampów ze strefą. PandaScore ma fallback `scheduled_at`, ale nie `original_scheduled_at`.
- Keeper CLI zapisuje katalog i anomalie w plikach. Cron aplikacji ma osobną logikę i nie zapewnia takiego samego przepływu. Trwałych aktualizacji katalogu nie można oprzeć na lokalnym zapisie w funkcji Vercel.
- `.gitignore` chroni wiele kluczy i konfiguracji, ale `.env.example` zawiera wartości wyglądające na rzeczywiste klucze API. Nie przytaczamy ich w dokumentacji ani logach; traktujemy jako potencjalnie ujawnione.
- Dostępne są Node, npm, Cargo i Docker. W PATH nie ma Solana CLI, Anchor ani `cargo-build-sbf`; katalogi zależności i binaria wdrożeniowe nie są obecnie dostępne w standardowych lokalizacjach. Wolne miejsce nie wygląda na blokadę.
- README/DESIGN opisują brak opłaty od wypłaty, więc po zmianie modelu ekonomicznego wymagają aktualizacji.

## Etap 1 — środowisko, sekrety i punkt odniesienia

Powiązanie z PLAN: 8, 12, 14.

1. Przygotować gałąź `codex/implementation` po zatwierdzeniu planu i zachować czysty punkt odniesienia.
2. Zastąpić wartości w `.env.example` pustymi przykładami. Sprawdzić śledzone pliki i historię pod kątem sekretów, bez ich wypisywania. Wymienić potencjalnie ujawnione klucze u dostawców i w hostingu; jeśli brak dostępu, oznaczyć rotację jako konieczne działanie właściciela przed publikacją.
3. Uzupełnić ignorowanie wariantów `.env.*` z wyjątkiem bezpiecznych plików przykładów. Sprawdzić, czy konfiguracje deploy i keypairy pozostają poza gitem.
4. Odtworzyć zależności z lockfile; przygotować kompatybilny toolchain Solana/SBF. Nie tworzyć zastępczego klucza dla istniejącej authority.
5. Uruchomić bazowe testy Rust, adapterów i 13 integracji oraz TypeScript/build aplikacji. Zapisać aktualne wyniki i znane błędy.
6. Zweryfikować aktualne advisories Next.js i zależności w oficjalnych źródłach. Wybrać wspieraną poprawioną wersję na podstawie aktualnej sytuacji, nie kopiować bez sprawdzenia numeru `14.2.35` ze starego planu. Zaktualizować lockfile i sprawdzić zgodność.
7. Przejrzeć autoryzację crona: brak sekretu powinien blokować wywołanie, sekrety przekazujemy w nagłówkach, błędy nie ujawniają konfiguracji.

**Odbiór:** bezpieczny plik przykładowy, udokumentowana rotacja lub jasno wskazana blokada publikacji, powtarzalny build i raport bazowych testów. Build SBF buduje `yield_park` na końcu, zgodnie z ostrzeżeniem w STATUS; naprawiamy niespójność skryptu Docker.

## Etap 2 — wspólne dane i poprawne daty

Powiązanie z PLAN: 4, 19; fundament dla 1, 2, 16, 18.

1. Ustalić wspólny model rynku: typ meczu/sezonu, status on-chain, status wydarzenia, kwoty w jednostkach tokena, uczestnicy, czas, źródła, stan oracle, powód anulowania i polityka opłat.
2. Ujednolicić parsery timestampów: UTC, istniejące offsety, błędne daty, brak godziny oraz fallbacki PandaScore. Oddzielić planowany i faktyczny start.
3. Zachować wydarzenia znane wyłącznie co do dnia w katalogu z `timeTBD`. Techniczny fallback 12:00 UTC nie staje się potwierdzonym kickoffem: takie wydarzenie nie otwiera automatycznie rynku przyjmującego stawki, dopóki czas nie jest wiarygodny.
4. Dla utworzonych rynków czas blokady pochodzi z on-chain `start_time`. Aktualizacja źródła nie zmienia po cichu warunków rynku.
5. Zastąpić wyliczenia przez `pool || 1` wspólną funkcją zwracającą brak kursu przy pustej stronie. Wyliczać brakującą kwotę do równowagi, a orientacyjne wypłaty uwzględniają wpływ nowej stawki oraz opłatę.
6. Ustalić wspólną reprezentację kwot: w publicznym API dziesiętny string USDC, wewnętrznie integer/BN/BigInt. Walidować 6 miejsc po przecinku, minimum, zakres i stronę; unikać obliczeń pieniężnych przez float.

**Odbiór:** testy dat ze strefami i bez godziny, brak fałszywych kursów, zgodne kwoty w UI i API, katalog nie odrzuca wydarzeń tylko z powodu braku godziny i nie przyjmuje dla nich przedwczesnych stawek.

## Etap 3 — program meczu, opłaty i puste pule

Powiązanie z PLAN: 3, 4, 9.

1. Zachować layout istniejącego `MarketState` i jego PDA. Nową politykę zapisać w osobnym PDA, przypiętym atomowo podczas tworzenia nowego rynku, bez możliwości zmiany po wpłatach. Brak polityki oznacza dotychczasowy rynek bez opłaty. Zweryfikować, że klient nie może ominąć istniejącej polityki przez pominięcie konta.
2. Wprowadzić opłatę przy claim:
   - `gross = floor(stake × payout_pool / winning_pool)`;
   - `profit = max(gross − stake, 0)`;
   - `fee = floor(profit × 50 / 10_000)`;
   - użytkownik otrzymuje `gross − fee`, treasury otrzymuje `fee` w tej samej transakcji.
3. Oddzielić raportowanie protocol fee, yieldu i kurzu zaokrągleń. Refund nie nalicza opłaty; treasury nie może pobrać zobowiązań wobec graczy.
4. Dodać permissionless anulowanie rynku z pustą stroną od kickoffu, także gdy keeper przegapi moment startu. Nowe rynki stosują tę regułę przed lokowaniem środków w park; stare zachowują wcześniejszą politykę. Zapewnić możliwość zwrotu i poprawne rozliczenie ewentualnej pozycji w park.
5. Uzupełnić IDL, zdarzenia i budowanie transakcji w `cranks.ts`, skryptach oraz kliencie. Dopilnować zgodności nowych instrukcji ze starymi kontami i potrzebnych dodatkowych kont claim.
6. Testować: legacy 0%, nowe 50 bps od zysku, zysk zerowy, kilka receipt, ponowny claim, przegranego, nieuprawnione treasury, overflow, kolejność claimów, rounding i wszystkie ścieżki refund.

**Odbiór:** stare rynki nadal się rozliczają, stawka nie podlega opłacie, pełna suma transferów nie przekracza dostępnego vaultu, jednostronny nowy rynek może być anulowany bez oczekiwania na koniec meczu.

## Etap 4 — rynki sezonowe i wyrocznia

Powiązanie z PLAN: 3, 16.

1. Dodać osobne konta i instrukcje rynku sezonowego, uczestników/pul i receipt, z osobną przestrzenią PDA. Ustalić limit liczby uczestników i sprawdzić rozmiar kont/transakcji; nie rozbudowywać meczu o nieograniczoną tablicę.
2. Zapisać sezon, ligę, typ rynku, listę uczestników, kanoniczne identyfikatory, regułę remisu, koniec przyjmowania stawek i deadline rozliczenia. Parametry niezmienne po otwarciu.
3. Dodać adaptery tabeli i strzelców. Zweryfikować aktualne payloady i dostępność sezonów u dostawców. Zmapować drużyny/zawodników między źródłami po identyfikatorach i kontrolowanych aliasach przed otwarciem rynku.
4. Joby Switchboard muszą potwierdzać finalność sezonu oraz ten sam kanoniczny wynik. Nie wybierać po prostu pierwszego wiersza bieżącej tabeli. Bramkę finalności egzekwuje podpisany wynik jobu i walidacja on-chain, a nie sam keeper.
5. Dwa przypięte feedy, niezmienny hash i authority lock. Różne identyfikatory dostawców nie są porównywane bezpośrednio. Źródła z kluczem wymagają sprawdzenia bezpiecznego sposobu uwierzytelnienia; sekret nie trafia do publicznej definicji jobu.
6. Zdefiniować brak danych, spór, nierozpoznanego zwycięzcę, remis i pustą pulę zwycięzcy: blokada rozliczenia lub anulowanie zgodnie z przypiętą regułą; po deadline każdy może odblokować zwroty. Bez głosowania większością.
7. Wypłata zwycięzcy: `floor(stake × payout_pool / winning_pool)`, bez protocol fee. Yield ponad kapitał trafia do treasury. Zaplanować lokowanie od chwili wpłaty, aby środki faktycznie pracowały podczas sezonu; sprawdzić kolejne wpłaty, rozliczenie udziałów i możliwość zwrotu.
8. Sprawdzić finansowanie rezerwy `yield_park` na pełny horyzont sezonu, rounding i zachowanie przy niedoborze. Obecna ścieżka dopuszcza mały niedobór principal; obietnica zwrotu 100% wymaga pokrycia różnicy i testu, a nie samego tekstu w UI.
9. Przygotować historyczny sezon do demo i osobny aktualny rynek oczekujący na zakończenie. Jeżeli nie ma dwóch wiarygodnych źródeł lub sposobu dowiedzenia finalności, oznaczyć to jako blokadę uruchomienia tego rynku; nie zastępować jej ręcznym werdyktem.

**Odbiór:** test pełnego cyklu sezonu, dwóch źródeł, remisu strzelców, wpłat w różnych momentach, końca sezonu, sporu, pustej zwycięskiej puli, timeout/refund i odsetek. Rozmiary i koszty mieszczą się w limitach Solany.

## Etap 5 — REST, boty, agenci i Actions/Blinks

Powiązanie z PLAN: 1, 2, 18.

1. Wspólny serwerowy odczyt rynku i builder **niepodpisanej** transakcji używany przez wszystkie trzy interfejsy. Portfel użytkownika jest fee payer; API nie przyjmuje kluczy i nie podpisuje jego stawek.
2. REST: `GET /api/v1/markets`, `GET /api/v1/markets/[id]`, `POST /api/v1/markets/[id]/bet`, analogiczna jednoznaczna obsługa rynków sezonowych. Lista z filtrami i paginacją.
3. Agent API: stan pul, sygnał pustej strony, brak do równowagi, uczestnicy i przygotowanie stawki przez wspólny builder. Przykład demo balancing używa własnego demo-USDC i limitu budżetu; nie obiecuje arbitrażu ani automatycznego napływu płynności.
4. W każdej transakcji sprawdzić adres portfela, mint, status i cutoff rynku, minimalną kwotę, wybraną stronę oraz istniejący receipt. Obsłużyć ATA, aktualny blockhash, termin ważności i ponowne pobranie wygasłej transakcji. Zwracać błędy maszynowe, bez sekretów.
5. Actions: `app/public/actions.json`, GET/POST/OPTIONS dla rynku, metadane, przyciski stron i kwota. Sprawdzić aktualną oficjalną specyfikację Actions, nagłówki devnet, CORS i format parametrów przed implementacją; numery wersji ze starego planu traktować jako historyczne.
6. Dodać limity żądań, limity body, kontrolę kosztu odczytów RPC i cache wyłącznie tam, gdzie nie zmienia ważności transakcji. Kwoty i uprawnienia pozostają walidowane on-chain.
7. Dostarczyć `examples/bot/simple-bot.ts`, `docs/BOT_API.md` i przykład użycia przez agenta. Konfiguracja lokalnego klucza bota poza repo; dokumentacja pokazuje lokalne podpisanie i wysłanie na devnet.

**Odbiór:** testy tras i dekodowanie instrukcji wygenerowanych transakcji; klient podpisuje lokalnie; błędny input, zamknięty rynek i inna strona istniejącego receipt są odrzucane; Blink sprawdzony w aktualnym narzędziu Dialect na devnet.

## Etap 6 — pełna przebudowa UI, PL/EN i grafiki

Powiązanie z PLAN: 4, 5, 6, 7, 11, 17, 19.

1. Wspólny styl i komponenty dla strony głównej, meczu, sezonu, admina, Nav i Faucet. Najpierw spójny szkielet, następnie podłączenie zweryfikowanych danych i transakcji.
2. Zakładki meczów i sezonów, wyszukiwanie/filtry, czytelny status, data i strefa czasowa. Status nie zastępuje daty; brak potwierdzonej godziny jest jawny.
3. Mecz: pule, orientacyjne kursy tylko przy obu stronach, kwota do równowagi, formularz i informacja o opłacie od zysku. Kurs pari-mutuel jest zmienny do zamknięcia, co pokazujemy użytkownikowi.
4. Sezon: tabela uczestników z pulą przy każdym, wybór uczestnika, jedno pole stawki, termin końca obstawiania i czytelna reguła remisu.
5. Pełne stany receipt: brak zakładu, oczekiwanie, wygrana do odbioru, odebrana wygrana, przegrana, zwrot do odbioru, odebrany zwrot. Przyciski zależą od połączenia portfela, danych i uprawnień. Po transakcji odświeżamy receipt i saldo.
6. Jedna warstwa tłumaczeń PL/EN, zapamiętywany wybór języka; obejmuje błędy, statusy, admin, faucet i opisy oracle. Domyślny EN dla publicznego demo.
7. Mobilny układ jednej kolumny, duże cele dotykowe, obsługa Phantom Mobile, dostępność klawiatury, kontrast, loading/empty/error i komunikaty o RPC.
8. Logo `app/public/icon.png` 512×512 oraz `og-image.png`, metadane linków i ikona Blinka. Ujednolicić brand z prezentacją.

**Odbiór:** przegląd w przeglądarce listy, meczu, sezonu, admina i faucet w PL/EN na desktopie i telefonie. Sprawdzone wszystkie stany claim/refund, połączenie portfela, dwie stawki i odświeżenie danych. Zrzuty do odbioru interfejsu.

## Etap 7 — keeper i przygotowanie infrastruktury

Powiązanie z PLAN: 4, 9, 12, 13, 16.

1. Ujednolicić reguły crona i keepera CLI: otwieranie, anulowanie pustej strony, lock/yield, aktualizacje obu feedów, rozliczenie i timeout. Wydzielić wspólną logikę zamiast dwóch niezależnych implementacji.
2. Zapewnić idempotencję, limity pracy na przebieg, obsługę równoległych wywołań, retry/backoff i wznowienie po częściowym wykonaniu. Rozjazd feedów pozostaje zablokowany on-chain.
3. Katalog i anomalie umieścić w trwałym magazynie dostępnym dla hostingu; lokalne pliki mogą pozostać adapterem dev. Wybrać rozwiązanie zgodne z dostępnym kontem przed integracją. Udokumentować job odświeżania katalogu oraz jego monitoring.
4. Rozdzielić zwykły signer keepera od upgrade authority. Prywatny RPC pozostaje opcjonalny; nie wystawiać prywatnego klucza dostawcy w `NEXT_PUBLIC_*`, jeśli jego polityka nie dopuszcza przeglądarki.
5. Przygotować release: wersje, binaria, IDL, konfigurację devnet, instrukcje smoke, plan wycofania frontendu/keepera i ograniczenia cofania zmian on-chain.

**Odbiór:** restart nie gubi stanu, cron z błędną autoryzacją odmawia pracy, powtórzone wywołanie nie powtarza skutecznej operacji, hosting ma aktualny katalog i anomalie bez lokalnych zapisów funkcji.

## Etap 8 — bramka release, devnet i materiały zgłoszeniowe

Powiązanie z PLAN: 9, 10, 11, 13, 14, 15.

1. Pełna walidacja: oba zestawy unit Rust, adaptery, integracje SBF ze starymi i nowymi kontami, testy kwot/fee, API, TypeScript i produkcyjny build Next.js oraz przejścia w przeglądarce.
2. Przedstawić wynik testów, gotowy UI, binaria/IDL, listę nowych kont/instrukcji i konkretny runbook upgrade. Potwierdzić na sieci program IDs, aktualną authority, saldo SOL, wielkość programu i stan aktywnych rynków. Nie odczytywać prywatnych kluczy do raportu.
3. **Po zatwierdzeniu tego konkretnego release'u:** upgrade `aichain` na ten sam devnet ID, extend wyłącznie jeśli potrzebny, aktualizacja keepera i Vercel. Drugiego feedu nie dopinać do rynków, które już przyjęły stawki; do smoke stworzyć nowy rynek z oboma feedami.
4. Smoke devnet: dwa portfele, faucet, stawki po obu stronach, lock, zgodne feedy, claim z opłatą i transfer treasury; osobno jednostronne anulowanie, refund i sezon bez opłaty. Zapisać sygnatury i sprawdzić salda. Scenariusze wymagające zmiany danych oracle testować w kontrolowanym środowisku, nie wymuszać fałszywych wyników na publicznym rynku.
5. Aktualizować README EN/PL, DESIGN, HOW_IT_WORKS, ORACLE, STATUS, checklistę demo, BOT_API i oryginalny PLAN zgodnie z faktycznie sprawdzonym zachowaniem. Zweryfikować aktualne wymagania i terminy konkretnego hackathonu przed submission; stary tytuł planu nie dowodzi ich aktualności.
6. Uzupełnić publiczny URL i linki Explorer; sprawdzić HTTPS, OpenGraph i Blink. Przygotować slajdy/PDF oraz scenariusz angielskiego wideo do 3 minut. Nagranie z rzeczywistym podpisaniem portfela może wymagać udziału właściciela portfela.
7. **Osobna zgoda przed upublicznieniem repozytorium i wysłaniem zgłoszenia.** Publiczność repo wymaga zakończonej rotacji potencjalnie ujawnionych kluczy; samo usunięcie bieżących wartości nie usuwa ich z historii.

**Odbiór:** zweryfikowany live demo devnet, dowody transakcji i sald, zgodna dokumentacja, gotowe materiały, zakończone czynności zewnętrzne albo jednoznacznie wskazany brak dostępu/zgody.

## Kolejność i granice zatwierdzenia

Kolejność: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**. Prace nad szkieletem UI i dokumentacją mogą postępować po ustaleniu modeli, ale odbiór opiera się na docelowych instrukcjach i danych.

Zatwierdzenie tego planu uruchamia lokalną realizację etapów 1–7 i przygotowanie release'u w etapie 8. Zgody techniczne wymagane przez sandbox dla instalacji lub dostępu do chronionych plików będą zgłaszane dla konkretnych czynności. Upgrade programów, publikacja live i upublicznienie repo mają opisane wyżej osobne bramki; na etapie planowania nie wykonujemy żadnego z tych działań.

Potrzebne do pełnego zakończenia: dostęp do kont dostawców przy rotacji, klucz rzeczywistej upgrade authority i konfiguracja devnet, dostęp do Vercel i trwałego magazynu, SOL na koszty demo, dwa portfele oraz ewentualne klucze źródeł sezonowych. Dokładne estymacje czasu ustalimy po odtworzeniu buildów i próbie dwóch sezonowych feedów — te elementy niosą największą niepewność.

Całość uznajemy za wykonaną dopiero po spełnieniu kryteriów etapów i aktualizacji checklisty 19 punktów z PLAN. Pozycje zależne od właściciela lub zewnętrznego dostawcy pozostają jawnie otwarte, a nie oznaczone jako ukończone.
