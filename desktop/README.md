# NeoM Desktop (Electron)

Windows / macOS / Linux 桌面客户端。无边框 Win11 Fluent 界面，本地 Markdown 文件库，`.md` 文件关联，自动更新。

```
desktop/
├─ package.json          electron + electron-builder
├─ main.js               主进程（窗口 / IPC / 文件系统 / 协议 / 更新）
├─ preload.js            contextBridge 暴露 window.neom（严格按 web/src/lib/platform.ts）
├─ builder.config.js     electron-builder 配置（nsis / zip / portable / dmg / AppImage）
├─ prepare-web.mjs       把 web/dist 复制到 desktop/app-web/
├─ loader.html           无 web 产物时的占位渲染页
├─ app-web/              ← 生成物（gitignored），打包进 asar
└─ README.md
```

---

## 1. 开发

> 本机 Node 不在 PATH 时：`$env:Path = "C:\data\tools\node-v22.14.0-win-x64;$env:Path"`

```powershell
# 1) 安装依赖（首次）
cd desktop
npm install

# 2) 前端跑 dev server（另开终端，仓库根目录）
npm --prefix web run dev          # http://127.0.0.1:5273

# 3) 启动 Electron，指向 dev server
cd desktop
$env:NEOM_DEV_URL = "http://127.0.0.1:5273"
$env:NEOM_DEVTOOLS = "1"
npx electron .
```

`NEOM_DEV_URL` 为空时加载本地 `app-web/index.html`（等价于生产行为），可用
`npm run prepare:web` 先准备产物。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NEOM_DEV_URL` | – | 开发时加载的 Vite dev server 地址 |
| `NEOM_DEVTOOLS` | – | `1` = 自动打开 DevTools |
| `NEOM_ENTRY` | `/` | 初始路由，如 `/app` |
| `NEOM_API_BASE` | `https://m.zhengl.vip` | 线上后端地址（协议反代 + 更新检查） |
| `NEOM_DIRECT_API` | – | `1` = 渲染层直连绝对地址（需服务端 CORS）；默认走 `app://` 反代，零 CORS |
| `NEOM_ELECTRON_DIST` | `node_modules/electron/dist` | 复用本地 Electron 二进制，避免重新下载 |
| `NEOM_NO_ELECTRON_DIST` | – | `1` = 强制重新下载 |
| `NEOM_OUT_DIR` | `../release` | 打包输出目录 |
| `NEOM_UPDATE_URL` | `https://mdadmin.zhengl.vip/md/mdadmin/` | electron-updater generic feed |

---

## 2. 打包

```powershell
# 全部 Windows 目标（nsis + zip + portable）
npm run build:win

# 只打绿色版 zip（本机可产出）
npm run build:win:zip

# 只打安装版 exe
npm run build:win:nsis

# 目录形式（调试用，不压缩）
npm run pack:dir

# macOS（必须 macOS）
npm run build:mac
```

产物（`NEOM_OUT_DIR`，默认 `release/`）：

| 平台 | 文件 | 形态 |
|---|---|---|
| Windows | `NeoM-1.0.0-win-x64-setup.exe` | NSIS 安装包（可选安装目录，perMachine=false） |
| Windows | `NeoM-1.0.0-win-x64-green.zip` | **绿色版**，解压即用，不写注册表（除手动关联 .md） |
| Windows | `NeoM-1.0.0-win-x64-portable.exe` | 单文件便携 exe（自解压到临时目录） |
| macOS | `NeoM-1.0.0-mac-arm64.dmg` / `-x64.dmg` | 拖入 Applications |
| macOS | `NeoM-1.0.0-mac-arm64.zip` | 自动更新用 |
| Linux | `NeoM-1.0.0-linux-x64.AppImage` / `.deb` | – |

绿色版使用方式：解压 `NeoM-1.0.0-win-x64-green.zip` → 运行其中的 `NeoM.exe`。
用户数据在 `%APPDATA%\NeoM`（`neom-store.json`、`window-state.json`）。

---

## 3. 架构要点

### 3.1 窗口

| 平台 | 配置 |
|---|---|
| Windows / Linux | `frame: false`（无边框，自绘标题栏与窗口控件） |
| macOS | `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 14, y: 14 }`（保留红绿灯） |

窗口尺寸 / 位置 / 最大化状态持久化在 `%APPDATA%\NeoM\window-state.json`，
启动时会校验是否落在某个显示器的可见区域内（拔掉副屏后不会跑到屏幕外）。

渲染层通过 `window.neom.window` 控制窗口：

```ts
neom.window.minimize() / maximize() / close() / isMaximized() / toggleFullScreen()
neom.window.onStateChange(({ maximized, fullscreen, focused }) => {})
```

### 3.2 渲染层加载：`app://neom/` 协议

主进程注册了特权协议 `app://neom`，承担两件事：

1. **提供静态资源**：`app://neom/index.html`、`app://neom/assets/*.js`；
   `BrowserRouter` 的任意路由（`/app`、`/account/ai`）都回落到 `index.html`。
2. **反代 API**：`app://neom/api/**`、`/s/**`、`/p/**` 透明转发到 `NEOM_API_BASE`。

这样做的好处：前端**无需改动一行代码**就能在桌面端工作 ——
`fetch('/api/auth/me')` 是相对路径，在 `app://` 下同样是相对路径，
由主进程转发到线上后端，**不存在跨域问题**，也不需要服务端 CORS。

如确实要让渲染层直连绝对地址（比如走 CDN 或需要 cookie），设置 `NEOM_DIRECT_API=1`，
此时 `window.__NEOM_API_BASE__` 变为 `https://m.zhengl.vip`，前端把它拼在 `/api/...` 前即可。

### 3.3 文件系统桥（`window.neom.local`）

严格实现 `web/src/lib/platform.ts` 的 `LocalFileApi`：

| 方法 | 实现 |
|---|---|
| `openVault()` | `dialog.showOpenDialog({ properties:['openDirectory','createDirectory'] })` |
| `readDir(dir)` | 子项 + `mtime/ctime`（**epoch 毫秒**，前端 `new Date(ms)`） |
| `readFile/writeFile/deleteFile/createDir/rename/move` | `fs.promises`，自动建父目录 |
| `revealInFolder(path)` | Win `explorer /select,"path"` · mac `open -R path` · Linux `shell.showItemInFolder` |
| `openPath(path)` | `shell.openPath` |
| `setTitle(title)` | `BrowserWindow.setTitle`（当前文件名） |
| `associateMd()` / `isMdAssociated()` | 见 §3.4 |
| `onOpenFile(cb)` | 订阅 `neom:open-file`，返回取消订阅函数 |
| `recentVaults()` | 最近 12 个 vault（JSON 持久化） |
| `store.get/set` | `%APPDATA%\NeoM\neom-store.json`（自定义 JSON store，无额外依赖） |
| `update.check/download/install` | 先查 `/api/releases/check`，回退 `electron-updater` |

额外的可选能力（不破坏契约）：`readDirRecursive`、`stat`、`deleteRecursive`、
`storeDelete`、`openFileDialog`。

> `readDir` 默认只返回**直接子项**（`web/src/lib/fs.ts` 的 `walkLocal` 自己递归）。
> 需要一次拿整棵树时用 `readDirRecursive(dir)`。

### 3.4 `.md` 文件关联

**Windows** — `app.setAsDefaultProtocolClient` 只能注册 URL 协议，文件关联必须写注册表：

```powershell
# associateMd() 实际执行的等价命令（HKCU，无需管理员）
reg add "HKCU\Software\Classes\NeoM.Markdown" /ve /d "NeoM Markdown 文档" /f
reg add "HKCU\Software\Classes\NeoM.Markdown\DefaultIcon" /ve /d "\"<exe>\",0" /f
reg add "HKCU\Software\Classes\NeoM.Markdown\shell\open\command" /ve /d "\"<exe>\" \"%1\"" /f
reg add "HKCU\Software\Classes\.md" /ve /d "NeoM.Markdown" /f
reg add "HKCU\Software\Classes\.md\OpenWithProgids" /v "NeoM.Markdown" /t REG_NONE /d "" /f
ie4uinit.exe -show          # 通知资源管理器刷新图标
```

`isMdAssociated()` 用 `reg query HKCU\Software\Classes\.md /ve` 检测；
未命中时再查 `HKCR\.md`（覆盖安装版通过 `fileAssociations` 建立的全机器关联）。

**macOS** — 由 `builder.config.js` 的 `fileAssociations` + `extendInfo.CFBundleDocumentTypes`
写入 `Info.plist`（UTI `net.daringfireball.markdown`）。macOS 不允许静默抢占默认打开方式，
因此 `associateMd()` 只校验声明是否存在，然后弹窗引导用户到
「显示简介 → 打开方式 → 全部更改」。

### 3.5 命令行参数 / 第二实例

```powershell
NeoM.exe "C:\notes\今日笔记.md"     # 启动即打开
```

- 单实例锁：第二个实例通过 `second-instance` 把 `.md` 路径转发给已有窗口并聚焦。
- macOS：`open-file` 事件（Finder / Dock 拖拽）与 `neom://` URL scheme 同样走 `deliverOpenFile`。
- 渲染层在 `preload` 的 `onOpenFile` 回调里收到绝对路径：

```ts
neom.local.onOpenFile((p) => openDocument(p))
```

启动时若带参，路径会在渲染层 `did-finish-load` 后补发（不会丢）。

### 3.6 菜单与快捷键

- Windows / Linux：`Menu.setApplicationMenu(null)` —— 完全隐藏默认菜单。
- macOS：保留最小 app menu（关于 / 隐藏 / 退出）+ 编辑 + 窗口，
  **不注册**任何会拦截前端快捷键的 `accelerator`；`Mod+S`、`Mod+P` 等全部交给前端
  `DEFAULT_SHORTCUTS` 处理。

### 3.7 自动更新

两级策略：

1. 先请求 `GET https://m.zhengl.vip/api/releases/check?platform=win-x64&version=<ver>`，
   兼容 `{data:{hasUpdate,version,url,notes}}`、`{data:{latest:{...}}}` 等返回形态。
2. 回退到 `electron-updater` 的 generic provider（`NEOM_UPDATE_URL` 下的 `latest.yml`）。

`download()` 优先走 `electron-updater` 的增量下载；若只有直链则下载到临时目录后
`shell.openPath` 启动安装包。

```ts
const info = await neom.local.update.check()   // {version,url,notes} | null
if (info) { await neom.local.update.download(info.url); await neom.local.update.install() }
```

### 3.8 安全

| 项 | 值 |
|---|---|
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `false`（本地文件桥需要 fs；渲染层仍无法直接 require） |
| `webviewTag` | `false` |
| 外链 | `setWindowOpenHandler` + `will-navigate` → 一律 `shell.openExternal` |
| CSP | 由 `web/index.html` 控制（`app://` 协议 `bypassCSP:false`） |

---

## 4. 签名与公证

### Windows（可选）

```powershell
$env:CSC_LINK = "C:\certs\neom.pfx"        # 或 base64
$env:CSC_KEY_PASSWORD = "***"
npm run build:win
```

未配置证书时 electron-builder 产出未签名 exe（SmartScreen 会提示"未知发布者"）。
`verifyUpdateCodeSignature: false` 允许未签名版本的自动更新。

### macOS（发布必需）

```bash
export CSC_LINK=/path/neom.p12
export CSC_KEY_PASSWORD=***
export APPLE_ID=hi@zhengl.vip
export APPLE_APP_SPECIFIC_PASSWORD=****
export APPLE_TEAM_ID=XXXXXXXXXX
npm run build:mac
```

`hardenedRuntime: true` + `gatekeeperAssess: false`；公证由 electron-builder 自动提交
（`APPLE_ID` 三项齐全时）。未签名机器可设 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过。

---

## 5. 发布

```powershell
# 1) 构建
pwsh ../scripts/package-all.ps1 -Target win

# 2) 上传 OSS（AK/SK 只从环境变量读）
$env:OSS_ACCESS_KEY_ID     = "..."
$env:OSS_ACCESS_KEY_SECRET = "..."
$env:OSS_BUCKET            = "neom-release"
node ../scripts/upload-oss.mjs

# 3) 登记到后台 releases 表
$env:NEOM_ADMIN_TOKEN = "..."
node ../scripts/publish-release.mjs
```

OSS 布局：

```
md/mdadmin/<version>/NeoM-1.0.0-win-x64-green.zip   # 不可变，永久直链
md/mdadmin/latest/NeoM-1.0.0-win-x64-green.zip      # 最新版镜像
md/mdadmin/manifest.json                            # 清单
```

公开地址：`https://mdadmin.zhengl.vip/md/mdadmin/<version>/<file>`

---

## 6. 验证

```powershell
# 契约一致性：preload 是否完整实现了 platform.ts 的 LocalFileApi
node ../scripts/check-contract.mjs

# 端到端冒烟：真启动 Electron，跑 40 项桥接断言
pwsh ../scripts/smoke-desktop.ps1
```

冒烟覆盖 `window.neom` → `LocalFileApi` 全量 → fs 往返（中文 UTF-8 / 绝对路径 /
epoch 毫秒 mtime）→ JSON store → `recentVaults` → `app://` 静态 + SPA 回落 + 404 →
**`app://` 反代 `/api/health`** → 窗口最大化/还原 → `.md` 关联检测（只读）→ 更新检查。
报告在 `%TEMP%\neom-bridge-report.txt`，末行 `RESULT: PASS|FAIL`。

> 冒烟脚本会自动 `Remove-Item Env:\ELECTRON_RUN_AS_NODE` —— 如果父 shell 继承了这个
> 变量，Electron 会退化成普通 Node 运行并在 `app.isPackaged` 处崩溃。

## 7. 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 打包卡在 `downloading ... electron-vXX-win32-x64.zip` | GitHub 直连超慢。脚本已自动复用 `node_modules/electron/dist`；若仍失败：手动下载（镜像 `https://registry.npmmirror.com/-/binary/electron/<ver>/electron-v<ver>-win32-x64.zip`）解压到 `node_modules/electron/dist`，并写 `path.txt`（内容 `electron.exe`） |
| 启动白屏 | 没阶段化前端：`npm run prepare:web`；确认 `desktop/app-web/index.html` 存在 |
| 页面显示"网页资源尚未构建" | 正常兜底页 —— `web/dist` 缺失时打的包。重新构建 web 后再打包 |
| API 请求 404 / 跨域 | 默认走 `app://` 反代；确认 `NEOM_API_BASE` 正确，或设 `NEOM_DIRECT_API=1` 并让后端开 CORS |
| `.md` 双击没反应 | 安装版：确认装时勾选了关联；绿色版：调 `neom.local.associateMd()` |
| 窗口位置跑到屏幕外 | 删 `%APPDATA%\NeoM\window-state.json` |
| macOS 红绿灯位置不对 | 调 `main.js` 的 `trafficLightPosition` |

---

## 8. 前端配合点（契约外，可选）

桌面端已通过 `window.__NEOM_API_BASE__` 注入后端地址，但**默认不需要前端改动**
（`app://` 反代让相对路径直接可用）。若前端要做「设置 → 关于」页面，可读：

```ts
const info = await window.neom?.app?.info()
// { version, platform, arch, electron, chrome, node, remoteApiBase, isPackaged }
```

建议 `web/src/lib/api.ts` 支持（可选增强）：

```ts
const API_BASE =
  (window as any).__NEOM_API_BASE__ ||      // '' 表示同源（桌面 app:// 反代）
  import.meta.env.VITE_API_BASE || ''       // 移动端 / 独立部署
const url = API_BASE ? API_BASE + path : path
```
