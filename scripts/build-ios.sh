#!/usr/bin/env bash
# NeoM iOS 构建 / 打包（必须在 macOS + Xcode 上执行）
#
#   bash scripts/build-ios.sh                    # 真机 Debug 版 .app（模拟器不需要签名）
#   bash scripts/build-ios.sh --export ipa       # 导出签名 .ipa（需先配置签名）
#   bash scripts/build-ios.sh --export ipa --team ABCDE12345
#
# 前置：
#   1. Xcode（含 command line tools）：xcode-select --install
#   2. CocoaPods：sudo gem install cocoapods
#   3. 已执行：cd web && npm ci && npm run build
#   4. 已执行：cd mobile && npm ci && npx cap sync ios
#
# 签名配置（二选一）：
#   A. Xcode GUI：open mobile/ios/App/App.xcworkspace → Signing & Capabilities
#      选择团队，Bundle Identifier 保持 vip.zhengl.neom
#   B. 命令行：环境变量 DEVELOPMENT_TEAM + 已安装的 provisioning profile
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/mobile/ios/App"
SCHEME="App"
CONFIG="Release"
EXPORT="app"
TEAM="${DEVELOPMENT_TEAM:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --export) EXPORT="$2"; shift 2 ;;
    --team)   TEAM="$2";  shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

echo "== 0/6 环境检查 =="
command -v xcodebuild >/dev/null || { echo "缺少 xcodebuild（需 macOS + Xcode）"; exit 1; }
command -v pod >/dev/null || { echo "缺少 CocoaPods：sudo gem install cocoapods"; exit 1; }
xcodebuild -version | head -2

echo "== 1/6 同步 web 产物 =="
cd "$ROOT/mobile"
[ -d "$ROOT/web/dist" ] || { echo "web/dist 不存在，请先构建前端"; exit 1; }
node prepare-web.mjs
npx cap sync ios

echo "== 2/6 安装 Pods =="
cd "$IOS"
pod install --repo-update

echo "== 3/6 归档（archive）=="
ARCHIVE="$ROOT/release/ios/NeoM.xcarchive"
mkdir -p "$ROOT/release/ios"
rm -rf "$ARCHIVE"

SIGN_ARGS=(CODE_SIGN_STYLE=Automatic)
if [ -n "$TEAM" ]; then
  SIGN_ARGS+=("DEVELOPMENT_TEAM=$TEAM")
else
  echo "  ⚠ 未提供 DEVELOPMENT_TEAM，将使用 Xcode 中已配置的签名"
fi

xcodebuild \
  -workspace "$SCHEME.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -sdk iphoneos \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$ROOT/release/ios/DerivedData" \
  "${SIGN_ARGS[@]}" \
  archive

if [ ! -d "$ARCHIVE" ]; then
  echo "归档失败"; exit 1
fi
echo "  archive: $ARCHIVE"

if [ "$EXPORT" = "app" ]; then
  echo "== 4/6 完成（未导出 ipa）=="
  echo "  .app: $ARCHIVE/Products/Applications/NeoM.app"
  echo "  如需 ipa：bash scripts/build-ios.sh --export ipa --team <TEAM_ID>"
  exit 0
fi

echo "== 4/6 生成 ExportOptions.plist =="
EXPORT_DIR="$ROOT/release/ios/export"
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

cat > "$EXPORT_DIR/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>destination</key>
  <string>export</string>
$( [ -n "$TEAM" ] && echo "  <key>teamID</key><string>$TEAM</string>" )
</dict>
</plist>
PLIST

echo "== 5/6 导出 .ipa =="
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_DIR/ExportOptions.plist" \
  -allowProvisioningUpdates

echo "== 6/6 重命名产物 =="
VERSION=$(node -p "require('$ROOT/mobile/package.json').version")
IPA=$(find "$EXPORT_DIR" -maxdepth 1 -name "*.ipa" | head -1)
if [ -z "$IPA" ]; then
  echo "未找到 .ipa，请检查签名配置"; ls -la "$EXPORT_DIR"; exit 1
fi
FINAL="$ROOT/release/ios/NeoM-${VERSION}-ios.ipa"
cp "$IPA" "$FINAL"
echo "  ✅ $FINAL"
echo "  sha256: $(shasum -a 256 "$FINAL" | awk '{print $1}')"
echo ""
echo "下一步："
echo "  OSS_AK=... OSS_SK=... node scripts/upload-oss.mjs --dir release"
echo "  node scripts/publish-release.mjs --manifest release/manifest.json"
