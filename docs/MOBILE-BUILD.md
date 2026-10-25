# NeoM 移动端构建指南（Android APK / iOS IPA）

> 目标：任何人拿到有工具链的机器（或 CI）都能一键产出 apk/ipa。
> 本仓库的移动端只保留**需要人工维护的配置文件**，平台工程由 Capacitor 生成。

---

## 0. 前置依赖

| 平台 | 需要 |
|---|---|
| **Android** | Node 20+、**JDK 17**、**Android SDK**（platform 34 + build-tools 34.0.0）、Gradle 8.7（wrapper 自带） |
| **iOS** | macOS 13+、**Xcode 15+**、CocoaPods、Apple 开发者账号 |
| 通用 | web 产物 `web/dist`（先构建前端） |

```bash
# 检查环境
node -v                 # v20+
java -version           # openjdk 17
echo $ANDROID_HOME      # /Users/xxx/Library/Android/sdk
xcodebuild -version     # Xcode 15.x（仅 macOS）
pod --version           # 1.14+
```

---

## 1. 构建前：先出 web 产物

移动端 `webDir` 直接指向 `../web/dist`，没有前端产物就没东西可打包。

```bash
# 仓库根目录
npm --prefix web install
VITE_API_BASE=https://m.zhengl.vip npm --prefix web run build
```

> 移动端**必须**用绝对 `VITE_API_BASE`：`capacitor://localhost` / `https://localhost`
> 下相对路径 `/api/...` 会打到 WebView 自身，不会到服务器。

---

## 2. Android

### 2.1 首次：生成平台工程

```bash
cd mobile
npm install
npx cap add android          # 生成 mobile/android/（Gradle 工程）
```

### 2.2 覆盖为本仓库维护的原生文件

```bash
pwsh ../scripts/sync-mobile-native.ps1 -Platform android   # Windows
bash ../scripts/sync-mobile-native.sh android              # macOS / Linux
```

覆盖内容：

| 文件 | 作用 |
|---|---|
| `app/src/main/AndroidManifest.xml` | 权限 + `.md` 文件关联 intent-filter |
| `app/src/main/res/values/styles.xml` | 沉浸式状态栏 / edge-to-edge 主题 |
| `app/src/main/res/xml/file_paths.xml` | FileProvider 路径 |
| `.../java/vip/zhengl/neom/MainActivity.kt` | 沉浸式 + ACTION_VIEW/SEND 处理 |

### 2.3 同步 web 资源

```bash
npx cap sync android        # 等价于 cap copy + cap update
```

### 2.4 打包

```bash
cd android

# 调试包（无需签名，可直接装）
./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk

# 发布包（需签名，见 §4.1）
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk

# 上架 Google Play 用 AAB
./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab
```

或一键：

```bash
./scripts/build-mobile.sh android apk    # 自动 cap sync + 覆盖原生文件 + gradle
./scripts/build-mobile.sh android aab
pwsh scripts/build-mobile.ps1 -Platform android -Mode apk
```

产物会被复制到 `release/android/NeoM-<version>-android.apk`。

### 2.5 装到设备

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -i neom      # 看 WebView 报错
```

---

## 3. iOS（必须在 macOS）

### 3.1 生成工程

```bash
cd mobile
npm install
npx cap add ios
```

### 3.2 合并 Info.plist

`mobile/ios/App/App/Info.plist` 是本仓库维护的版本，包含：

- `CFBundleDocumentTypes` —— `.md` 出现在「用其他应用打开」
- `UTImportedTypeDeclarations` —— 声明 UTI `net.daringfireball.markdown`
- `LSSupportsOpeningDocumentsInPlace` / `UIFileSharingEnabled` —— 文件 App 支持
- `NSMicrophoneUsageDescription` 等权限文案
- 安全区相关（配合 `capacitor.config.ts` 的 `contentInset: 'always'`）

```bash
# 用 PlistBuddy 合并（保留 cap 生成的其他键）
/usr/libexec/PlistBuddy -c "Merge ../mobile/ios/App/App/Info.plist" \
  ios/App/App/Info.plist
plutil -lint ios/App/App/Info.plist
```

### 3.3 依赖与打包

```bash
npx cap sync ios
cd ios/App && pod install

# Xcode 打开
npx cap open ios        # Product → Archive → Distribute

# 或命令行
xcodebuild -workspace App.xcworkspace -scheme App \
  -configuration Release -sdk iphoneos \
  -archivePath build/NeoM.xcarchive archive

xcodebuild -exportArchive \
  -archivePath build/NeoM.xcarchive \
  -exportPath build/ipa \
  -exportOptionsPlist ExportOptions.plist
```

`ExportOptions.plist` 由 `scripts/build-mobile.sh` 自动生成（`method` 取
`NEOM_IOS_EXPORT_METHOD`：`app-store` / `ad-hoc` / `development`）。

产物：`release/ios/NeoM-<version>-ios.ipa`

---

## 4. 签名

### 4.1 Android

密钥**只从环境变量读**，绝不入库：

```bash
export NEOM_KEYSTORE_PATH=/secure/neom-release.jks
export NEOM_KEYSTORE_PASSWORD=***
export NEOM_KEY_ALIAS=neom
export NEOM_KEY_PASSWORD=***
```

生成密钥库（一次）：

```bash
keytool -genkeypair -v -keystore neom-release.jks -alias neom \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=NeoM, OU=Mobile, O=NeoM, L=Hangzhou, ST=Zhejiang, C=CN"
```

`mobile/android/app/build.gradle` 里加签名块（参考 `mobile/android/README.md`）：

```gradle
def keystoreProps = new Properties()
def ksFile = rootProject.file("keystore.properties")
if (ksFile.exists()) keystoreProps.load(new FileInputStream(ksFile))

android {
  signingConfigs {
    release {
      if (ksFile.exists()) {
        storeFile file(keystoreProps['storeFile'])
        storePassword System.getenv("NEOM_KEYSTORE_PASSWORD") ?: keystoreProps['storePassword']
        keyAlias keystoreProps['keyAlias']
        keyPassword System.getenv("NEOM_KEY_PASSWORD") ?: keystoreProps['keyPassword']
      }
    }
  }
  buildTypes { release { signingConfig signingConfigs.release } }
}
```

CI 里把 keystore base64 存进 secret（`ANDROID_KEYSTORE_BASE64`），构建前解码为
临时 `keystore.jks` + 生成 `keystore.properties`（见 `.github/workflows/build.yml` 的
`Configure signing` 步骤）。

### 4.2 iOS

| 方式 | 需要的环境变量 |
|---|---|
| 自动签名 | `NEOM_APPLE_TEAM_ID` + Xcode 已登录账号 |
| App Store Connect API | `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH`(`.p8`) |
| 手动证书 | `CSC_LINK`(`.p12` base64) + `CSC_KEY_PASSWORD` |

---

## 5. 一键构建

### 5.1 本机

```bash
# Android
./scripts/build-mobile.sh android apk

# Windows 上（只能编 Android）
pwsh scripts/build-mobile.ps1 -Platform android -Mode apk

# 全平台（需 macOS）
./scripts/build-mobile.sh all
```

### 5.2 CI（推荐：本机没工具链也能出包）

`.github/workflows/build.yml` 包含三个矩阵 job：

| Job | Runner | 产出 |
|---|---|---|
| `android` | `ubuntu-latest` + JDK17 + `setup-android` | `NeoM-<v>-android.apk` / `.aab` |
| `ios` | `macos-14` + Xcode | `NeoM-<v>-ios.ipa`（未签名时仍产出 xcarchive） |
| `windows` / `macos` / `web` | – | 桌面端 + web 产物 |

触发：

```bash
git tag v1.0.0 && git push origin v1.0.0
```

或在 GitHub → Actions → `build` → Run workflow（可选 targets + 是否 publish）。

CI 会自动：构建 web → 生成/复用平台工程 → 覆盖原生文件 → 签名 → 上传 artifacts →
（tag 触发时）上传 OSS + 登记 releases 表 + 创建 GitHub Release。

---

## 6. 移动端能力与 web 的协作

### 6.1 打开 .md 文件

Android `MainActivity.kt` 把 intent 转成 DOM 事件：

```js
window.addEventListener('neom:native-open-uri', (e) => {
  const uri = e.detail.uri          // content://com.android.providers.../note.md
  openFromNative(uri)
})

window.addEventListener('neom:native-share', (e) => {
  const { title, text } = e.detail    // 「分享到 NeoM」
  createNoteFromShare(title, text)
})
```

iOS 通过 Capacitor App 插件：

```js
import { App as CapacitorApp } from '@capacitor/app'
CapacitorApp.addListener('appUrlOpen', ({ url }) => {
  // file:///private/var/mobile/.../note.md  或 neom://open?file=...
})
```

### 6.2 API 地址

移动端**不用**桌面端的 `app://` 反代，必须用绝对地址：

```ts
const API_BASE =
  (window as any).__NEOM_API_BASE__ ||   // Capacitor 注入（可选）
  import.meta.env.VITE_API_BASE ||       // 构建期注入（推荐）
  'https://m.zhengl.vip'
const url = path.startsWith('http') ? path : API_BASE + path
```

> 需要服务端允许 `capacitor://localhost`、`https://localhost`、
> `http://localhost`、`https://m.zhengl.vip` 这些 Origin 的 CORS。

### 6.3 安全区

```css
.shell-toolbar { padding-top: env(safe-area-inset-top); }
.shell-statusbar { padding-bottom: env(safe-area-inset-bottom); }
```

配合 `capacitor.config.ts` 的 `ios.contentInset: 'always'` 与
`AndroidManifest` 的 edge-to-edge 主题。

---

## 7. 产物路径汇总

| 平台 | 产物 | 路径 |
|---|---|---|
| Android | debug apk | `mobile/android/app/build/outputs/apk/debug/app-debug.apk` |
| Android | release apk | `mobile/android/app/build/outputs/apk/release/app-release.apk` |
| Android | aab | `mobile/android/app/build/outputs/bundle/release/app-release.aab` |
| Android | 归档副本 | `release/android/NeoM-1.0.0-android.apk` |
| iOS | archive | `mobile/ios/App/build/NeoM.xcarchive` |
| iOS | ipa | `mobile/ios/App/build/ipa/NeoM.ipa` → `release/ios/NeoM-1.0.0-ios.ipa` |

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `SDK location not found` | 没设 SDK 路径 | `export ANDROID_HOME=...` 或写 `mobile/android/local.properties` 的 `sdk.dir` |
| `Unsupported class file major version 65` | JDK 版本不对 | 用 JDK 17（`java -version` 确认） |
| `Failed to install the following Android SDK packages` | 缺 platform/build-tools | `sdkmanager "platforms;android-34" "build-tools;34.0.0"` |
| 白屏 / 空白页 | 没同步 web 产物 | `npm --prefix web run build` → `npx cap sync`；确认 `mobile/ios/App/App/public/index.html` 或 android `assets/public/index.html` 存在 |
| API 请求失败（CORS） | 用了相对路径 | 构建时设 `VITE_API_BASE`，并让后端放行 Capacitor Origin |
| 状态栏压住内容 | styles.xml 被 cap 覆盖 | 重跑 `sync-mobile-native.ps1` |
| 双击 .md 不进 NeoM | intent-filter 丢失 | 同上，重跑原生文件覆盖 |
| iOS `pod install` 卡住 | 网络 | `pod repo update --verbose`，或换源 |
| `No signing certificate found` | 没配证书 | 设置 `NEOM_APPLE_TEAM_ID` / Xcode 登录账号 |
| `MainActivity.kt` 编译失败 | 包名不匹配 | 确认 `applicationId = vip.zhengl.neom` 且目录为 `java/vip/zhengl/neom/` |
