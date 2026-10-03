# HANDOFF — przeniesienie projektu na inny komputer

**Data stanu:** 2026-10-03  
**Maszyna źródłowa:** Windows, dysk `D:\blockchain` (C: był pełny ~2–4 GB free)  
**Repo git:** lokalny, **brak commitów** (`master` pusty) i **brak remote** — nie ma nic na GitHubie.

Ten plik = jedyne źródło prawdy „co jest, czego brakuje, jak odpalić gdzie indziej”.

---

## 1. Co to jest

MVP na Superteam Poland — *Finance Without Intermediaries*:

- Pari-mutuel binary markets (Team A / Team B), np. NaVi vs FaZe
- Program `aichain` — rynki, bety, lock, oracle, resolve, claim, refund
- Program `yield_park` — mikro-yield (APR/shares); przy lock CPI deposit, przy resolve withdraw
- Next.js app (`app/`) — lista rynków, bet/claim, admin, API oracle
- Dokumenty pitch/design/demo w `docs/` + slajdy w `presentation/`

Briefy źródłowe (PDF w root): `aichain.pdf`, `zasady.pdf`.

---

## 2. Co JEST zrobione (kod / artefakty)

### On-chain (Anchor 0.30.1)

| Program | `declare_id!` / Program ID |
|---------|----------------------------|
| `aichain` | `CYizbVKeAyuiZUh9RBKhSw9m2o2CzFDxg95yLJWhJvUW` |
| `yield_park` | `H6wcSEryWtp2rmEu56qCi7zXMd6pmrAMH9cKHxDuM4ET` |

**Instrukcje `aichain`:**  
`initialize_global`, `initialize_market`, `place_bet`, `lock_market`, `set_oracle_result`, `resolve_market`, `claim_winnings`, `refund`, `harvest_to_treasury`

**Instrukcje `yield_park`:**  
`initialize_park`, `seed_reserve`, `deposit`, `withdraw`

**Sklompilowane binarki (ta maszyna):**

```
target/deploy/aichain.so              (~437 KB)
target/deploy/yield_park.so           (~296 KB)
target/deploy/aichain-keypair.json    ← KRYTYCZNE
target/deploy/yield_park-keypair.json ← KRYTYCZNE
```

Build na Windows wymagał obejścia: `cargo-build-sbf --tools-version v1.56 --arch sbfv2` (patrz `scripts/build-programs.ps1`). Na Linuxie zwykle wystarczy normalne `anchor build`.

### Frontend (`app/`)

- Next.js + wallet-adapter (Phantom) + TanStack Query (wg planu)
- Strony: `/`, `/markets/[id]`, `/admin`
- Oracle HTTP: `app/src/app/api/oracle/[matchId]/route.ts`
- Stub IDL (ręcznie / skopiowane): `app/src/lib/idl/aichain.json`, `yield_park.json`
- IDs: `app/src/lib/ids.ts`

### Skrypty / testy / docs

| Plik | Status |
|------|--------|
| `tests/aichain.ts` | Napisany; **nie odpalony** (brak pełnego `anchor test`) |
| `scripts/setup-devnet.ts` | Napisany; **nie odpalony** na żywym devnet |
| `scripts/demo-prepare.ts` | Napisany |
| `scripts/env-d-drive.ps1` | Tylko stary Windows z pełnym C: — na nowym PC zwykle zbędny |
| `scripts/build-programs.ps1` | Windows D:-only build |
| `docs/DESIGN.md`, `PITCH.md`, `ORACLE.md`, `DEMO_CHECKLIST.md` | Jest |
| `presentation/slides.md` | Jest |
| `README.md` | Ogólny + notatki Windows |

### Czego NIE ma / nie dokończono

1. **Brak git commit + brak GitHub remote** — cały projekt tylko lokalnie.
2. **Brak deploy na devnet** — programy nie są on-chain.
3. **`anchor test` nie przechodził** (toolchain Windows/C: full).
4. **Brak wygenerowanych oficjalnych IDL / `target/types/*.ts`** z `anchor build` — app używa stub IDL; `setup-devnet.ts` importuje `../target/types/...` → po świeżym `anchor build` typy się pojawią.
5. **Brak `deploy-config.json` / `app/.env.local`** (powstają po `setup-devnet.ts`).
6. **`anchor-cli` 0.30.1** — na starej maszynie **jest** w `D:\dev-home\.cargo\bin\anchor.exe` (zainstalowane przez `cargo install`, nie AVM). Na nowym PC i tak zainstaluj od zera (`avm install 0.30.1`).
7. **Public repo / wideo demo / eksport PDF** — po stronie submission (user).

---

## 3. CO SKOPIOWAĆ NA NOWY KOMPUTER (obowiązkowe)

`target/` jest w `.gitignore` — **git sam tego nie przeniesie**.

### Minimum (żeby zachować te same Program ID)

```
cały folder blockchain/   (najbezpieczniej ZIP / pendrive / rsync)

OBOWIĄZKOWO wewnątrz:
  target/deploy/aichain-keypair.json
  target/deploy/yield_park-keypair.json
  target/deploy/aichain.so            (opcjonalnie — i tak przebudujesz)
  target/deploy/yield_park.so
  app/src/lib/idl/*.json
  programs/  app/  tests/  scripts/  docs/  Anchor.toml  Cargo.*  package.json ...
```

Bez keypairów deploy wygeneruje **nowe** ID → trzeba zmienić `declare_id!`, `Anchor.toml`, `app/src/lib/ids.ts`, IDL `address`.

### Można pominąć (odtworzysz lokalnie)

```
node_modules/
app/node_modules/
app/.next/
target/debug, target/sb*
D:\dev-home\... (cache Cargo/npm/solana — tylko stary PC)
D:\tools\solana (instalujesz Solana CLI na nowo)
```

### Zalecany transport

1. Spakuj cały `D:\blockchain` **z** `target/deploy/*-keypair.json`.
2. Albo: pierwszy commit na nowym PC + push prywatnego repo + osobno bezpiecznie przenieś keypairy (nie wrzucaj ich do publicznego GitHuba).

---

## 4. Setup na NOWYM komputerze (zalecane: Linux / macOS / Windows z wolnym dyskiem)

### 4.1 Narzędzia

```bash
# Node 18+
node -v

# Rust (rustup)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI (Agave) — aktualna stabilna
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
solana --version
solana config set --url devnet
solana-keygen new   # jeśli brak walletu

# Anchor 0.30.1
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1
avm use 0.30.1
anchor --version   # → 0.30.1
```

Windows: zainstaluj MSVC Build Tools + Windows SDK; unikaj pełnego dysku systemowego (na starej maszynie C: blokował cargo/npm/solana cache).

### 4.2 Projekt

```bash
cd /path/to/blockchain   # skopiowany folder

# Przywróć keypairy pod target/deploy/ JEŚLI nie poszły z kopią
mkdir -p target/deploy
# skopiuj *-keypair.json tutaj

yarn install   # lub npm install (root)
cd app && npm install && cd ..

anchor build
# Sprawdź, że ID się zgadzają:
solana-keygen pubkey target/deploy/aichain-keypair.json
# → CYizbVKeAyuiZUh9RBKhSw9m2o2CzFDxg95yLJWhJvUW
solana-keygen pubkey target/deploy/yield_park-keypair.json
# → H6wcSEryWtp2rmEu56qCi7zXMd6pmrAMH9cKHxDuM4ET

cp target/idl/aichain.json app/src/lib/idl/
cp target/idl/yield_park.json app/src/lib/idl/

anchor test
```

### 4.3 Devnet deploy + UI

```bash
solana airdrop 2   # powtórz jeśli limit
anchor deploy --provider.cluster devnet

ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/setup-devnet.ts
# → tworzy deploy-config.json + demo USDC mint + init park/global

# Ustaw app/.env.local z wartościami z deploy-config.json:
# NEXT_PUBLIC_CLUSTER=devnet
# NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
# NEXT_PUBLIC_USDC_MINT=...
# NEXT_PUBLIC_GLOBAL_PDA=...

cd app && npm run dev
# http://localhost:3000 — Phantom → Devnet
```

Demo path: `docs/DEMO_CHECKLIST.md`.

---

## 5. Specyfika STAREJ maszyny (Windows D:) — tylko kontekst historyczny

**Nie kopiuj tego setupu** na nowy PC, chyba że znowu zabraknie miejsca na C:.

| Ścieżka | Rola |
|---------|------|
| `D:\blockchain` | Kod |
| `D:\dev-home\.cargo` | `CARGO_HOME` |
| `D:\dev-home\.rustup` | `RUSTUP_HOME` (C rustup był kasowany przy czyszczeniu) |
| `D:\dev-home\npm-cache` | npm cache |
| `D:\dev-home\tmp` | TEMP |
| `D:\dev-home\.cache\solana\v1.56\platform-tools` | SBF tools |
| `D:\tools\solana` | Solana CLI 2.1.21 |
| `scripts/env-d-drive.ps1` | Ustawia HOME/CARGO/TEMP na D: |

Build programów, który **zadziałał**:

```powershell
. D:\blockchain\scripts\env-d-drive.ps1
cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\yield_park\Cargo.toml
cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\aichain\Cargo.toml
```

Problemy napotkane: `ENOSPC` na C:, symlink privilege 1314 (użyto `mklink /J`), brak `link.exe`/SDK, zły arch `sbf-solana-solana` → `sbfv2`, edition2024 vs stary rustc → platform-tools v1.56.

---

## 6. TODO na nowym komputerze (kolejność)

- [ ] Skopiować repo **+ keypairy** `target/deploy/*-keypair.json`
- [ ] Zainstalować Rust, Solana, Anchor **0.30.1**, Node 18+
- [ ] `yarn` / `npm install` (root + `app/`)
- [ ] `anchor build` → skopiować IDL do `app/src/lib/idl/`
- [ ] `anchor test` — naprawić jeśli coś padnie
- [ ] `anchor deploy` (devnet) — te same ID dzięki keypairom
- [ ] `npx ts-node scripts/setup-devnet.ts`
- [ ] `app/.env.local` z mint/global PDA
- [ ] `cd app && npm run dev` — smoke test bet/lock/oracle/resolve/claim
- [ ] `git init` commit + prywatny remote (keypairów **nie** publikować)
- [ ] Submission: public repo (bez sekretów), wideo ≤3 min, slajdy (`presentation/`)

---

## 7. Mapa plików (orientacyjna)

```
blockchain/
├── programs/
│   ├── aichain/          # rynek + CPI do yield
│   └── yield_park/       # park APR/shares
├── app/                  # Next.js UI + /api/oracle
├── tests/aichain.ts
├── scripts/
│   ├── setup-devnet.ts
│   ├── demo-prepare.ts
│   ├── env-d-drive.ps1   # tylko stary Windows
│   └── build-programs.ps1
├── docs/
│   ├── HANDOFF.md        # TEN PLIK
│   ├── DESIGN.md
│   ├── PITCH.md
│   ├── ORACLE.md
│   └── DEMO_CHECKLIST.md
├── presentation/slides.md
├── Anchor.toml           # IDs + anchor 0.30.1
├── program-ids.txt
├── aichain.pdf / zasady.pdf
└── target/deploy/        # .so + KEYPAIRS — nie zgubić
```

---

## 8. Szybki sanity-check po przeniesieniu

```bash
grep -r "CYizbVKe" programs Anchor.toml app/src/lib || true
solana-keygen pubkey target/deploy/aichain-keypair.json
# musi = CYizbVKeAyuiZUh9RBKhSw9m2o2CzFDxg95yLJWhJvUW

anchor --version   # 0.30.1
anchor build && anchor test
```

Jeśli keypair zgubiony: wygeneruj nowe, zaktualizuj `declare_id!` w obu `lib.rs`, `Anchor.toml` `[programs.*]`, `program-ids.txt`, `app/src/lib/ids.ts`, pola `address` w IDL.
