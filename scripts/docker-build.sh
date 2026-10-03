#!/usr/bin/env bash
# Build programs inside Docker (avoids Windows MSVC/SDK issues).
# Usage (PowerShell):
#   docker run --rm -v D:/blockchain:/work -w /work $(Get-Content .docker-build-image) bash scripts/docker-build.sh
set -euo pipefail

echo "==> toolchain"
solana --version || true
anchor --version || true
rustc --version || true

echo "==> yarn/npm deps (root)"
if command -v yarn >/dev/null 2>&1; then
  yarn install --frozen-lockfile || yarn install
else
  npm install
fi

echo "==> anchor build"
if command -v anchor >/dev/null 2>&1; then
  anchor build
else
  echo "anchor CLI missing; using cargo-build-sbf"
  cargo-build-sbf --manifest-path programs/yield_park/Cargo.toml -- --locked
  cargo-build-sbf --manifest-path programs/aichain/Cargo.toml -- --locked
fi

echo "==> copy idls to app"
mkdir -p app/src/lib/idl
cp -f target/idl/aichain.json app/src/lib/idl/ 2>/dev/null || true
cp -f target/idl/yield_park.json app/src/lib/idl/ 2>/dev/null || true
ls -la target/deploy || true
echo "DONE"
