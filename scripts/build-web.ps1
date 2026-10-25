<#
.SYNOPSIS
  Build the NeoM web bundle (web/dist) and verify the output.

.DESCRIPTION
  Installs web dependencies (if needed), runs `vite build`, then validates that
  the expected entry points exist. Non-zero exit code on any failure so CI and
  package-all.ps1 can stop early.

  The web build injects VITE_API_BASE; the desktop/mobile shells read it to know
  which backend origin the bundle should talk to.

.PARAMETER ApiBase
  Value for VITE_API_BASE (default https://m.zhengl.vip).

.PARAMETER SkipInstall
  Skip `npm install` (useful for repeated builds).

.PARAMETER Clean
  Remove web/dist before building.

.EXAMPLE
  pwsh scripts/build-web.ps1
  pwsh scripts/build-web.ps1 -ApiBase http://127.0.0.1:3300 -Clean
#>
[CmdletBinding()]
param(
  [string]$ApiBase,
  [switch]$SkipInstall,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $root 'web'
$distDir = Join-Path $webDir 'dist'

# Windows PowerShell 5.1 compatibility (no `??`, no $IsWindows, gb2312 default
# encoding => always write UTF-8 *without* BOM so Node's JSON.parse works).
if (-not $ApiBase) {
  $ApiBase = if ($env:VITE_API_BASE) { $env:VITE_API_BASE } else { 'https://m.zhengl.vip' }
}
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, $script:Utf8NoBom)
}

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }

# --- locate node/npm (this machine does not have them on PATH) ---------------
function Resolve-Tool([string]$name, [string[]]$candidates) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  throw "Cannot find '$name'. Install Node.js 20+ or set NEOM_NODE_DIR."
}

$nodeDir = $env:NEOM_NODE_DIR
$nodeCandidates = @(
  "$nodeDir\node.exe",
  'C:\data\tools\node-v22.14.0-win-x64\node.exe',
  "$env:ProgramFiles\nodejs\node.exe"
) | Where-Object { $_ }
$npmCandidates = @(
  "$nodeDir\npm.cmd",
  'C:\data\tools\node-v22.14.0-win-x64\npm.cmd',
  "$env:ProgramFiles\nodejs\npm.cmd"
) | Where-Object { $_ }

$node = Resolve-Tool 'node.exe' $nodeCandidates
$npm = Resolve-Tool 'npm.cmd' $npmCandidates
$nodeBin = Split-Path -Parent $node
Write-Host "node: $node"
Write-Host "npm : $npm"

# Make node available to child processes that shell out (vite plugins do).
$env:Path = "$nodeBin;$env:Path"

if ($Clean -and (Test-Path $distDir)) {
  Write-Step "Cleaning $distDir"
  Remove-Item -Recurse -Force $distDir
  Write-Ok 'dist removed'
}

if (-not $SkipInstall) {
  Write-Step 'Installing web dependencies (npm install)'
  Push-Location $webDir
  try {
    & cmd /c "`"$npm`" install --no-audit --no-fund 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
    Write-Ok 'dependencies installed'
  } finally { Pop-Location }
}

Write-Step "Building web bundle (VITE_API_BASE=$ApiBase)"
Push-Location $webDir
try {
  $env:VITE_API_BASE = $ApiBase
  & cmd /c "`"$npm`" run build 2>&1"
  $code = $LASTEXITCODE
} finally { Pop-Location }

if ($code -ne 0) {
  Write-Host "`nWEB BUILD FAILED (exit $code)" -ForegroundColor Red
  Write-Host 'If the error points at files owned by another module (e.g. src/features/**, src/styles/shell.css),' -ForegroundColor Yellow
  Write-Host 'that code is incomplete — do not patch it here; report it to the owning module.' -ForegroundColor Yellow
  exit $code
}

Write-Step 'Verifying build output'
$required = @('index.html')
$missing = @()
foreach ($f in $required) {
  if (-not (Test-Path (Join-Path $distDir $f))) { $missing += $f }
}
if ($missing.Count -gt 0) {
  throw "web/dist is missing required files: $($missing -join ', ')"
}
Write-Ok 'web/dist/index.html present'

$assetDir = Join-Path $distDir 'assets'
if (Test-Path $assetDir) {
  $js = @(Get-ChildItem $assetDir -Filter '*.js' -File)
  $css = @(Get-ChildItem $assetDir -Filter '*.css' -File)
  Write-Ok "assets: $($js.Count) js, $($css.Count) css"
  if ($js.Count -eq 0) { Write-Warn2 'no JS chunks found — did the build really succeed?' }
}

$size = (Get-ChildItem $distDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Ok ("bundle size: {0:N2} MB" -f ($size / 1MB))

# Record the API base actually used, so packaging knows what it got.
$stamp = [ordered]@{
  builtAt = (Get-Date).ToString('o')
  apiBase = $ApiBase
  bytes   = $size
  node    = (& $node -v)
}
$stampPath = Join-Path $distDir 'neom-build.json'
Write-Utf8 $stampPath ($stamp | ConvertTo-Json -Depth 4)
Write-Ok "build stamp: $stampPath"

Write-Host "`nWeb build succeeded -> $distDir" -ForegroundColor Green
exit 0
