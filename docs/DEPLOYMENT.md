# NeoM 部署文档

生产环境：**https://m.zhengl.vip**
云服务器：宝塔面板（`baota-mcp`） · Nginx · Node 24 · MySQL 8

---

## 1. 环境事实

| 项 | 值 |
|---|---|
| 主域名 | `m.zhengl.vip`（DNS → 服务器 IP，泛解析 `*.zhengl.vip` 已就绪） |
| SSL | `*.zhengl.vip` 通配证书（TrustAsia），有效期至 2027-01-13 |
| 数据库 | MySQL 8.0.45 · 库 `neom` · 用户 `NeoM`（仅本机 `127.0.0.1` 授权，`%` 远程亦已配置用于本地开发） |
| 对象存储 | 阿里云 OSS · Bucket `zhengle` · 自定义域名 `mdadmin.zhengl.vip` · 私有读写 + 后端签名 |
| Node | v24.14.1（面板已安装） |
| 应用端口 | `3300`（Node 项目，由 Nginx 反代） |
| 站点根目录 | `/www/wwwroot/m.zhengl.vip` |

---

## 2. 目录布局（服务器）

```
/www/wwwroot/m.zhengl.vip/
├─ server/               后端（node src/index.js，监听 3300）
│  ├─ src/
│  ├─ sql/
│  ├─ data/plugins/      用户上传的插件包
│  └─ .env               真实密钥（chmod 600，绝不入库）
└─ web/                  web/dist 前端静态产物
```

`server/src/index.js` 通过 `WEB_ROOT` 环境变量指向 `../web/dist`，由后端直接托管静态文件（避免额外的 Nginx 静态规则冲突）。

---

## 3. 环境变量（`server/.env`）

```dotenv
NODE_ENV=production
PORT=3300
HOST=127.0.0.1

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=neom
DB_USER=NeoM
DB_PASSWORD=<MySQL 密码>

JWT_SECRET=<32+ 字节随机串>
JWT_EXPIRES=7d
SECRETS_KEY=<32 字节 hex —— 用于 AES-256-GCM 加密 API Key / OSS Secret>

PUBLIC_BASE_URL=https://m.zhengl.vip
WEB_ROOT=/www/wwwroot/m.zhengl.vip/web/dist

# 公共 OSS（私有桶，后端签名）
OSS_BUCKET=zhengle
OSS_ENDPOINT=oss-cn-guangzhou.aliyuncs.com
OSS_REGION=oss-cn-guangzhou
OSS_DOMAIN=https://mdadmin.zhengl.vip
OSS_AK=<AccessKeyId>
OSS_SK=<AccessKeySecret>
OSS_PREFIX_ADMIN=md/mdadmin
OSS_PREFIX_USER=md/user

# 小米 mimo 官方 AI（服务端专用；数据库内另存加密副本）
MIMO_API_KEY=<Key>
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
```

> **安全**：`.env` 权限 `600`，属主 `www`。所有真实密钥仅存在于服务器与数据库加密列，仓库与前端零密钥。

---

## 4. 数据库初始化

```bash
cd /www/wwwroot/m.zhengl.vip/server
node src/db/init.js            # 建表 + 种子 + 默认配置（幂等）
node src/db/init.js seed --force   # 强制重跑种子
```

初始化内容：
- 32 张业务表
- 管理员账号 `admin` / `NeoM@2026`（**上线后必须修改**）
- 小米 mimo 渠道池 + 7 个模型及价格（pro / flash / pro-ultraspeed / asr / tts / tts-voicedesign / tts-voiceclone）
- 9 个 AI 供应商预设
- 25 款内置插件元数据
- 站点配置、6 个门户特性卡片、4 档充值套餐、公共 OSS 配置、6 个平台 releases 占位

---

## 5. 部署步骤

### 5.1 构建前端

```bash
cd web && npm ci && npm run build     # => web/dist
```

### 5.2 上传

```bash
rsync -az --delete web/dist/ root@<server>:/www/wwwroot/m.zhengl.vip/web/dist/
rsync -az server/src server/sql server/package.json root@<server>:/www/wwwroot/m.zhengl.vip/server/
rsync -az server/.env root@<server>:/www/wwwroot/m.zhengl.vip/server/.env
```

### 5.3 安装依赖并启动

```bash
cd /www/wwwroot/m.zhengl.vip/server
npm ci --omit=dev
chmod 600 .env && chown -R www:www /www/wwwroot/m.zhengl.vip
```

通过宝塔面板注册 Node 项目（或直接用 `baota-mcp` 的 `NodeProjectCreate`）：

| 参数 | 值 |
|---|---|
| 项目名 | `neom` |
| 项目目录 | `/www/wwwroot/m.zhengl.vip/server` |
| 启动脚本 | `src/index.js` |
| Node 版本 | `v24.14.1` |
| 端口 | `3300` |
| 运行用户 | `www` |
| 域名 | `m.zhengl.vip` |

### 5.4 Nginx 反代（由面板生成，关键片段）

```nginx
server {
    listen 80;
    server_name m.zhengl.vip;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name m.zhengl.vip;

    ssl_certificate     /www/server/panel/vhost/cert/m.zhengl.vip/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/m.zhengl.vip/privkey.pem;

    client_max_body_size 64m;

    location / {
        proxy_pass         http://127.0.0.1:3300;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 300s;
        proxy_buffering    off;   # SSE 流式 AI 必需
    }
}
```

---

## 6. 验证清单

```bash
curl -s https://m.zhengl.vip/api/health          # {"status":true,"data":{"db":true,...}}
curl -sI https://m.zhengl.vip/                   # 200 + 前端 HTML
curl -s https://m.zhengl.vip/api/releases | head
```

- [ ] 首页渲染正常，深浅色切换正常
- [ ] `/login` 可用，`admin` 能登录
- [ ] `/app` 编辑器可新建/编辑/保存文档
- [ ] `/admin` 管理后台可进入，Dashboard 有数据
- [ ] 图片上传返回 OSS 链接并可访问
- [ ] AI 对话可流式返回并扣积分
- [ ] 分享链接 `/s/:id` 免登录可访问
- [ ] `/download` 展示 6 平台并指向 OSS

---

## 7. 客户端发布

```bash
# 1. 打包（需在对应平台执行；Windows 绿色版/安装包可在本机产出）
npm --prefix desktop run build:win
npm --prefix desktop run build:mac      # 需 macOS 或 CI

# 2. 上传到公共 OSS md/mdadmin/
OSS_AK=... OSS_SK=... node scripts/upload-oss.mjs

# 3. 登记到后台 releases 表
NEOM_ADMIN_TOKEN=... node scripts/publish-release.mjs
```

产物命名规范（与 `releases` 表一致）：

| 平台 | 文件名 |
|---|---|
| Windows 安装版 | `NeoM-<ver>-win-x64-setup.exe` |
| Windows 绿色版 | `NeoM-<ver>-win-x64-green.zip` |
| macOS ARM | `NeoM-<ver>-mac-arm64.dmg` |
| macOS Intel | `NeoM-<ver>-mac-x64.dmg` |
| Android | `NeoM-<ver>-android.apk` |
| iOS | `NeoM-<ver>-ios.ipa` |

---

## 8. 运维

| 任务 | 命令 |
|---|---|
| 查看日志 | `tail -f /www/wwwlogs/nodejs/neom.log` |
| 重启 | 面板 → Node 项目 → 重启（或 `pm2 restart neom`） |
| 备份数据库 | 后台「系统安全 → 一键备份」，或 `mysqldump neom > /tmp/neom-$(date +%F).sql` |
| 更新前端 | 重新 `npm run build` 后 rsync，无需重启 |
| 更新后端 | rsync + 重启 |
| 健康检查 | `GET /api/health`（含 `mounted` 路由列表，便于判断模块是否加载） |

---

## 9. 回滚

1. 前端：保留上一版 `web/dist` 为 `web/dist.prev`，回滚即换回并刷新 CDN。
2. 后端：`git checkout <prev-tag>` + 重启。
3. 数据库：恢复最近一次 `mysqldump` 备份（**注意**：迁移脚本未做向下兼容时需一并回滚代码）。
