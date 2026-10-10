# Use an installed compatible Agave/Solana SBF toolchain; preserve the caller's cache setup.
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot\..")
$fairOddsBuildSbf = if ($env:CARGO_BUILD_SBF) { $env:CARGO_BUILD_SBF } else { "cargo-build-sbf" }
& $fairOddsBuildSbf --manifest-path programs/aichain/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "aichain SBF build failed" }
& $fairOddsBuildSbf --manifest-path programs/yield_park/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "yield_park SBF build failed" }
Get-ChildItem target/deploy/*.so | Format-Table Name, Length
