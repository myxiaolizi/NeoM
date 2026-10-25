#!/usr/bin/env bash
# build-mobile.sh — build NeoM for Android (apk/aab) and iOS (ipa).
#
# Requires:
#   Android : JDK 17, Android SDK (ANDROID_HOME), NDK not needed
#   iOS     : macOS + Xcode 15+, CocoaPods
#
# Usage:
#   ./scripts/build-mobile.sh android apk
#   ./scripts/build-mobile.sh android aab
#   ./scripts/build-mobile.sh ios ipa
#   ./scripts/build-mobile.sh all            # android apk + ios ipa (macOS only)
#
# Signing (NEVER hard-code secrets):
#   Android: NEOM_KEYSTORE_PATH, NEOM_KEYSTORE_PASSWORD, NEOM_KEY_ALIAS, NEOM_KEY_PASSWORD
#   iOS    : NEOM_APPLE_TEAM_ID, NEOM_IOS_EXPORT_METHOD (app-store|ad-hoc|development)
#            or  CSC_LINK / CSC_KEY_PASSWORD + APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD
#
# Outputs:
#   mobile/android/app/build/outputs/apk/release/app-release.apk
#   mobile/android/app/build/outputs/bundle/release/app-release.aab
#   mobile/ios/App/build/ipa/NeoM.ipa
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT/mobile"
RELEASE_DIR="$ROOT/release"
TARGET="${1:-all}"
MODE="${2:-apk}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mOK\033[0m  %s\n' "$1"; }
warn() { printf '  \033[33m!!\033[0m  %s\n' "$1"; }
die()  { printf '\033[31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# ------------------------------------------------------------------ preflight
step "Preflight (target: $TARGET, mode: $MODE)"
[ -f "$ROOT/web/dist/index.html" ] || die "web/dist missing — run ./scripts/build-web.sh first"
ok "web bundle present"

command -v node >/dev/null || die "node not found"
command -v npm  >/dev/null || die "npm not found"

if [ ! -d "$MOBILE_DIR/node_modules" ]; then
  step "Installing mobile dependencies"
  ( cd "$MOBILE_DIR" && npm install --no-audit --no-fund )
fi
ok "mobile dependencies present"

# --------------------------------------------------------------- sync assets
step "Syncing Capacitor project"
( cd "$MOBILE_DIR" && node prepare-web.mjs && npx cap sync )
ok "cap sync complete"

# Native file overlay (keeps .md association / immersive theme authoritative).
if [ -f "$ROOT/scripts/sync-mobile-native.sh" ]; then
  bash "$ROOT/scripts/sync-mobile-native.sh" "$TARGET" || warn "native overlay reported issues"
fi

mkdir -p "$RELEASE_DIR"

# -------------------------------------------------------------------- android
build_android() {
  step "Android build ($MODE)"
  command -v java >/dev/null || die "java (JDK 17) not found"
  java -version 2>&1 | head -1
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || warn "ANDROID_HOME/ANDROID_SDK_ROOT not set — Gradle may fail"

  cd "$MOBILE_DIR/android"
  chmod +x ./gradlew 2>/dev/null || true

  if [ "$MODE" = "aab" ]; then
    ./gradlew bundleRelease --no-daemon
    src="$MOBILE_DIR/android/app/build/outputs/bundle/release/app-release.aab"
    dest="$RELEASE_DIR/android/NeoM-$(node -p "require('$MOBILE_DIR/package.json').version")-android.aab"
  else
    if [ -n "${NEOM_KEYSTORE_PATH:-}" ]; then
      ./gradlew assembleRelease --no-daemon
      src="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
    else
      warn "NEOM_KEYSTORE_PATH not set — producing a DEBUG apk (not distributable)"
      ./gradlew assembleDebug --no-daemon
      src="$MOBILE_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
    fi
    dest="$RELEASE_DIR/android/NeoM-$(node -p "require('$MOBILE_DIR/package.json').version")-android.apk"
  fi

  [ -f "$src" ] || die "expected artifact not found: $src"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  ok "artifact: $dest ($(du -h "$dest" | cut -f1))"
}

# ------------------------------------------------------------------------ ios
build_ios() {
  step "iOS build (ipa)"
  [ "$(uname -s)" = "Darwin" ] || die "iOS builds require macOS + Xcode"
  command -v xcodebuild >/dev/null || die "xcodebuild not found"
  command -v pod >/dev/null || die "CocoaPods not found (brew install cocoapods)"

  ( cd "$MOBILE_DIR/ios/App" && pod install --repo-update )

  local team="${NEOM_APPLE_TEAM_ID:-}"
  [ -n "$team" ] || warn "NEOM_APPLE_TEAM_ID not set — automatic signing may fail"

  local export_method="${NEOM_IOS_EXPORT_METHOD:-app-store}"
  local export_plist="$MOBILE_DIR/ios/ExportOptions.plist"
  cat > "$export_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>${export_method}</string>
  <key>teamID</key><string>${team}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>stripSwiftSymbols</key><true/>
  <key>compileBitcode</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

  cd "$MOBILE_DIR/ios/App"
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
    -archivePath "build/NeoM.xcarchive" \
    DEVELOPMENT_TEAM="$team" \
    CODE_SIGN_STYLE=Automatic \
    archive

  xcodebuild -exportArchive \
    -archivePath "build/NeoM.xcarchive" \
    -exportPath "build/ipa" \
    -exportOptionsPlist "$export_plist"

  local version
  version=$(node -p "require('$MOBILE_DIR/package.json').version")
  local dest="$RELEASE_DIR/ios/NeoM-${version}-ios.ipa"
  mkdir -p "$(dirname "$dest")"
  cp build/ipa/*.ipa "$dest"
  ok "artifact: $dest ($(du -h "$dest" | cut -f1))"
}

case "$TARGET" in
  android) build_android ;;
  ios)     build_ios ;;
  all)     build_android; build_ios ;;
  *)       die "unknown target '$TARGET' (use: android | ios | all)" ;;
esac

printf '\n\033[32mMobile build finished.\033[0m Artifacts under %s\n' "$RELEASE_DIR"
