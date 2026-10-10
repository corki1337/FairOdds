#!/usr/bin/env bash
# Image must contain Node 24, Cargo, Python 3 and compatible cargo-build-sbf.
set -euo pipefail
npm ci --legacy-peer-deps
bash scripts/build-programs.sh
npm run idl:generate
