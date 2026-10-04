# Odpowiedzi dla jurorów Superteam

## Gdzie dokładnie w kodzie znika pośrednik?

W `programs/aichain/src/instructions/claim_winnings.rs` i `refund.rs`. Matematyka i transfer tokenów egzekwuje program. Authority vaultu to PDA rynku — do wypłaty nie potrzeba podpisu admina.

Admin nie ma głosu w wyniku. Przy tworzeniu rynku przypinany jest feed Switchboard (`initialize_market` zapisuje adres i `feed_hash`). W tej samej transakcji authority feedu idzie do PDA `feed-lock`, której żadna instrukcja nie podpisuje. Job (TheSportsDB `lookupevent.php`) nie da się podmienić, authority nie zapisze wartości ręcznie. `resolve_market` jest permissionless i bierze tylko podpisane próbki po końcu meczu, zgodne, zdekodowane jako znak `home − away`. Zobacz `programs/aichain/src/switchboard.rs`.

## Co jeśli strona zniknie w połowie?

- Po `place_bet` USDC jest w vault rynku (albo w `yield_park` po locku).
- Każdy może zrobić `lock_market` po starcie i `resolve_market` po końcu — bez admina.
- Jeśli nie ma poprawnego wyniku przed `resolve_deadline`, każdy woła `cancel_expired`: kapitał wraca z parku, każdy dostaje pełny zwrot.
- `claim_winnings` / `refund` nie mają limitu czasu i nie potrzebują kontrahenta.

## Kto ma jakie uprawnienia po deployu?

| Akcja | Kto |
|--------|-----|
| `initialize_global` / `initialize_market` | Authority (nie wybiera wyniku) |
| `place_bet` / `claim_winnings` / `refund` | Użytkownik |
| `lock_market` / `resolve_market` / `cancel_expired` | Ktokolwiek |
| `harvest_to_treasury` | Ktokolwiek, dopiero gdy wszyscy uprawnieni odebrali |
| `withdraw_treasury` | Authority, tylko treasury — nie vaulty |
| Zmiana wyniku albo ruszenie puli | Nikt |

Upgrade authority programu jest nadal nasza. `scripts/freeze-upgrade-authority.ts` ustawia ją na `None`. Na demo mówimy, że to świadomy haczyk, nie ukrywamy go.

## Czemu blockchain, a nie zwykła baza?

Operator bazy jest dalej pośrednikiem: edytuje salda, cenzuruje claim, idzie offline z custody. Tu reguły i kasa są na Solanie. Explorer dowodzi każdej stawki i wypłaty.

## Co dalej, gdyby był jeszcze tydzień?

1. Drugi, płatny feed obok TheSportsDB (rate-limit free tier).
2. CPI do Kamino za tym samym interfejsem co `yield_park`.
3. Freeze upgrade authority po ostatnim audycie.
4. Rynki 1X2 i mobile.

To jest **kierunek**, nie zrobiona robota. Na slajdzie 10 i w ostatnich 20 sekundach filmu.
