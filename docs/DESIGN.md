# Uzasadnienie projektowe — FairOdds

Kluczowe pytania projektowe: jaka relacja, kto był pośrednikiem, co zmienia jego usunięcie i dla kogo budujemy to rozwiązanie.

## Relacja finansowa

**Przed:** gracz obstawia mecz u bukmachera. Oddaje pieniądze, dostaje kurs, czeka na werdykt biura.

**Po:** dwóch (albo stu) graczy wkłada USDC do wspólnej puli na Solanie. Kurs jest pochodną udziałów w puli. Werdykt to znak różnicy bramek z publicznego API, podpisany przez sieć oracle. Wypłata to dzielenie całkowite, nie decyzja człowieka.

To ten sam wzorzec, który znamy z lendingu: nie ufasz drugiej stronie ani instytucji, ufasz regule, której nikt nie obejdzie.

## Kto był pośrednikiem

Bukmacher / szara platforma / „crypto betting telegram”:

1. Custody stawek
2. Księga kursów (może ją zmienić)
3. Desk, który uznaje wynik i wypłaca — albo nie

On zarabia na vig, na opóźnieniach, na tym, że przegrany nie ma do kogo iść.

## Co znika razem z nim

Nie znika *źródło wyniku* — mecz i tak ktoś musi zmierzyć. Znika **władza nad kasą i nad wzorem**.

- Stawki nie są na koncie spółki. Są na vault PDA, którego authority to sam rynek.
- Kursu nikt nie publikuje z góry. `implied odds = całkowita pula / pula strony`.
- `claim_winnings` nie pyta admina. Pyta: czy Twój `team_selected` == `winning_team` i czy jeszcze nie brałeś.
- Admin nie ma instrukcji „ustaw wynik”. `set_oracle_result` zostało usunięte.
- Remis i cisza oracle nie zostawiają kasy w próżni: zwrot 100%.

Zostaje świadome, dozwolone przez zasady zaufanie do **Switchboard + TheSportsDB**. To nie jest nasz backend. Nasz serwer nie jest w pathu rozliczenia.

## Dla kogo

**Główny użytkownik:** osoba obstawiająca prawdziwe mecze (piłka nożna, LoL), która nie chce oddawać kasy i werdyktu jednemu biuru.

Język UI: polski, „gospodarze / goście / pula / claim”, nie „PDA / discriminator”.

**Świadomy pivot (potencjał wdrożeniowy, 15% oceny):** ten sam program, inne etykiety:

- ubezpieczenie parametryczne — „mecz odwołany w ciągu 24h → zwrot składki”
- escrow freelancera — „milestone z merge’a / podpisu klienta → wypłata”
- rozliczenie B2B — „indeks / dostawa vs próg → split”

Dlatego crate nazywa się nadal `aichain`: domain-agnostic settlement, FairOdds to pierwsza skóra.

## Model przychodu bez vig

`payout = floor(stake × payout_pool / winning_pool)`.

Nie ucinamy wygranej. Między `lock` a `resolve` kapitał leży w `yield_park` (na hackathon własny mikro-protokół; produkcyjnie ten sam adapter → Kamino). Odsetki i kurz zaokrągleń idą do treasury. Vaultów graczy `withdraw_treasury` nie widzi.

## Czemu blockchain, nie baza

Operator bazy:

- edytuje wiersz `claimed = true` bez wypłaty,
- wyłącza endpoint w niedzielę wieczór,
- trzyma USDC na swoim koncie.

Tu każda stawka i każda wypłata ma sygnaturę na Solanie. Explorer jest dowodem, nie screenshotem z panelu admina.
