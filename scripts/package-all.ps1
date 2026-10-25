<#
.SYNOPSIS
  One-shot packaging pipeline for NeoM: web -> desktop (win/mac) -> mobile sync.

.DESCRIPTION
  Produces everything this machine can produce into release/<platform>/ and
  clearly reports what needs another toolchain.

  Stages:
    1. web       build web/dist                    (always)
    2. win       electron-builder --win nsis+zip+portable -> release/win-x64/
    3. mac       electron-builder --mac (needs macOS; skipped on Windows unless -ForceMac)
    4. mobile    cap sync (web assets) -> release/mobile/  (apk/ipa need SDK/Xcode)
    5. manifest  sha256 + sizes -> release/manifest.json

.PARAMETER SkipWeb
  Reuse the existing web/dist.

.PARAMETER Target
  all | win | mac | mobile  (default all)

.PARAMETER ApiBase
  VITE_API_BASE for the web build (default https://m.zhengl.vip).

.PARAMETER ForceMac
  Try the mac target even when not on macOS (will fail without macOS tooling).

.EXAMPLE
  pwsh scripts/package-all.ps1
  pwsh scripts/package-all.ps1 -Target win -SkipWeb
#>
[CmdletBinding()]
param(
  [ValidateSet('all', 'win', 'mac', 'mobile')]
  [string]$Target = 'all',
  [string]$ApiBase,
  [switch]$SkipWeb,
  [switch]$SkipInstall,
  [switch]$ForceMac
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root 'release'
$desktopDir = Join-Path $root 'desktop'
$mobileDir = Join-Path $root 'mobile'
$startedAt = Get-Date

# --- Windows PowerShell 5.1 compatibility -----------------------------------
# 5.1 has no `??`, no $IsWindows/$IsMacOS, and its default encoding is the ANSI
# code page (gb2312 here) — so every UTF-8 file must be written through .NET with
# an explicit BOM-less encoder or Node's JSON.parse will choke on the BOM.
if (-not $ApiBase) {
  $ApiBase = if ($env:VITE_API_BASE) { $env:VITE_API_BASE } else { 'https://m.zhengl.vip' }
}
$script:OnWindows = ($env:OS -eq 'Windows_NT')
$script:OnMac = (-not $script:OnWindows) -and ([System.Environment]::OSVersion.Platform -eq 'Unix') -and [bool](Get-Command sw_vers -ErrorAction SilentlyContinue)
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, $script:Utf8NoBom)
}

# Resolve the PowerShell host used to invoke sibling scripts. This box only has
# Windows PowerShell 5.1 (no `pwsh`), while CI has PowerShell 7 — support both.
$script:PsHost = (Get-Process -Id $PID).Path
if (-not $script:PsHost -or -not (Test-Path $script:PsHost)) {
  $pwshCmd = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  $script:PsHost = if ($pwshCmd) { $pwshCmd.Source } else { Join-Path $PSHOME 'powershell.exe' }
}
function Invoke-ScriptFile([string]$Path, [hashtable]$Params) {
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Path)
  foreach ($k in $Params.Keys) {
    $v = $Params[$k]
    if ($v -is [switch] -or $v -is [bool]) {
      if ($v) { $argList += "-$k" }
    } else {
      $argList += @("-$k", [string]$v)
    }
  }
  & $script:PsHost @argList
  return $LASTEXITCODE
}

function Write-Step([string]$m) { Write-Host "`n=== $m " -ForegroundColor Cyan; Write-Host ('=' * (74 - $m.Length)) -ForegroundColor DarkCyan }
function Write-Ok([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Skip([string]$m) { Write-Host "  --  $m" -ForegroundColor DarkGray }
function Write-Warn2([string]$m) { Write-Host "  !!  $m" -ForegroundColor Yellow }
function Write-Fail([string]$m) { Write-Host "  XX  $m" -ForegroundColor Red }

# ---- toolchain ---------------------------------------------------------------
$nodeDir = $env:NEOM_NODE_DIR
$node = @("$nodeDir\node.exe", 'C:\data\tools\node-v22.14.0-win-x64\node.exe', "$env:ProgramFiles\nodejs\node.exe") |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $node) {
  $c = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($c) { $node = $c.Source }
}
if (-not $node) { throw 'node.exe not found — install Node 20+ or set NEOM_NODE_DIR' }
$nodeBin = Split-Path -Parent $node
$npm = Join-Path $nodeBin 'npm.cmd'
$env:Path = "$nodeBin;$env:Path"
Write-Host "node: $node"

# Results collected for the final report + manifest.
$artifacts = New-Object System.Collections.Generic.List[object]
$failures = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

function Add-Artifact([string]$platform, [string]$path) {
  if (-not (Test-Path $path)) { return }
  $item = Get-Item $path
  $hash = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
  $artifacts.Add([pscustomobject]@{
      platform    = $platform
      filename    = $item.Name
      path        = ($path.Substring($root.Length + 1) -replace '\\', '/')
      size        = $item.Length
      size_human  = '{0:N2} MB' -f ($item.Length / 1MB)
      sha256      = $hash
      modified_at = $item.LastWriteTime.ToString('o')
    })
}

# ---- 1. web ------------------------------------------------------------------
if (-not $SkipWeb) {
  Write-Step 'STAGE 1/5  Web build'
  $script = Join-Path $PSScriptRoot 'build-web.ps1'
  $webArgs = @{ ApiBase = $ApiBase }
  if ($SkipInstall) { $webArgs.SkipInstall = $true }
  $webExit = Invoke-ScriptFile $script $webArgs
  if ($webExit -ne 0) {
    Write-Fail "web build failed (exit $webExit) — desktop/mobile stages need web/dist"
    $failures.Add('web: build failed — see output above')
  } else {
    Write-Ok 'web/dist ready'
  }
} else {
  Write-Step 'STAGE 1/5  Web build (skipped)'
  if (-not (Test-Path (Join-Path $root 'web\dist\index.html'))) {
    Write-Warn2 'web/dist/index.html missing even with -SkipWeb'
    $failures.Add('web: dist missing')
  } else {
    Write-Skip 'using existing web/dist'
  }
}

$webReady = Test-Path (Join-Path $root 'web\dist\index.html')

# ---- 2. desktop dependencies -------------------------------------------------
if ($Target -in @('all', 'win', 'mac')) {
  Write-Step 'STAGE 2/5  Desktop dependencies'
  if (-not (Test-Path (Join-Path $desktopDir 'node_modules\electron'))) {
    Push-Location $desktopDir
    try {
      & cmd /c "`"$npm`" install --no-audit --no-fund 2>&1"
      if ($LASTEXITCODE -ne 0) {
        Write-Fail "desktop npm install failed (exit $LASTEXITCODE)"
        $failures.Add('desktop: npm install failed')
      } else { Write-Ok 'desktop deps installed' }
    } finally { Pop-Location }
  } else {
    Write-Skip 'desktop node_modules present'
  }

  if (-not (Test-Path (Join-Path $root 'assets\icon.ico'))) {
    Write-Host '  generating icons...'
    & $node (Join-Path $PSScriptRoot 'make-icons.mjs')
  }
}

function Build-Desktop([string]$Platform) {
  $outDir = Join-Path $releaseDir $(if ($Platform -eq 'win') { 'win-x64' } else { 'mac' })
  Write-Step "STAGE Desktop  electron-builder --$Platform  -> $outDir"
  Push-Location $desktopDir
  try {
    $env:NEOM_OUT_DIR = $outDir
    & $node prepare-web.mjs
    if ($LASTEXITCODE -ne 0) { throw "prepare-web failed (exit $LASTEXITCODE)" }
    if ($webReady) { Write-Ok 'web bundle staged into desktop/app-web' }
    else { Write-Warn2 'staged the fallback loader page (web build missing)' }

    $builderArgs = if ($Platform -eq 'win') { '--win --x64' } else { '--mac' }
    & $node "node_modules\electron-builder\cli.js" --config builder.config.js @($builderArgs -split ' ')
    $code = $LASTEXITCODE
    if ($code -ne 0) {
      # Fresh machines often cannot reach GitHub for the electron/rcedit/nsis
      # binaries; retry once through the local proxy before giving up.
      Write-Warn2 "electron-builder exit $code — retrying once with a proxy (127.0.0.1:1886)"
      $env:HTTP_PROXY = 'http://127.0.0.1:1886'
      $env:HTTPS_PROXY = 'http://127.0.0.1:1886'
      & $node "node_modules\electron-builder\cli.js" --config builder.config.js @($builderArgs -split ' ')
      $code = $LASTEXITCODE
      Remove-Item Env:\HTTP_PROXY, Env:\HTTPS_PROXY -ErrorAction SilentlyContinue
    }

    if ($code -ne 0) {
      Write-Fail "electron-builder failed for $Platform (exit $code)"
      $failures.Add("desktop-${Platform}: electron-builder exit $code")
      return
    }
    Get-ChildItem $outDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in '.exe', '.zip', '.dmg', '.blockmap', '.yml' } |
      ForEach-Object {
        $label = if ($Platform -eq 'win') {
          if ($_.Name -like '*setup*') { 'win-x64' }
          elseif ($_.Name -like '*green*') { 'win-green' }
          elseif ($_.Name -like '*portable*') { 'win-x64' }
          else { 'win-x64' }
        } else { if ($_.Name -like '*arm64*') { 'mac-arm64' } else { 'mac-x64' } }
        Add-Artifact $label $_.FullName
        Write-Ok "$($_.Name)  ($('{0:N2} MB' -f ($_.Length / 1MB)))"
      }
  } catch {
    Write-Fail "${Platform}: $($_.Exception.Message)"
    $failures.Add("desktop-${Platform}: $($_.Exception.Message)")
  } finally {
    Remove-Item Env:\NEOM_OUT_DIR -ErrorAction SilentlyContinue
    Pop-Location
  }
}

if ($Target -in @('all', 'win')) { Build-Desktop 'win' }

if ($Target -in @('all', 'mac')) {
  if ($script:OnWindows -and -not $ForceMac) {
    Write-Step 'STAGE  electron-builder --mac'
    Write-Skip 'skipped: macOS artifacts can only be produced on macOS (use CI macos runner)'
    $skipped.Add('desktop-mac: requires macOS runner (see .github/workflows/build.yml)')
  } else {
    Build-Desktop 'mac'
  }
}

# ---- 3. mobile ---------------------------------------------------------------
if ($Target -in @('all', 'mobile')) {
  Write-Step 'STAGE 4/5  Mobile (Capacitor sync)'
  if (-not (Test-Path (Join-Path $mobileDir 'node_modules\@capacitor\cli'))) {
    Push-Location $mobileDir
    try {
      & cmd /c "`"$npm`" install --no-audit --no-fund 2>&1"
      if ($LASTEXITCODE -ne 0) {
        Write-Warn2 "mobile npm install failed (exit $LASTEXITCODE)"
        $failures.Add('mobile: npm install failed')
      }
    } finally { Pop-Location }
  }

  if (Test-Path (Join-Path $mobileDir 'node_modules\@capacitor\cli')) {
    Push-Location $mobileDir
    try {
      & cmd /c "`"$node`" prepare-web.mjs 2>&1"
      Write-Ok 'web assets validated for Capacitor'
      if (Test-Path (Join-Path $mobileDir 'android\app\build.gradle')) {
        & cmd /c "`"$npm`" exec -- cap sync android 2>&1"
        if ($LASTEXITCODE -eq 0) { Write-Ok 'cap sync android' } else { Write-Warn2 'cap sync android failed' }
      } else {
        Write-Skip 'android project not generated — run `npx cap add android` in mobile/ (needs Android SDK)'
        $skipped.Add('mobile-android: run `npx cap add android` + gradle on a machine with Android SDK')
      }
      if (Test-Path (Join-Path $mobileDir 'ios\App')) {
        if ($script:OnMac) { & cmd /c "`"$npm`" exec -- cap sync ios 2>&1" } else { Write-Skip 'ios sync needs macOS' }
      } else {
        Write-Skip 'ios project not generated — run `npx cap add ios` on macOS'
        $skipped.Add('mobile-ios: requires macOS + Xcode')
      }
      # Ship the syncable web bundle so a build machine can package immediately.
      $mobileOut = Join-Path $releaseDir 'mobile'
      New-Item -ItemType Directory -Path $mobileOut -Force | Out-Null
      if ($webReady) {
        $zip = Join-Path $mobileOut 'NeoM-web-assets.zip'
        if (Test-Path $zip) { Remove-Item $zip -Force }
        Compress-Archive -Path (Join-Path $root 'web\dist\*') -DestinationPath $zip -CompressionLevel Optimal
        Add-Artifact 'android' $zip
        Write-Ok "NeoM-web-assets.zip ($('{0:N2} MB' -f ((Get-Item $zip).Length / 1MB)))"
      }
    } finally { Pop-Location }
  } else {
    Write-Warn2 'mobile dependencies unavailable'
  }
}

# ---- 4. manifest -------------------------------------------------------------
Write-Step 'STAGE 5/5  Writing release/manifest.json'
$version = (& $node -p "require('$($desktopDir -replace '\\','/')/package.json').version").Trim()
$manifest = [ordered]@{
  product      = 'NeoM'
  version      = $version
  generated_at = (Get-Date).ToString('o')
  builder      = "package-all.ps1 on $($env:COMPUTERNAME) ($([System.Environment]::OSVersion.VersionString))"
  api_base     = $ApiBase
  artifacts    = @($artifacts.ToArray())
  skipped      = @($skipped.ToArray())
  failures     = @($failures.ToArray())
}
$manifestPath = Join-Path $releaseDir 'manifest.json'
# ConvertTo-Json in Windows PowerShell 5.1 cannot serialize generic List<T>
# directly — a plain array (via .ToArray()) is required.
Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 8)
Write-Ok "manifest: $manifestPath"

# ---- report ------------------------------------------------------------------
$elapsed = (Get-Date) - $startedAt
Write-Host "`n" + ('#' * 70) -ForegroundColor Cyan
Write-Host ' PACKAGE SUMMARY' -ForegroundColor Cyan
Write-Host ('#' * 70) -ForegroundColor Cyan
if ($artifacts.Count) {
  $artifacts | Format-Table platform, filename, size_human, sha256 -AutoSize | Out-String -Width 200 | Write-Host
} else {
  Write-Warn2 'no artifacts produced'
}
if ($skipped.Count) { Write-Host "`nSkipped (needs another toolchain / runner):" -ForegroundColor Yellow; $skipped | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow } }
if ($failures.Count) { Write-Host "`nFailures:" -ForegroundColor Red; $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red } }
Write-Host ("`nElapsed: {0:mm\:ss}" -f $elapsed)
Write-Host "Release dir: $releaseDir`n"

if ($failures.Count) { exit 1 } else { exit 0 }
