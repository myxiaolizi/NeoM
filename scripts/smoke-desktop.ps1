<#
.SYNOPSIS
  End-to-end smoke test of the NeoM desktop shell (Electron main + preload bridge).

.DESCRIPTION
  Stages desktop/smoke/index.html as the renderer, launches Electron, waits for the
  bridge checks to finish, then prints and asserts on the report the page writes to
  %TEMP%\neom-bridge-report.txt. The original renderer (app-web/) is always restored.

  Checks: window.neom presence, full LocalFileApi parity, fs round-trip over IPC,
  JSON store, recentVaults, app:// static + SPA fallback + 404, the app:// -> backend
  API reverse proxy, window controls, .md association detection, update check.

.PARAMETER Packaged
  Test the packaged build in release/win-x64/win-unpacked instead of a dev Electron.

.PARAMETER TimeoutSec
  Max seconds to wait for the report (default 60).

.EXAMPLE
  pwsh scripts/smoke-desktop.ps1
  pwsh scripts/smoke-desktop.ps1 -Packaged
#>
[CmdletBinding()]
param(
  [switch]$Packaged,
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $root 'desktop'
$appWeb = Join-Path $desktopDir 'app-web'
$smokePage = Join-Path $desktopDir 'smoke\index.html'
$report = Join-Path $env:TEMP 'neom-bridge-report.txt'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Bad([string]$m) { Write-Host "  XX  $m" -ForegroundColor Red }

# Electron refuses to start as a GUI app if this is inherited from a Node-based
# parent shell (it would run main.js as plain Node and crash on `app.isPackaged`).
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:\NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue

if (-not (Test-Path $smokePage)) { throw "smoke page not found: $smokePage" }
if (-not (Test-Path $appWeb)) { New-Item -ItemType Directory -Path $appWeb -Force | Out-Null }

# --- stage -------------------------------------------------------------------
Write-Step 'Staging smoke renderer'
$backup = Join-Path $env:TEMP ('neom-appweb-backup-' + [guid]::NewGuid().ToString('N'))
Copy-Item $appWeb $backup -Recurse -Force
try {
  [System.IO.File]::WriteAllText((Join-Path $appWeb 'index.html'),
    [System.IO.File]::ReadAllText($smokePage, [System.Text.Encoding]::UTF8), $utf8NoBom)
  Write-Ok "index.html replaced (backup: $backup)"

  Remove-Item $report -Force -ErrorAction SilentlyContinue
  $ud = Join-Path $env:TEMP ('neom-smoke-ud-' + [guid]::NewGuid().ToString('N'))
  $errFile = Join-Path $env:TEMP 'neom-smoke-stderr.txt'

  # --- launch ---------------------------------------------------------------
  if ($Packaged) {
    $exe = Join-Path $root 'release\win-x64\win-unpacked\NeoM.exe'
    if (-not (Test-Path $exe)) { throw "packaged build not found: $exe (run package-all.ps1 first)" }
    # The packaged app has app.asar baked in; the staged page only takes effect in
    # a dev launch. Warn instead of silently testing the wrong renderer.
    Write-Bad 'Note: -Packaged runs the asar renderer; the smoke page will NOT be shown.'
    Write-Bad 'Use a dev launch (no -Packaged) to exercise the bridge report.'
    $proc = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$ud" -PassThru -RedirectStandardError $errFile
  } else {
    $electron = Join-Path $desktopDir 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $electron)) { throw "electron not installed: $electron (run npm install in desktop/)" }
    Write-Ok "electron: $electron"
    $proc = Start-Process -FilePath $electron -ArgumentList '.', "--user-data-dir=$ud" `
      -WorkingDirectory $desktopDir -PassThru -RedirectStandardError $errFile
  }

  # --- wait -----------------------------------------------------------------
  Write-Step "Waiting for bridge report (up to ${TimeoutSec}s)"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 700
    if (Test-Path $report) {
      Start-Sleep -Milliseconds 400
      if ((Get-Item $report).Length -gt 0) { break }
    }
    if ($proc.HasExited -and -not (Test-Path $report)) {
      Write-Bad "app exited before writing the report (code $($proc.ExitCode))"
      break
    }
  }
  Start-Sleep -Milliseconds 500
  Get-Process -Id $proc.Id -ErrorAction SilentlyContinue | Stop-Process -Force
  # clean up any child renderer processes
  Get-Process electron, NeoM -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-3) } | Stop-Process -Force -ErrorAction SilentlyContinue

  # --- report ---------------------------------------------------------------
  Write-Step 'Report'
  if (-not (Test-Path $report)) {
    Write-Bad "no report at $report"
    if (Test-Path $errFile) { Write-Host (Get-Content $errFile -Raw) -ForegroundColor DarkYellow }
    exit 1
  }
  $lines = [System.IO.File]::ReadAllLines($report, [System.Text.Encoding]::UTF8)
  foreach ($l in $lines) {
    if ($l -match 'BAD|MISSING|CORRUPTED|ERROR|MISMATCH|^FATAL') { Write-Host "  $l" -ForegroundColor Red }
    elseif ($l -match 'RESULT: PASS') { Write-Host "  $l" -ForegroundColor Green }
    else { Write-Host "  $l" }
  }
  $result = ($lines | Where-Object { $_ -match '^RESULT:' } | Select-Object -Last 1)
  if ($result -match 'PASS') { Write-Host "`nSMOKE TEST PASSED" -ForegroundColor Green; exit 0 }
  Write-Host "`nSMOKE TEST FAILED" -ForegroundColor Red; exit 1
} finally {
  # --- restore --------------------------------------------------------------
  if (Test-Path $backup) {
    Get-ChildItem $appWeb -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $backup '*') $appWeb -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  renderer restored from backup" -ForegroundColor DarkGray
  }
}
