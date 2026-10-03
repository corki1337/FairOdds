# Build both programs using D: caches only.
# Usage:  . D:\blockchain\scripts\env-d-drive.ps1; D:\blockchain\scripts\build-programs.ps1

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\env-d-drive.ps1"
$env:RUSTUP_HOME = "C:\Users\masta\.rustup"
$env:Path = "C:\Users\masta\.cargo\bin;" + $env:Path

Set-Location (Resolve-Path "$PSScriptRoot\..")

Write-Host "Building yield_park..."
cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\yield_park\Cargo.toml
Write-Host "Building aichain..."
cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\aichain\Cargo.toml

Write-Host "Deploy artifacts:"
Get-ChildItem target\deploy\*.so | Format-Table Name, Length
