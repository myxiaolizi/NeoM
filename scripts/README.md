# scripts — 构建 / 打包 / 发布自动化

> 全部脚本**不含任何密钥**。AK/SK、Token、签名口令一律从环境变量读取。

## 一览

| 脚本 | 平台 | 作用 |
|---|---|---|
| `build-web.ps1` / `.sh` | Win / *nix | 安装依赖 → `vite build` → 校验产物 + 写 `dist/neom-build.json` |
| `package-all.ps1` | Win | 一键：web → desktop(win/mac) → mobile sync → `release/manifest.json` |
| `build-mobile.sh` | mac/Linux | Capacitor sync → 覆盖原生文件 → gradle/Xcode → apk/aab/ipa |
| `build-mobile.ps1` | Win | 同上（仅 Android；iOS 明确报错并指向 macOS/CI） |
| `sync-mobile-native.ps1` / `.sh` | Win / *nix | 把仓库维护的原生文件覆盖进 `cap add` 生成的工程 |
| `upload-oss.mjs` | 任意 | 上传 `release/**` 到阿里云 OSS（`md/mdadmin/`），输出清单 |
| `publish-release.mjs` | 任意 | 把清单登记到后台 `POST /api/admin/releases` |
| `make-icons.mjs` | 任意 | 纯 Node 生成 png/ico/icns（无原生依赖） |
| `check-contract.mjs` | 任意 | 校验 `desktop/preload.js` 实现了 `platform.ts` 的 `LocalFileApi` |
| `smoke-desktop.ps1` | Win | 端到端冒烟：启动 Electron，跑 40 项桥接断言（fs/协议/反代/窗口/更新） |

## 常用流程

```powershell
# 1) 只构建前端
pwsh scripts/build-web.ps1

# 2) 打 Windows 全部产物（安装版 + 绿色版 + 便携版）
pwsh scripts/package-all.ps1 -Target win

# 3) 上传 OSS（密钥只走环境变量）
$env:OSS_ACCESS_KEY_ID     = "..."
$env:OSS_ACCESS_KEY_SECRET = "..."
$env:OSS_BUCKET            = "neom-release"
node scripts/upload-oss.mjs

# 4) 登记到后台
$env:NEOM_ADMIN_TOKEN = "..."
node scripts/publish-release.mjs
```

```bash
# 移动端（需 JDK17 + Android SDK）
bash scripts/build-mobile.sh android apk
# iOS（需 macOS + Xcode）
bash scripts/build-mobile.sh ios ipa
```

## 验证

```powershell
# 契约一致性（preload 是否实现了 platform.ts 的 LocalFileApi）
node scripts/check-contract.mjs

# 桌面端端到端冒烟（真启动 Electron，40 项断言）
pwsh scripts/smoke-desktop.ps1
```

冒烟测试覆盖：`window.neom` 存在性 → `LocalFileApi` 全量对齐 → fs 往返（含中文 UTF-8、
绝对路径、epoch 毫秒 mtime）→ JSON store → `recentVaults` → `app://` 静态服务 +
SPA 回落 + 缺失资源 404 → **`app://` 反代 `/api/health`** → 窗口最大化/还原 →
`.md` 关联检测（只读，不改注册表）→ 更新检查。

报告写到 `%TEMP%\neom-bridge-report.txt`，末行 `RESULT: PASS|FAIL`，脚本退出码即结果。
原始渲染器（`desktop/app-web/`）在测试后自动还原。

## 环境变量

### OSS（`upload-oss.mjs`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `OSS_ACCESS_KEY_ID` | ✅ | 阿里云 AccessKey ID（也接受 `ALIYUN_ACCESS_KEY_ID`） |
| `OSS_ACCESS_KEY_SECRET` | ✅ | AccessKey Secret |
| `OSS_BUCKET` | ✅ | 如 `neom-release` |
| `OSS_REGION` | – | 默认 `oss-cn-hangzhou` |
| `OSS_ENDPOINT` | – | 自定义 endpoint / 内网加速 |
| `OSS_PREFIX` | – | 默认 `md/mdadmin/` |
| `OSS_PUBLIC_BASE` | – | 默认 `https://mdadmin.zhengl.vip` |
| `OSS_SECURITY_TOKEN` | – | STS 临时凭证 |

> 脚本会拒绝形如 `LTAIxxxx`、`your…`、`placeholder` 的占位符，避免误把假密钥跑成"成功"。

OSS 布局：

```
md/mdadmin/<version>/<filename>     不可变，永久直链
md/mdadmin/latest/<filename>        最新版镜像（稳定下载链接）
md/mdadmin/manifest.json            清单
```

### 后台发布（`publish-release.mjs`）

| 变量 | 说明 |
|---|---|
| `NEOM_ADMIN_TOKEN` | 管理员 JWT（推荐） |
| `NEOM_ADMIN_ACCOUNT` + `NEOM_ADMIN_PASSWORD` | 没有 token 时自动 `POST /api/admin/login` |
| `NEOM_API_BASE` | 默认 `https://m.zhengl.vip` |

平台会从文件名推断并映射到契约里的枚举：
`win-x64` / `win-green` / `mac-arm64` / `mac-x64` / `android` / `ios` / `linux-x64`。

### 构建期

| 变量 | 说明 |
|---|---|
| `VITE_API_BASE` | 前端 API 基址（移动端必需绝对地址） |
| `NEOM_NODE_DIR` | Node 所在目录（本机 PATH 未配置时用） |
| `NEOM_OUT_DIR` | electron-builder 输出目录 |
| `NEOM_UPDATE_URL` | electron-updater generic feed |
| `NEOM_ELECTRON_DIST` | 复用本地 Electron 二进制，避免重新下载 |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Windows / macOS 代码签名 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS 公证 |
| `NEOM_KEYSTORE_PATH` 等 | Android 签名 |

## 本机环境注意事项

- 本机 Node 不在 PATH：脚本已内置 `C:\data\tools\node-v22.14.0-win-x64` 探测，
  也可设 `NEOM_NODE_DIR`。
- 本机只有 **Windows PowerShell 5.1**（无 `pwsh`）：脚本按 5.1 语法编写
  （不用 `??`、`$IsWindows`、`?.`），并按需回退到 `powershell.exe`。
- 5.1 默认编码是 GB2312：所有 UTF-8 输出（`manifest.json` 等）都通过
  `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` 写**无 BOM** 文件，
  否则 Node 的 `JSON.parse` 会因 BOM 失败。
- GitHub 直连可能超时（electron / rcedit / nsis 会卡住）。已缓存到
  `%LOCALAPPDATA%\electron-builder\Cache\{electron,winCodeSign,nsis*}`；
  镜像地址：`https://registry.npmmirror.com/-/binary/electron-builder-binaries/`。

## CI

`.github/workflows/build.yml`：web → windows / macos / android / ios 四路矩阵 →
上传 artifacts →（打 tag 时）OSS 上传 + 后台登记 + GitHub Release。

```bash
git tag v1.0.0 && git push origin v1.0.0
```
