# NeoM

> **极速 · AI 原生 · 全平台** —— 类 Obsidian 的 Markdown 知识库，Win11 Fluent 视觉风格，
> 25 款内置插件，多端实时同步，S3/OSS 对象存储，按量积分计费的 AI 服务。

- 网页版 / 门户 / 管理后台：**https://m.zhengl.vip**
- 登录：`https://m.zhengl.vip/login`（首页亦支持弹窗登录）
- 管理后台：`https://m.zhengl.vip/admin`

---

## 目录结构

```
NeoM/
├─ web/          React 18 + TypeScript + Vite 前端（门户 / 编辑器 / 用户中心 / Admin / 插件商店）
├─ server/       Node.js + Express 4 + MySQL 8 后端（唯一 API，端口 3300）
├─ desktop/      Electron 桌面端（Windows .exe + 绿色版 zip / macOS arm64 + x64 .dmg）
├─ mobile/       Capacitor 移动端（Android .apk / iOS .ipa）
├─ docs/         开发契约、插件开发指南、部署文档
├─ scripts/      构建、打包、上传 OSS、发布脚本
└─ assets/       图标与静态资源源文件
```

## 快速开始（本地开发）

```bash
# 1. 依赖
cd server && npm install
cd ../web && npm install

# 2. 环境变量：复制模板后填入真实值（.env 已被 gitignore）
cp server/.env.example server/.env

# 3. 初始化数据库（建表 + 种子数据 + 默认配置）
cd server && npm run db:init

# 4. 启动后端（http://127.0.0.1:3300）
cd server && npm start

# 5. 启动前端（http://127.0.0.1:5273，已配置 /api 代理）
cd web && npm run dev
```

生产构建：

```bash
cd web && npm run build      # => web/dist
cd server && npm start       # 服务 web/dist 静态文件 + /api
```

## 默认账号

| 角色 | 账号 | 密码 |
|---|---|---|
| 超级管理员 | `admin` | `NeoM@2026` |

> 首次登录后请立即在「个人中心 → 安全」中修改密码。

## 技术要点

| 领域 | 实现 |
|---|---|
| 编辑器内核 | Vditor（所见即所得 / 源码 / 对照 / 阅读四种模式） |
| Markdown 渲染 | marked + DOMPurify + highlight.js + KaTeX + Mermaid |
| 状态管理 | zustand（单一全局 store） |
| 文件存储 | 阿里云 OSS（S3 兼容），对象 key 按 `md/user/<用户名>/{tupian,bk,ot}` 组织 |
| 元数据 | MySQL 8（32 张表）+ 本地 SQLite 缓存（桌面端） |
| 认证 | JWT（7 天）+ bcrypt + 会话设备管理 |
| AI | 服务端代理（小米 mimo 官方渠道池，多 Key 轮询 / 故障切换），前端永不接触真实 Key |
| 计费 | 按 Token（缓存输入 / 未命中输入 / 输出分离计价）、按音频时长、按次、限时免费 |

## 平台支持

| 平台 | 产物 | 说明 |
|---|---|---|
| Windows x64 | `.exe` 安装包 + 绿色版 `.zip` | 绿色版解压即用；无标题栏；支持 `.md` 文件关联 |
| macOS | `.dmg`（arm64 / x64） | 隐藏式标题栏 + 红绿灯；LaunchServices `.md` 关联 |
| Web | 浏览器直连 | 含宣传首页、门户、在线编辑器、Admin |
| Android | `.apk` | 沉浸式状态栏；抽屉式侧栏；`.md` Intent Filter |
| iOS | `.ipa` | 安全区域适配；`.md` UTI 文档类型 |

## 安全说明

- 仓库中**不包含任何密钥**。所有 Key / Secret 通过 `server/.env` 注入，或加密（AES-256-GCM）存储在数据库。
- 前端代码与 API 响应**永不**包含官方 AI Key 与 OSS Secret。
- 公共 OSS 桶保持私有读写，所有访问由后端生成签名 URL 或经自定义域名代理。
- 管理后台所有写操作均写入审计日志。

## 文档

- [开发契约](docs/CONTRACTS.md) —— API、数据表、store、设计令牌的唯一权威
- [插件开发指南](docs/PLUGIN-DEV.md)
- [部署文档](docs/DEPLOYMENT.md)
- [移动端构建](docs/MOBILE-BUILD.md)

## License

Proprietary — © 2026 NeoM. All rights reserved.
