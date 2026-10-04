# HANDOFF â€” przeniesienie projektu na inny komputer

**Data stanu:** 2026-10-03  
**Maszyna ĹşrĂłdĹ‚owa:** Windows, dysk `D:\blockchain` (C: byĹ‚ peĹ‚ny ~2â€“4 GB free)  
**Repo git:** lokalny, **brak commitĂłw** (`master` pusty) i **brak remote** â€” nie ma nic na GitHubie.

Ten plik = jedyne ĹşrĂłdĹ‚o prawdy â€žco jest, czego brakuje, jak odpaliÄ‡ gdzie indziejâ€ť.

---

## 1. Co to jest

MVP na Superteam Poland â€” *Finance Without Intermediaries*:

- Pari-mutuel binary markets (Team A / Team B), np. NaVi vs FaZe
- Program `aichain` â€” rynki, bety, lock, oracle, resolve, claim, refund
- Program `yield_park` â€” mikro-yield (APR/shares); przy lock CPI deposit, przy resolve withdraw
- Next.js app (`app/`) â€” lista rynkĂłw, bet/claim, admin, API oracle
- Dokumenty pitch/design/demo w `docs/` + slajdy w `presentation/`

Briefy ĹşrĂłdĹ‚owe (PDF w root): `aichain.pdf`, `zasady.pdf`.

---

## 2. Co JEST zrobione (kod / artefakty)

### On-chain (Anchor 0.30.1)

| Program | `declare_id!` / Program ID |
|---------|----------------------------|
| `aichain` | `4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg` |
| `yield_park` | `6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS` |

**Instrukcje `aichain`:**  
`initialize_global`, `initialize_market`, `place_bet`, `lock_market`, `set_oracle_result`, `resolve_market`, `claim_winnings`, `refund`, `harvest_to_treasury`

**Instrukcje `yield_park`:**  
`initialize_park`, `seed_reserve`, `deposit`, `withdraw`

**Sklompilowane binarki (ta maszyna):**

```
target/deploy/aichain.so              (~437 KB)
target/deploy/yield_park.so           (~296 KB)
target/deploy/aichain-keypair.json    â† KRYTYCZNE
target/deploy/yield_park-keypair.json â† KRYTYCZNE
```

Build na Windows wymagaĹ‚ obejĹ›cia: `cargo-build-sbf --tools-version v1.56 --arch sbfv2` (patrz `scripts/build-programs.ps1`). Na Linuxie zwykle wystarczy normalne `anchor build`.

### Frontend (`app/`)

- Next.js + wallet-adapter (Phantom) + TanStack Query (wg planu)
- Strony: `/`, `/markets/[id]`, `/admin`
- Oracle HTTP: `app/src/app/api/oracle/[matchId]/route.ts`
- Stub IDL (rÄ™cznie / skopiowane): `app/src/lib/idl/aichain.json`, `yield_park.json`
- IDs: `app/src/lib/ids.ts`

### Skrypty / testy / docs

| Plik | Status |
|------|--------|
| `tests/aichain.ts` | Napisany; **nie odpalony** (brak peĹ‚nego `anchor test`) |
| `scripts/setup-devnet.ts` | Napisany; **nie odpalony** na ĹĽywym devnet |
| `scripts/demo-prepare.ts` | Napisany |
| `scripts/env-d-drive.ps1` | Tylko stary Windows z peĹ‚nym C: â€” na nowym PC zwykle zbÄ™dny |
| `scripts/build-programs.ps1` | Windows D:-only build |
| `docs/DESIGN.md`, `PITCH.md`, `ORACLE.md`, `DEMO_CHECKLIST.md` | Jest |
| `presentation/slides.md` | Jest |
| `README.md` | OgĂłlny + notatki Windows |

### Czego NIE ma / nie dokoĹ„czono

1. **Brak git commit + brak GitHub remote** â€” caĹ‚y projekt tylko lokalnie.
2. **Brak deploy na devnet** â€” programy nie sÄ… on-chain.
3. **`anchor test` nie przechodziĹ‚** (toolchain Windows/C: full).
4. **Brak wygenerowanych oficjalnych IDL / `target/types/*.ts`** z `anchor build` â€” app uĹĽywa stub IDL; `setup-devnet.ts` importuje `../target/types/...` â†’ po Ĺ›wieĹĽym `anchor build` typy siÄ™ pojawiÄ….
5. **Brak `deploy-config.json` / `app/.env.local`** (powstajÄ… po `setup-devnet.ts`).
6. **`anchor-cli` 0.30.1** â€” na starej maszynie **jest** w `D:\dev-home\.cargo\bin\anchor.exe` (zainstalowane przez `cargo install`, nie AVM). Na nowym PC i tak zainstaluj od zera (`avm install 0.30.1`).
7. **Public repo / wideo demo / eksport PDF** â€” po stronie submission (user).

---

## 3. CO SKOPIOWAÄ† NA NOWY KOMPUTER (obowiÄ…zkowe)

`target/` jest w `.gitignore` â€” **git sam tego nie przeniesie**.

### Minimum (ĹĽeby zachowaÄ‡ te same Program ID)

```
caĹ‚y folder blockchain/   (najbezpieczniej ZIP / pendrive / rsync)

OBOWIÄ„ZKOWO wewnÄ…trz:
  target/deploy/aichain-keypair.json
  target/deploy/yield_park-keypair.json
  target/deploy/aichain.so            (opcjonalnie â€” i tak przebudujesz)
  target/deploy/yield_park.so
  app/src/lib/idl/*.json
  programs/  app/  tests/  scripts/  docs/  Anchor.toml  Cargo.*  package.json ...
```

Bez keypairĂłw deploy wygeneruje **nowe** ID â†’ trzeba zmieniÄ‡ `declare_id!`, `Anchor.toml`, `app/src/lib/ids.ts`, IDL `address`.

### MoĹĽna pominÄ…Ä‡ (odtworzysz lokalnie)

```
node_modules/
app/node_modules/
app/.next/
target/debug, target/sb*
D:\dev-home\... (cache Cargo/npm/solana â€” tylko stary PC)
D:\tools\solana (instalujesz Solana CLI na nowo)
```

### Zalecany transport

1. Spakuj caĹ‚y `D:\blockchain` **z** `target/deploy/*-keypair.json`.
2. Albo: pierwszy commit na nowym PC + push prywatnego repo + osobno bezpiecznie przenieĹ› keypairy (nie wrzucaj ich do publicznego GitHuba).

---

## 4. Setup na NOWYM komputerze (zalecane: Linux / macOS / Windows z wolnym dyskiem)

### 4.1 NarzÄ™dzia

```bash
# Node 18+
node -v

# Rust (rustup)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI (Agave) â€” aktualna stabilna
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
solana --version
solana config set --url devnet
solana-keygen new   # jeĹ›li brak walletu

# Anchor 0.30.1
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1
avm use 0.30.1
anchor --version   # â†’ 0.30.1
```

Windows: zainstaluj MSVC Build Tools + Windows SDK; unikaj peĹ‚nego dysku systemowego (na starej maszynie C: blokowaĹ‚ cargo/npm/solana cache).

### 4.2 Projekt

```bash
cd /path/to/blockchain   # skopiowany folder

# PrzywrĂłÄ‡ keypairy pod target/deploy/ JEĹšLI nie poszĹ‚y z kopiÄ…
mkdir -p target/deploy
# skopiuj *-keypair.json tutaj

yarn install   # lub npm install (root)
cd app && npm install && cd ..

anchor build
# SprawdĹş, ĹĽe ID siÄ™ zgadzajÄ…:
solana-keygen pubkey target/deploy/aichain-keypair.json
# â†’ 4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg
solana-keygen pubkey target/deploy/yield_park-keypair.json
# â†’ 6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS

cp target/idl/aichain.json app/src/lib/idl/
cp target/idl/yield_park.json app/src/lib/idl/

anchor test
```

### 4.3 Devnet deploy + UI

```bash
solana airdrop 2   # powtĂłrz jeĹ›li limit
anchor deploy --provider.cluster devnet

ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/setup-devnet.ts
# â†’ tworzy deploy-config.json + demo USDC mint + init park/global

# Ustaw app/.env.local z wartoĹ›ciami z deploy-config.json:
# NEXT_PUBLIC_CLUSTER=devnet
# NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
# NEXT_PUBLIC_USDC_MINT=...
# NEXT_PUBLIC_GLOBAL_PDA=...

cd app && npm run dev
# http://localhost:3000 â€” Phantom â†’ Devnet
```

Demo path: `docs/DEMO_CHECKLIST.md`.

---

## 5. Specyfika STAREJ maszyny (Windows D:) â€” tylko kontekst historyczny

**Nie kopiuj tego setupu** na nowy PC, chyba ĹĽe znowu zabraknie miejsca na C:.

| ĹšcieĹĽka | Rola |
|---------|------|
| `D:\blockchain` | Kod |
| `D:\dev-home\.cargo` | `CARGO_HOME` |
| `D:\dev-home\.rustup` | `RUSTUP_HOME` (C rustup byĹ‚ kasowany przy czyszczeniu) |
| `D:\dev-home\npm-cache` | npm cache |
| `D:\dev-home\tmp` | TEMP |
| `D:\dev-home\.cache\solana\v1.56\platform-tools` | SBF tools |
| `D:\tools\solana` | Solana CLI 2.1.21 |
| `scripts/env-d-drive.ps1` | Ustawia HOME/CARGO/TEMP na D: |

Build programĂłw, ktĂłry **zadziaĹ‚aĹ‚**:

```powershell
. D:\blockchain\scripts\env-d-drive.ps1
cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\yield_park\Cargo.toml
cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\aichain\Cargo.toml
```

Problemy napotkane: `ENOSPC` na C:, symlink privilege 1314 (uĹĽyto `mklink /J`), brak `link.exe`/SDK, zĹ‚y arch `sbf-solana-solana` â†’ `sbfv2`, edition2024 vs stary rustc â†’ platform-tools v1.56.

---

## 6. TODO na nowym komputerze (kolejnoĹ›Ä‡)

- [ ] SkopiowaÄ‡ repo **+ keypairy** `target/deploy/*-keypair.json`
- [ ] ZainstalowaÄ‡ Rust, Solana, Anchor **0.30.1**, Node 18+
- [ ] `yarn` / `npm install` (root + `app/`)
- [ ] `anchor build` â†’ skopiowaÄ‡ IDL do `app/src/lib/idl/`
- [ ] `anchor test` â€” naprawiÄ‡ jeĹ›li coĹ› padnie
- [ ] `anchor deploy` (devnet) â€” te same ID dziÄ™ki keypairom
- [ ] `npx ts-node scripts/setup-devnet.ts`
- [ ] `app/.env.local` z mint/global PDA
- [ ] `cd app && npm run dev` â€” smoke test bet/lock/oracle/resolve/claim
- [ ] `git init` commit + prywatny remote (keypairĂłw **nie** publikowaÄ‡)
- [ ] Submission: public repo (bez sekretĂłw), wideo â‰¤3 min, slajdy (`presentation/`)

---

## 7. Mapa plikĂłw (orientacyjna)

```
blockchain/
â”śâ”€â”€ programs/
â”‚   â”śâ”€â”€ aichain/          # rynek + CPI do yield
â”‚   â””â”€â”€ yield_park/       # park APR/shares
â”śâ”€â”€ app/                  # Next.js UI + /api/oracle
â”śâ”€â”€ tests/aichain.ts
â”śâ”€â”€ scripts/
â”‚   â”śâ”€â”€ setup-devnet.ts
â”‚   â”śâ”€â”€ demo-prepare.ts
â”‚   â”śâ”€â”€ env-d-drive.ps1   # tylko stary Windows
â”‚   â””â”€â”€ build-programs.ps1
â”śâ”€â”€ docs/
â”‚   â”śâ”€â”€ HANDOFF.md        # TEN PLIK
â”‚   â”śâ”€â”€ DESIGN.md
â”‚   â”śâ”€â”€ PITCH.md
â”‚   â”śâ”€â”€ ORACLE.md
â”‚   â””â”€â”€ DEMO_CHECKLIST.md
â”śâ”€â”€ presentation/slides.md
â”śâ”€â”€ Anchor.toml           # IDs + anchor 0.30.1
â”śâ”€â”€ program-ids.txt
â”śâ”€â”€ aichain.pdf / zasady.pdf
â””â”€â”€ target/deploy/        # .so + KEYPAIRS â€” nie zgubiÄ‡
```

---

## 8. Szybki sanity-check po przeniesieniu

```bash
grep -r "CYizbVKe" programs Anchor.toml app/src/lib || true
solana-keygen pubkey target/deploy/aichain-keypair.json
# musi = 4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg

anchor --version   # 0.30.1
anchor build && anchor test
```

JeĹ›li keypair zgubiony: wygeneruj nowe, zaktualizuj `declare_id!` w obu `lib.rs`, `Anchor.toml` `[programs.*]`, `program-ids.txt`, `app/src/lib/ids.ts`, pola `address` w IDL.
