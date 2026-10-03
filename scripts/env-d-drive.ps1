# ALL project caches/toolchain on D: — do not write Solana/Cargo/npm caches to C:
#
#   . D:\blockchain\scripts\env-d-drive.ps1

$ErrorActionPreference = "Continue"

$env:HOME = "D:\dev-home"
$env:CARGO_HOME = "D:\dev-home\.cargo"
$env:NPM_CONFIG_CACHE = "D:\dev-home\npm-cache"
$env:TEMP = "D:\dev-home\tmp"
$env:TMP = "D:\dev-home\tmp"
$env:TMPDIR = "D:\dev-home\tmp"
# Rustup/toolchains MUST live on D: (C: is full). Never fall back to C:.
$env:RUSTUP_HOME = "D:\dev-home\.rustup"
New-Item -ItemType Directory -Force -Path "D:\dev-home\.rustup" | Out-Null
$env:AVM_HOME = "D:\dev-home\.avm"
New-Item -ItemType Directory -Force -Path "D:\dev-home\.avm" | Out-Null

New-Item -ItemType Directory -Force -Path @(
  "D:\dev-home\.cargo", "D:\dev-home\npm-cache", "D:\dev-home\tmp"
) | Out-Null

# Remove any leftover C: solana cache so tools never write there by mistake
if (Test-Path "C:\Users\masta\.cache\solana") {
  $item = Get-Item "C:\Users\masta\.cache\solana" -Force -EA SilentlyContinue
  if ($item.LinkType -eq "Junction") { cmd /c "rmdir `"C:\Users\masta\.cache\solana`"" | Out-Null }
}

$solBin = "D:\tools\solana\bin"
$msvcLinkDir = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64"
$env:Path = "$solBin;$msvcLinkDir;D:\dev-home\.cargo\bin;" + $env:Path

# Platform-tools junction (no symlink privilege needed)
$tools = "D:\dev-home\.cache\solana\v1.56\platform-tools"
$link = "D:\tools\solana\bin\sdk\sbf\dependencies\platform-tools"
New-Item -ItemType Directory -Force -Path (Split-Path $link) | Out-Null
if (Test-Path $link) {
  $i = Get-Item $link -Force
  if ($i.LinkType -eq "Junction") { cmd /c "rmdir `"$link`"" | Out-Null }
  elseif (-not $i.Target) { Remove-Item -Recurse -Force $link -EA SilentlyContinue }
}
if (-not (Test-Path $link) -and (Test-Path $tools)) {
  cmd /c "mklink /J `"$link`" `"$tools`"" | Out-Null
}

# Windows SDK lib paths (read-only system files; project artifacts stay on D:)
$kitRoot = "C:\Program Files (x86)\Windows Kits\10"
$kitVer = "10.0.22621.0"
if (Test-Path "$kitRoot\Lib\$kitVer") {
  $env:LIB = "$kitRoot\Lib\$kitVer\um\x64;$kitRoot\Lib\$kitVer\ucrt\x64;" + $env:LIB
  $env:INCLUDE = "$kitRoot\Include\$kitVer\um;$kitRoot\Include\$kitVer\ucrt;$kitRoot\Include\$kitVer\shared;" + $env:INCLUDE
}
$msvcRoot = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207"
if (Test-Path $msvcRoot) {
  $env:LIB = "$msvcRoot\lib\x64;" + $env:LIB
  $env:INCLUDE = "$msvcRoot\include;" + $env:INCLUDE
}

# Do not force rust-lld — use real MSVC link.exe
Remove-Item "D:\dev-home\.cargo\config.toml" -EA SilentlyContinue

# Prefer D: cargo bin; do not pull C:\Users\...\cargo into PATH (writes land on C:).
# Do not set USERPROFILE to D: — breaks Windows/VS paths.

Write-Host "HOME=$env:HOME  CARGO_HOME=$env:CARGO_HOME  RUSTUP_HOME=$env:RUSTUP_HOME  TEMP=$env:TEMP"
Write-Host "solana: $(solana --version 2>$null)"
Write-Host "rustc: $(rustc --version 2>$null)"
Write-Host "link: $(where.exe link 2>$null | Select-Object -First 1)"
Write-Host "kernel32: $(Test-Path "$kitRoot\Lib\$kitVer\um\x64\kernel32.Lib")"
Write-Host "Build: cargo-build-sbf --tools-version v1.56 --arch sbfv2 --manifest-path programs\<name>\Cargo.toml"
