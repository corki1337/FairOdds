# Plan Wdrożenia — FairOdds (Colosseum Hackathon)

Kompletny, ustrukturyzowany plan techniczny i submissionowy do wygrania w hackathonie **Colosseum (Crypto World's Fair — Solana Track)**.

---

## 🛠️ CZĘŚĆ 1: ZADANIA TECHNICZNE DO WDROŻENIA W KODZIE

### 1. 🚀 Solana Actions & Blinks (Największy Wyróżnik Hackathonu)
*Cel:* Umożliwienie obstawiania zakładów bezpośrednio z Twittera/X lub linku bez wchodzenia na stronę, z pełnym wsparciem sieci Devnet.
- [ ] **Konfiguracja Routingu (`actions.json`):**
  - Utworzenie pliku reguł: `app/public/actions.json` mapującego `/market/*` na `/api/actions/market/*`.
- [ ] **Endpoint Solana Action (`/api/actions/market/[id]/route.ts`):**
  - **GET:** Zwraca metadane akcji: tytuł meczu, ikona graficzna, opis, aktualne pule oraz przyciski akcji: `[Stawiam Team A]` i `[Stawiam Team B]` z polem kwoty.
  - **POST:** Przyjmuje `{ account: string, data: { team: 0 | 1, amount: number } }`, weryfikuje stan rynku i generuje zserializowaną w Base64 transakcję `place_bet` z memo/blockhash na sieci Devnet.
  - **Obsługa CORS i Nagłówków Dialect:** `Access-Control-Allow-Origin: *`, `x-action-version: 2.1.3`, `x-blockchain-ids: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
- [ ] **Testowanie:** Weryfikacja działania na [dial.to/?cluster=devnet](https://dial.to/?cluster=devnet).

---

### 2. 🤖 API pod Autonomicznych Agentów AI (Solana Agent Kit & Eliza)
*Cel:* Rozwiązanie problemu pustych rynków w modelu Pari-Mutuel poprzez automatycznych arbitrów AI.
- [ ] **Dedykowany Endpoint API (`app/src/app/api/agent/market/[id]/route.ts`):**
  - **GET:** Zwraca stan rynku w formacie JSON (wielkość pul, kickoff, adresy PDA, informację czy jedna strona ma 0 stawek).
  - **POST:** Przyjmuje `{ userPubkey, team, amount }` i zwraca gotową transakcję `place_bet` dla bota.
- [ ] Umożliwienie agentom AI stawiania zakładów własnym demo-USDC w celu zrównoważenia puli.

---

### 3. 💰 Hybrydowy Model Ekonomiczny: 0.5% z Wygranej + Rynki Sezonowe (100% Yield)
*Kluczowa innowacja biznesowa:* Dostosowanie monetyzacji do horyzontu czasowego w DeFi:
- [ ] **Mecze Krótkoterminowe (90 min – 24h):**
  - **0.5% Protocol Fee pobierane WYŁĄCZNIE z wygranej puli (net winnings):**
    - Przegrani tracą wyłącznie swoją stawkę na rzecz wygranych graczy.
    - Zwycięzcy płacą mikro-opłatę 0.5% (50 bps) przy rozliczeniu do treasury.
    - W porównaniu do 8–12% marży tradycyjnych bukmacherów, 0.5% z wygranej to bezkonkurencyjna oferta dla gracza i stały cashflow dla protokołu.
- [ ] **Rynki Długoterminowe (Sezon / Turnieje — Mistrz Ligi, Król Strzelców):**
  - Dedykowana kategoria / zakładka w UI: `Sezon / Outrights`.
  - **0.0% opłaty dla graczy (Zero Platform Fee):** Zwycięzcy otrzymują pełne 100% puli!
  - **Monetyzacja w 100% z Yieldu DeFi:** Zablokowany kapitał leży w protokole lendingowym (Kamino / `yield_park`) przez tygodnie/miesiące, generując 6–10% rocznie. Zysk protokołu pochodzi w całości z wygenerowanego yieldu z wielomilionowego TVL.
  - **Darmowe Źródła API (Już zintegrowane w `scripts/sources/`):**
    - **Mistrz Ligi (Standings):**
      - *OpenLigaDB:* `GET https://api.openligadb.de/getbltable/bl1/2024` (100% darmowe, brak klucza) — zespół na pozycji `[0]` to Mistrz.
      - *football-data.org:* `GET /v4/competitions/PL/standings` (darmowy tier: Premier League, La Liga, Serie A).
      - *TheSportsDB:* `lookuptable.php?l=4328&s=2024-2025` (tabela Premier League).
    - **Król Strzelców (Top Goalscorers):**
      - *OpenLigaDB:* `GET https://api.openligadb.de/getgoalgetters/bl1/2024` (100% otwarte, zwraca `goalGetterName`, `goalCount`, pozycja `[0]` to król strzelców).
      - *football-data.org:* `GET /v4/competitions/{league}/scorers` (zwraca listę top strzelców z golami).
  - **Logika Wyroczni Switchboard On-Demand:**
    - Wyrocznia odpytuje endpoint w bezpiecznym SGX enclave, parsuje JSON (`JsonParseTask: $[0].goalGetterId` lub `$[0].teamInfoId`), i podpisuje sygnaturę on-chain wskazującą zwycięski bilet.
  - Narracja dla sędziów: *"Pierwszy na świecie rynek sezonowy bez żadnych prowizji, finansowany w 100% przez time-value of money w DeFi."*

---

### 4. 🎯 Obsługa Pustych Pul i Brakującej Strony w UI
*Cel:* Wyeliminowanie nierealnych kursów (np. 99.0x) w przypadku braku zakładów na jedną drużynę.
- [ ] **Zastąpienie fałszywego mnożnika:**
  - Gdy `poolA == 0` lub `poolB == 0`: wyświetlenie stanu `Czekamy na stawkę przeciwnika / Waiting for counter-bets`.
  - Wyświetlanie kwoty brakującej do zrównoważenia rynku.
- [ ] **Call to Action dla gracza:** Wyróżnienie wizualne zachęcające do postawienia na pustą stronę i przejęcia całej puli przeciwnika.
- [ ] **Próg minimalny przed kickoffem:** Jeśli do momentu startu meczu jedna strona jest pusta, natychmiastowe anulowanie i 100% zwrot (`cancel`), zamiast czekania 2h na gwizdek końcowy.

---

### 5. 🏆 Dopracowanie UX Po Rozstrzygnięciu (Claim / Refund)
*Cel:* Wyeliminowanie błędów RPC po kliknięciu `Claim` na przegranym lub odebranym kuponie.
- [ ] W [`app/src/app/markets/[id]/page.tsx`](../app/src/app/markets/[id]/page.tsx):
  - Jeśli wygrana już odebrana (`receipt.claimed == true`): zablokowany zielony przycisk `✓ Wygrana odebrana / Claimed`.
  - Jeśli użytkownik postawił na przegraną stronę: wyłączony przycisk ze statusem `Brak wygranej (przegrany kupon)`.
  - Jeśli mecz anulowany / remis: czytelny przycisk `Odbierz zwrot 100% (Refund)` ze statusem.

---

### 6. 🌐 Dwujęzyczność Frontendu (PL / EN Switch)
*Cel:* Zapewnienie pełnej czytelności dla sędziów z USA i Azji.
- [ ] Dodanie przełącznika języka w nawigacji (`app/src/components/Nav.tsx`).
- [ ] Tłumaczenie etykiet (statusy rynków, przyciski zakładów, sekcja wyroczni, faucet).

---

### 7. 📱 Wersja Mobilna (Smartfony)
- [ ] Uproszczenie layoutu pod Phantom Mobile do pojedynczej kolumny: Mecz → Obie pule → Kwota zakładu → Przycisk akcji.

---

### 8. 🔒 Bezpieczeństwo Zależności & Podbicie Next.js
- [ ] Aktualizacja `next: 14.2.21` w `app/package.json` do bezpiecznej wersji patchowej (np. `14.2.35`), aby wyeliminować advisory bezpieczeństwa npm.
- [ ] Sprawdzenie czy `npm run build` przechodzi w 100% czysto.

---

### 9. ⚡ Upgrade Programu `aichain` na Devnet (Dual-Feed Oracle)
- [ ] Klucz authority `4W3P…qBQo` (`target/deploy/aichain-keypair.json`).
- [ ] `solana program extend` (w razie powiększenia pliku binarnego `.so`).
- [ ] Deploy v2 na ten sam adres: `4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg`.
- [ ] Podpięcie drugiego feedu (`attach_secondary_feed`) dla rynków Bundesligi (TheSportsDB + OpenLigaDB).

---

### 16. 🏆 Tabela na mistrza ligi (osobny rynek, nie mecz)
*Cel:* Jedna pula, wiele drużyn. Każdy wpłaca na kogo chce. Wygrana drużyna dzieli cały garnek.
- [ ] Nowe konto obok rynku meczu. Mecz zostaje przy dwóch kupkach i różnicy bramek. Tabela mistrza ma listę drużyn i osobną pulę przy każdej.
- [ ] Stawka zapisuje numer drużyny. Wypłata: `floor(stawka × cała pula / pula zwycięzcy)`.
- [ ] Dwa feedy Switchboard muszą oddać ten sam identyfikator mistrza. Rozjazd → zwrot, bez głosowania.
  - OpenLigaDB `getbltable` i drugie źródło (football-data `/standings` albo TheSportsDB `lookuptable`).
  - Przy zakładaniu rynku spiąć nazwy („Bayern Munich” i „FC Bayern München” to ten sam wiersz).
- [ ] Job milczy, dopóki sezon nie jest zamknięty. Lider tabeli w trakcie sezonu nie jest mistrzem.
- [ ] Demo wypłaty na sezonie, który już się skończył. Bieżąca liga leży do maja i na hackathonie nie pokaże claimu.
- [ ] Król strzelców to ten sam kształt, wierszami są zawodnicy (`getgoalgetters`, football-data `/scorers`).
- [ ] Nowa instrukcja w `aichain`, więc wchodzi w upgrade z punktu 9 (authority `4W3P…qBQo` plus `aichain-keypair.json` to dwa różne pliki).

---

### 17. 🎨 Przebudowa całego UI
*Cel:* Obecny front (lista, rynek, admin, nav, faucet) wygląda jak surowe demo. Nie łatać go punktowo.
- [ ] Jeden nowy wygląd na wszystkie ekrany: strona główna, mecz, sezon / mistrz, admin, nawigacja, faucet.
- [ ] Mecz: obie pule, kurs tylko gdy obie strony mają stawkę, inaczej „czekamy na drugą stronę”. Po meczu osobny stan: odebrane, przegrana, zwrot.
- [ ] Sezon: tabela drużyn z pulą przy każdym wierszu i jednym polem stawki.
- [ ] Telefon w tym samym układzie, jedna kolumna, nie osobna łatka na starym layoucie.
- [ ] PL/EN na nowych tekstach, nie na starej skórce.
- [ ] Po przebudowie sprawdzić w przeglądarce listę, mecz, sezon i telefon.

---

## 📦 CZĘŚĆ 2: ASSETY, DEPLOY I SUBMISSION NA COLOSSEUM

### 10. 🇬🇧 Profesjonalne README.md po Angielsku
- [x] Napisanie oficjalnego, międzynarodowego [`README.md`](../README.md) w języku angielskim:
  - Architektura protokołu, zero-vig model, yield DeFi przez CPI.
  - Dokumentacja wyroczni Switchboard On-Demand i PDA `feed-lock`.
  - Linki do transakcji devnet i zweryfikowanego smoke testu (Sevilla 1:3 Barcelona).
- [x] Zachowanie polskiej wersji pod [`README.pl.md`](../README.pl.md).

---

### 11. 🎨 Assety Graficzne Projektu (Blinki & Colosseum Avatar)
- [ ] Przygotowanie oficjalnego logo / ikony FairOdds w `app/public/icon.png` (512x512) pod metadane Blinka.
- [ ] Banner / OpenGraph image w `app/public/og-image.png` do podglądu linków na X/Twitterze i Vercelu.

---

### 12. 🛡️ Devnet RPC i Ochrona przed Błędem 429
- [ ] Publiczny devnet RPC (`api.devnet.solana.com`) ma rygorystyczny rate limit.
- [ ] Skonfigurowanie zapasowych endpointów w `NEXT_PUBLIC_RPC_FALLBACKS` w `app/src/lib/rpc.ts` (np. darmowy klucz Helius/QuickNode), aby sędziowie nie napotkali błędu 429 podczas testów na żywo.

---

### 13. ☁️ Live Demo na Vercelu (HTTPS)
- [ ] Wdrożenie aplikacji z katalogu `app/` na Vercel (darmowy tier z automatycznym SSL).
- [ ] Podpięcie zmiennych środowiskowych devnet (`NEXT_PUBLIC_RPC_URL`, mint USDC, program IDs).
- [ ] Uzyskanie publicznego adresu URL do formularza Colosseum oraz dla Blinków.

---

### 14. 🔐 Audyt Bezpieczeństwa Repo przed Upublicznieniem
- [ ] Weryfikacja `.gitignore` — upewnienie się, że prywatne klucze SOL (`target/deploy/*-keypair.json`) ani pliki `.env` z kluczami prywatnymi nie znajdują się w repozytorium git.
- [ ] Przełączenie repozytorium GitHub na **Public**.

---

### 15. 🎬 Wideo Demo (≤ 3 minuty) & Prezentacja PDF
- [ ] Nagranie wideo po angielsku (lub z angielskimi napisami) prezentujące:
  1. Problem tradycyjnych bukmacherów (marża, brak wypłat).
  2. Złożenie zakładu on-chain (Phantom na devnecie).
  3. Odczytanie wyniku z wyroczni Switchboard bez udziału serwera.
  4. Wypłata wygranej z PDA (pokazana w Solana Explorerze).
  5. Pokazanie Blinka działającego na Twitterze / dial.to.
- [ ] Wygenerowanie PDF ze slajdów (`presentation/slides.html` -> Drukuj do PDF).
