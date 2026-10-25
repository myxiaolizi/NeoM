# NeoM — 开发契约（唯一权威）

> 所有并行开发必须严格遵守本文件。修改契约需 Lead 批准。

## 0. 技术栈与目录

```
NeoM/
├─ web/                 React 18 + TS + Vite 5 + zustand 4 + vditor 3.11（前端唯一产物 dist/）
│  └─ src/
│     ├─ lib/contracts.ts   类型 + API 路径常量（唯一权威）
│     ├─ lib/api.ts         fetch 封装（已提供）
│     ├─ store.ts           zustand 全局 store（已提供）
│     ├─ styles/tokens.css  设计令牌（已提供）
│     ├─ styles/base.css    通用组件样式（已提供）
│     ├─ shell/             编辑器外壳
│     ├─ features/          业务模块
│     └─ plugins/           24 内置插件
├─ server/              Node 20+ Express 4 + mysql2（唯一后端，端口 3300）
│  └─ src/{index.js,lib/,routes/,db/}
├─ desktop/             Electron（Windows .exe + 绿色版 / macOS arm64+x64）
├─ mobile/              Capacitor（Android .apk / iOS .ipa）
├─ docs/                文档（插件开发指南等）
└─ scripts/             构建与部署脚本
```

**规则**
- 前端只能通过 `lib/api.ts` 的 `api.*` 访问后端；不允许各模块自己写 fetch（除已封装的流式 SSE）。
- 后端所有响应统一 `{status:true,data}` / `{status:false,msg}`。
- 认证：JWT，`Authorization: Bearer <token>`；token 存 localStorage `neom.token`。同时支持 cookie。
- 时间统一 ISO8601 字符串；金额/积分用数字。
- 中文 UI，代码注释英文或中文皆可。

## 1. 数据库（库名 `neom`，MySQL 8，utf8mb4）

表前缀无。核心表：
`users, user_sessions, login_logs, admin_audit, vaults, files, file_versions, file_snapshots,
share_links, share_comments, publish_pages, ai_providers, ai_channels, ai_models, ai_settings,
ai_usage_logs, point_ledger, recharge_orders, redeem_codes, plugins, plugin_versions, user_plugins,
releases, site_config, site_docs, storage_configs, sys_settings, sensitive_words, rate_limits,
backups, notifications`

字段以 `server/sql/001_schema.sql` 为准（由 server-core 负责）。

## 2. API 契约（前缀 `/api`）

### 2.1 公共
| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | `{status:true,data:{ok:true,ts,db:true}}` |
| GET | `/bootstrap` | 站点配置+公告+发布版本+插件清单+模型目录（未登录也可） |
| GET | `/site/config` | 门户配置（banner/features/footer/icp/agreement） |
| GET | `/site/docs?key=terms\|privacy` | 协议文档 |
| GET | `/releases` | 全平台安装包列表（按平台分组，含 OSS 直链） |
| GET | `/releases/check?platform=win-x64&version=1.0.0` | 更新检查 |

### 2.2 认证
| POST | `/auth/register` `{username,password,email?}` → `{token,user}` |
| POST | `/auth/login` `{account,password}` → `{token,user}` |
| POST | `/auth/logout` |
| GET | `/auth/me` → `user` |
| POST | `/auth/profile` `{nickname,avatar,email,phone}` |
| POST | `/auth/password` `{old,new}` |
| GET | `/auth/sessions` / DELETE `/auth/sessions/:id` |
| POST | `/auth/bind` `{email?,phone?,code?}` |

### 2.3 文件（云仓库，所有用户文件在 S3/OSS：`md/user/<username>/...`）
| GET | `/files/tree?vault=` → `FileNode[]`（扁平，含 parent，前端建树） |
| GET | `/files/read?path=` → `{path,name,content,etag,mtime,version}` |
| POST | `/files/write` `{path,content,baseEtag?,naming?}` → `{path,name,etag,version,mtime,renamed?}`；etag 不匹配返回 409 `{status:false,code:'CONFLICT',data:{remote}}` |
| POST | `/files/create` `{dir?,name?}` → 自动时间戳命名 |
| POST | `/files/mkdir` `{path}` |
| POST | `/files/rename` `{from,to}` |
| POST | `/files/move` `{from,to}` |
| POST | `/files/copy` `{from,to?}` |
| POST | `/files/delete` `{path}`（软删入回收站，写入 file_snapshots） |
| GET | `/files/search?q=&scope=name\|content\|tag\|all` → `{hits:[{path,name,matches:[{line,text}]}]}` |
| GET | `/files/recent?limit=` |
| POST | `/files/sort` `{orders:[{path,order}]}` |
| POST | `/files/sync` → 与 S3 双向同步 |
| POST | `/files/export` `{path,format:docx\|pdf\|html\|md}` → 二进制或 `{url}` |
| POST | `/files/import` (multipart) |
| GET | `/files/conflict?path=` → `{local,remote}` |

### 2.4 版本
| GET | `/versions/list?path=&limit=` → `VersionMeta[]` |
| GET | `/versions/read?id=` → `{content}` |
| POST | `/versions/restore` `{id}` |
| POST | `/versions/snapshot` `{path,content,reason}` |
| GET | `/versions/diff?a=&b=` → `{left,right}`（前端做 diff 渲染） |

### 2.5 分享 / 发布
| POST | `/share/create` `{path,mode:'read'\|'comment'\|'edit',expiresAt?,password?}` → `ShareLink` |
| GET | `/share/list` → `ShareLink[]` |
| POST | `/share/revoke` `{id}` |
| GET | `/share/get?id=` （公开，免登录） → `{doc:{name,content},mode,expiresAt,comments}` |
| POST | `/share/comment` `{id,content,anchor?,author?}` （公开，免登录） |
| POST | `/publish/create` `{path,encrypted?,password?}` → `PublishPage` |
| GET | `/publish/list` |
| POST | `/publish/revoke` `{id}` |
| GET | `/p/:id` 服务端渲染 HTML 公开页（含评论标注挂件） |
| GET | `/s/:id` 分享页 HTML |

### 2.6 AI
| GET | `/ai/providers` → `AiProvider[]`（含官方渠道是否可用） |
| GET | `/ai/models` → `AiModel[]`（仅 enabled，含价格与推荐标签） |
| POST | `/ai/chat` `{model,messages,temperature?,stream?}` → `AiChatResult` |
| POST | `/ai/chat/stream` SSE：`data: {"delta":"..."}` … `data: {"done":true,"usage":{...}}` |
| POST | `/ai/asr` (multipart audio) → `{text,usage}` |
| POST | `/ai/tts` `{text,model,voice?}` → `{url,usage}` |
| GET | `/ai/tts/voices` → `[{id,name,lang,desc}]` |
| POST | `/ai/fetch-models` `{providerId,apiKey,baseUrl?}` → `{models:[{id,...}]}`（服务端代理请求上游） |
| GET/POST | `/ai/settings` 用户 AI 配置（含 mode/provider/enabledModels/defaults） |
| POST | `/ai/test` `{providerId,apiKey,baseUrl}` → `{ok,latencyMs}` |

**扣费规则**：`official` 模式按模型价格从积分扣减（缓存输入/未命中输入/输出分别计价；ASR 按音频小时；TTS 免费或按次）。`custom` 模式不扣积分。每次调用写 `ai_usage_logs` 与 `point_ledger`。

### 2.7 积分 / 账单
| GET | `/billing/balance` → `{points,signinToday}` |
| GET | `/billing/ledger?limit=&page=` → `PointLedgerItem[]` |
| GET | `/billing/packages` → `[{id,name,price,points,bonus}]` |
| POST | `/billing/recharge` `{packageId,channel}` → `{orderId,payUrl?}` |
| POST | `/billing/redeem` `{code}` → `{points}` |
| GET | `/billing/orders` |
| POST | `/billing/signin` → `{points}` |

### 2.8 存储（个人 OSS/S3）
| GET/POST | `/storage/settings` → `StorageSettings`（secret 不回传明文，返回 `hasSecret:true`） |
| POST | `/storage/test` `{...}` → `{ok,msg,latencyMs}` |
| POST | `/storage/upload` (multipart `file`, `kind=tupian\|bk\|ot`) → `{url,key,size}` |
| POST | `/storage/sign` `{key}` → 预签名 URL |

### 2.9 插件
| GET | `/plugins/installed` → `InstalledPlugin[]` |
| GET | `/plugins/store?category=&q=` → `StorePlugin[]` |
| POST | `/plugins/install` `{id,version?}` |
| POST | `/plugins/uninstall` `{id}` |
| POST | `/plugins/toggle` `{id,enabled}` |
| POST | `/plugins/upload` (multipart zip) → `{id,manifest}` |
| POST | `/plugins/update` `{id}` |
| GET | `/plugins/manifest` → 全部内置插件 manifest（前端注册表用） |

### 2.10 管理后台（全部需 `role=admin`，前缀 `/api/admin`）
`login, dashboard, users(GET/POST/PUT/DELETE/ban/reset), user/:id(详情：备份/分享/AI流水/积分变更),
points(adjust), channels(CRUD+test+sync-models), models(CRUD+定价), pricing, orders, redeem(批量生成/导出/核销),
plugins(审核/上下架/版本/默认开启), shares, comments, releases(上传OSS+更新日志), oss(浏览/统计/清理),
site(config/协议/公告/注册开关/默认主题), security(限流/敏感词/审计), audit, stats, backup(MySQL导出)`

## 3. 前端 Store 契约（`web/src/store.ts`，已提供，禁止改名）

关键字段：`tabs/activeTabId/openTab/closeTab/closeOtherTabs/closeTabsToRight/closeAllTabs/setActiveTab/updateTab`,
`files/setFiles/expanded/toggleExpanded`, `settings/updateSettings`（AppSettings 见 contracts）,
`leftVisible/rightVisible/ribbonVisible/toggleLeft/toggleRight/toggleRibbon`, `leftView/setLeftView`,
`rightPanel/setRightPanel`, `leftPanel/setLeftPanel`, `pageWidth/setPageWidth`, `viewMode/setViewMode`,
`openContextMenu/closeContextMenu`, `openModal/closeModal`, `paletteOpen`, `toast`, `stats/setStats`,
`plugins/togglePlugin/isPluginEnabled`, `conflict/setConflict`, `user/setUser`。

新增共享状态时在 store.ts 中追加，并在本文件登记。

## 4. 路由（react-router v6，`web/src/App.tsx`）

```
/                     门户首页（宣传页）
/login                登录页（独立路由，也支持首页弹窗）
/register             注册页
/app                  编辑器（默认落地，需登录后使用云端；未登录=本地模式）
/account/:tab         个人中心（profile|storage|ai|backup|shares|billing|plugins|security）
/admin                管理后台（子路由：dashboard|users|ai|billing|plugins|shares|releases|oss|site|security）
/plugins              插件应用商店
/plugins/dev          插件开发指南
/download             全平台客户端下载
/s/:id                分享协作页（免登录）
/p/:id                发布 HTML 页（服务端直出，前端不处理）
```

## 5. 设计系统

- 令牌：`styles/tokens.css`（浅/深色 `html[data-theme]`）。
- 组件类（`styles/base.css`）：`.btn .btn-primary .btn-ghost .btn-danger .btn-icon .input .select .textarea .card .panel .menu .menu-item .modal .table .switch .badge .chip .tabs .kbd .empty .spinner .tooltip`。
- 视觉：Win11 Fluent —— 圆角 9/12/16、亚克力 `backdrop-filter: var(--blur)`、细边框、柔和阴影、Segoe UI 字体栈。
- 图标统一用内联 SVG（`components/Icon.tsx`，`name` 属性），不引第三方图标库。

## 6. 命名与命令 ID

命令 ID 采用 `域.动作`：`file.new / file.save / app.commandPalette / view.toggle / edit.find / h1..h6 / ai.polish` 等，
见 `contracts.ts` 的 `DEFAULT_SHORTCUTS`。插件命令 ID 前缀 `plugin.<pluginId>.<action>`。

## 7. 并行分工（写入范围，互不重叠）

| 成员 | 写入范围 |
|---|---|
| lead | 契约文件、`server/src/index.js`、`web/src/main.tsx`、`App.tsx`、`lib/*`、`styles/*`、`components/*`、部署脚本、README |
| server-core | `server/src/db/*`, `server/src/lib/{db,auth,storage,files,versions,export}.js`, `server/src/routes/{auth,files,versions,share,publish,storage,releases,site,plugins}.js`, `server/sql/*` |
| server-ai-admin | `server/src/lib/{aiProxy,billing}.js`, `server/src/routes/{ai,billing,admin}.js` |
| web-editor | `web/src/shell/*`, `web/src/features/editor/*`, `web/src/features/files/*`, `web/src/features/search/*` |
| web-portal | `web/src/features/marketing/*`, `features/auth/*`, `features/account/*`, `features/store/*`, `features/download/*` |
| web-admin | `web/src/features/admin/*` |
| plugins | `web/src/plugins/*` |
| packaging | `desktop/*`, `mobile/*`, `scripts/*`, `docs/PLUGIN-DEV.md`, `assets/*` |

公共组件（`web/src/components/*`）由 lead 提供，任何人需要新组件先向 lead 申请，禁止各自复制。
