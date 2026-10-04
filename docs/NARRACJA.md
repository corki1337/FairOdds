# Narracja — film ≤ 3 min i prezentacja ≤ 10 slajdów

Zasady: film publiczny, slajdy PDF, demo na żywo. Jurorzy oceniają **pomysł i rozumowanie** tak samo jak kod. Poniżej jest podział: **pokazać z łańcucha** vs **opowiedzieć jako kierunek**.

Eksport slajdów: otwórz `presentation/slides.html` → Drukuj → Zapisz jako PDF, landscape, tła włączone.

---

## Film (≤ 180 s) — scenariusz mówiony

Cel: jedna historia. Nie tłumacz Anchor. Pokaż, że pośrednik zniknął.

| Czas | Ekran | Tekst (mniej więcej) |
|------|--------|----------------------|
| 0:00–0:20 | Slajd 1 albo homepage FairOdds | „FairOdds. Dziś jak obstawiasz mecz, ufasz bukmacherowi: trzyma kasę, ustala kurs, orzeka wynik. My tę relację zapisaliśmy w programie na Solanie.” |
| 0:20–0:40 | Phantom connect + Faucet | „Użytkownik: osoba obstawiająca prawdziwe mecze. Faucet jest on-chain — my nie mintujemy z klucza.” |
| 0:40–1:10 | Dwa portfele, ten sam rynek (np. Arsenal–Leeds) | „Portfel A stawia na gospodarzy, portfel B na gości. Kurs rusza się sam, bo to podział puli, nie linia biura.” Pokaż dwie sygnatury na explorerze. |
| 1:10–1:30 | Admin albo lock, explorer inner CPI | „Po gwizdku nikt już nie obstawia. Lock wrzuca pulę do protokołu yield. Kapitał nie leży martwy i nie leży u nas.” |
| 1:30–2:10 | Rynek rozliczony albo karta TheSportsDB + explorer smoke | „Wyniku nie wpisujemy. Oracle Switchboard czyta TheSportsDB: gospodarze minus goście. Sevilla 1:3 Barcelona — zwycięzca dostał 400 USDC. Nasz serwer nie brał udziału.” Otwórz lookupevent i explorer. |
| 2:10–2:35 | Claim / „przegrany nie może” | „Wypłata to wzór. Przegrany dostaje błąd, nie ciszę od supportu. Jak ktoś zniknie w połowie — kasa jest w PDA, claim nie ma deadline’u.” |
| 2:35–3:00 | Slajd potencjał | „To nie musi zostać bukmacherem. Ten sam program to ubezpieczenie parametryczne albo escrow milestone. Vig nie istnieje — żyjemy z yieldu. FairOdds jest pierwszą skórą.” |

Backup: ten sam film. Zasady każą mieć nagranie, gdy padnie net / faucet.

Nie mów „mamy Kamino” ani „mamy licencję”. Mów „następny krok / ten sam wzorzec”.

---

## 10 slajdów — tekst do PDF

1. **Tytuł.** FairOdds. Finanse bez bukmachera. Solana. Superteam Poland.
2. **Problem.** Custody + kurs + werdykt w jednym biurze. Vig, freeze, niewypłacalność.
3. **Pytanie z zasad.** Gdzie w otoczeniu musisz komuś zaufać, żeby transakcja doszła do skutku? Przy zakładzie: biuru *i* temu, że wypłacą.
4. **Insight.** Zostaw wynik na zewnątrz (oracle). Zabierz władzę nad kasą i wzorem. Pari-mutuel + PDA + permissionless claim.
5. **Dla kogo.** Osoby obstawiające prawdziwe mecze. UI po polsku. Nie CLI dla deweloperów.
6. **Jak działa (dziś).** Prematch → pula → lock/yield → Switchboard czyta TheSportsDB → claim. Serwer = katalog, nie sędzia.
7. **Demo.** Dwa portfele. Explorer. Sevilla 1:3 Barcelona, 400 USDC. Linki w `HOW_IT_WORKS.md`.
8. **Gdzie znika pośrednik.** `claim_winnings.rs` + `switchboard.rs`. Admin nie ma `set_result`. Feed-lock nie podpisuje.
9. **Ograniczenia.** Upgrade authority jeszcze nasza. TheSportsDB to jedno źródło danych. Demo-USDC. Mówimy o tym.
10. **Co dalej (pomysł, nie kod).** Kamino. 1X2. Drugi oracle. Licencja / geo na UI. Pivot: insurance, escrow, B2B. Grant Superteam.

---

## Zdania, które warto mieć w głowie

**Gdzie w kodzie znika pośrednik?**  
`programs/aichain/src/instructions/claim_winnings.rs` — transfer z vaultu podpisuje PDA rynku. Wynik: `resolve_market.rs` czyta feed, nie admina.

**Co jak ktoś zniknie?**  
Kasa w vault / park. Lock, resolve, cancel, claim — bez drugiej strony i bez nas.

**Czy możemy coś zmienić po deployu?**  
Tak, dopóki nie zamrozimy upgrade authority. Świadomie. Po freeze — nie.

**Czemu nie baza?**  
Baza to znowu my. Tu custody i matematyka są w sieci, którą juror widzi w explorerze.

**Tydzień więcej?**  
Drugi feed, Kamino za adapterem, freeze, film na produkcji UI.

---

## Ujęcia, które „sprzedają” pomysł bez nowej implementacji

Wolno to powiedzieć. Nie wolno tego kliknąć jako istniejącej funkcji.

- Split-screen: strona Betclic / Superbet (kurs z góry, „konto zablokowane”) vs FairOdds (pula, claim).
- Kartka: „bukmacher = bank + sędzia + market maker”. Skreślasz wszystkie trzy.
- TheSportsDB w przeglądarce obok Solscan — ten sam `idEvent`.
- Jeden slajd „ten sam program, trzy skóry”: kupon / polisa / escrow.
- Liczba: 0% vig, 400 USDC na żywym meczu.

---

## Checklist dnia nagrania

1. `cd app && npm run dev`, Phantom Devnet, dwa portfele z SOL + faucet.
2. Otwarty rynek z pulą (STATUS.md).
3. Karty: explorer programu, explorer smoke Sevilla–Barca, TheSportsDB 2506233.
4. Nagraj backup *zanim* pójdziesz na scenę.
5. PDF ze `slides.html`.
6. Repo publiczne, ten commit na `main`.
