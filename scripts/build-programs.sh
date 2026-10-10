#!/usr/bin/env bash
set -euo pipefail
# SBF 1.18 calls the architecture sbfv1; newer CLIs use v0. Default works for both.
build_sbf="${CARGO_BUILD_SBF:-cargo-build-sbf}"
"$build_sbf" --manifest-path programs/aichain/Cargo.toml
"$build_sbf" --manifest-path programs/yield_park/Cargo.toml
