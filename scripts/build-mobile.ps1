<#
.SYNOPSIS
  Build NeoM for Android on Windows (apk / aab). iOS is not possible on Windows.

.DESCRIPTION
  Full pipeline: verify web bundle -> cap sync -> overlay maintained native files
  -> gradle assemble. Requires JDK 17 and the Android SDK.

.PARAMETER Platform
  android (only). Kept for call-site symmetry with build-mobile.sh.

.PARAMETER Mode
  apk | aab | debug  (default apk)

.EXAMPLE
  pwsh scripts/build-mobile.ps1
  pwsh scripts/build-mobile.ps1 -Mode aab
  pwsh scripts/build-mobile.ps1 -Mode debug
#>
[CmdletBinding()]
param(
  [ValidateSet('android', 'ios')]
  [string]$Platform = 'android',
  [ValidateSet('apk', 'aab', 'debug')]
  [string]$Mode = 'apk',
  [switch]$SkipSync
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mobileDir = Join-Path $root 'mobile'
$releaseDir = Join-Path $root 'release\android'
$script:OnWindows = ($env:OS -eq 'Windows_NT')

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Warn2([string]$m) { Write-Host "  !!  $m" -ForegroundColor Yellow }
function Die([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

if ($Platform -eq 'ios') {
  Die @'
iOS builds require macOS + Xcode and cannot run on Windows.
Use a macOS machine or the GitHub Actions workflow (.github/workflows/build.yml, job "ios"):
    git tag v1.0.0 && git push origin v1.0.0
See docs/MOBILE-BUILD.md §3 for the manual macOS steps.
'@
}

# --- toolchain ---------------------------------------------------------------
$node = $null
$nodeCandidates = @()
if ($env:NEOM_NODE_DIR) { $nodeCandidates += (Join-Path $env:NEOM_NODE_DIR 'node.exe') }
$nodeCandidates += 'C:\data\tools\node-v22.14.0-win-x64\node.exe'
$nodeCandidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
foreach ($c in $nodeCandidates) {
  if ($c -and (Test-Path $c)) { $node = $c; break }
}
if (-not $node) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
if (-not $node) { Die 'node.exe not found — install Node 20+ or set NEOM_NODE_DIR' }
$nodeBin = Split-Path -Parent $node
$npm = Join-Path $nodeBin 'npm.cmd'
$env:Path = "$nodeBin;$env:Path"
Write-Host "node: $node"

Write-Step 'Preflight'
if (-not (Test-Path (Join-Path $root 'web\dist\index.html'))) {
  Die 'web/dist missing — run `pwsh scripts/build-web.ps1` first'
}
Write-Ok 'web bundle present'

$java = Get-Command java.exe -ErrorAction SilentlyContinue
if (-not $java) {
  Write-Warn2 'java.exe not found — Gradle needs JDK 17. Set JAVA_HOME and add %JAVA_HOME%\bin to PATH.'
} else {
  $jv = (& java -version 2>&1 | Select-Object -First 1)
  Write-Ok "java: $jv"
}

$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (Test-Path $sdk) {
  $env:ANDROID_HOME = $sdk
  $env:ANDROID_SDK_ROOT = $sdk
  Write-Ok "ANDROID_HOME=$sdk"
} else {
  Write-Warn2 "Android SDK not found (looked for $sdk). Install it or set ANDROID_HOME."
}

# --- native project ----------------------------------------------------------
$gradlew = Join-Path $mobileDir 'android\gradlew.bat'
if (-not (Test-Path $gradlew)) {
  Write-Step 'Generating Android platform project'
  Push-Location $mobileDir
  try {
    if (-not (Test-Path (Join-Path $mobileDir 'node_modules\@capacitor\cli'))) {
      & cmd /c "`"$npm`" install --no-audit --no-fund 2>&1"
      if ($LASTEXITCODE -ne 0) { Die "npm install failed (exit $LASTEXITCODE)" }
    }
    & cmd /c "`"$npm`" exec -- cap add android 2>&1"
    if ($LASTEXITCODE -ne 0) {
      Die @'
`cap add android` failed. This needs the Android SDK + JDK 17 installed and
ANDROID_HOME set. The maintained native files (AndroidManifest.xml, styles.xml,
MainActivity.kt, file_paths.xml) are already in mobile/android/app/src/main/ and
will be applied automatically once the project exists.
'@
    }
    Write-Ok 'android project generated'
  } finally { Pop-Location }
} else {
  Write-Ok 'android project present'
}

# --- sync --------------------------------------------------------------------
if (-not $SkipSync) {
  Write-Step 'Syncing Capacitor project'
  Push-Location $mobileDir
  try {
    & cmd /c "`"$node`" prepare-web.mjs 2>&1"
    if ($LASTEXITCODE -ne 0) { Die 'prepare-web failed' }
    & cmd /c "`"$npm`" exec -- cap sync android 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Warn2 'cap sync reported problems (continuing)' }
    Write-Ok 'cap sync android'
  } finally { Pop-Location }

  Write-Step 'Overlaying maintained native files'
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'sync-mobile-native.ps1') -Platform android
}

# --- gradle ------------------------------------------------------------------
Write-Step "Building Android ($Mode)"
$task = switch ($Mode) {
  'aab' { 'bundleRelease' }
  'apk' { if ($env:NEOM_KEYSTORE_PATH) { 'assembleRelease' } else { Write-Warn2 'NEOM_KEYSTORE_PATH not set — building a DEBUG apk (not distributable)'; 'assembleDebug' } }
  'debug' { 'assembleDebug' }
}

Push-Location (Join-Path $mobileDir 'android')
try {
  & cmd /c "gradlew.bat $task --no-daemon 2>&1"
  $code = $LASTEXITCODE
} finally { Pop-Location }
if ($code -ne 0) { Die "gradle $task failed (exit $code)" }
Write-Ok "gradle $task succeeded"

# --- collect -----------------------------------------------------------------
Write-Step 'Collecting artifacts'
$version = (& $node -p "require('$($mobileDir -replace '\\','/')/package.json').version").Trim()
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$patterns = if ($Mode -eq 'aab') {
  @{ Path = 'mobile\android\app\build\outputs\bundle\release\*.aab'; Dest = "NeoM-$version-android.aab" }
} else {
  @(
    @{ Path = 'mobile\android\app\build\outputs\apk\release\*.apk'; Dest = "NeoM-$version-android.apk" },
    @{ Path = 'mobile\android\app\build\outputs\apk\debug\*.apk';  Dest = "NeoM-$version-android-debug.apk" }
  )
}

$found = 0
foreach ($p in $patterns) {
  $files = @(Get-ChildItem (Join-Path $root $p.Path) -ErrorAction SilentlyContinue)
  foreach ($f in $files) {
    # Only keep the release-named debug entry when no release apk exists.
    if ($p.Dest -like '*debug*' -and (Test-Path (Join-Path $releaseDir "NeoM-$version-android.apk"))) { continue }
    Copy-Item $f.FullName (Join-Path $releaseDir $p.Dest) -Force
    $size = '{0:N2} MB' -f ((Get-Item (Join-Path $releaseDir $p.Dest)).Length / 1MB)
    Write-Ok "$($p.Dest)  ($size)"
    $found++
  }
}
if ($found -eq 0) { Write-Warn2 "no apk/aab found under mobile/android/app/build/outputs" }

Write-Host "`nAndroid build finished -> $releaseDir" -ForegroundColor Green
