-- =====================================================================
-- NeoM defaults: docs / sensitive words / notifications / extra settings
-- =====================================================================
SET NAMES utf8mb4;

-- 1. site documents
INSERT INTO site_docs (k,title,content) VALUES ('terms','服务条款','# NeoM 服务条款\n\n欢迎使用 NeoM（以下简称\"本服务\"）。注册或使用本服务即表示你已阅读并同意本条款。\n\n## 1. 账号\n- 你需对账号下的全部行为负责，请妥善保管密码。\n- 禁止将账号出售、出借或共享给他人用于违法用途。\n- 我们有权对违规账号采取限制功能、封禁等措施。\n\n## 2. 内容\n- 你对自己创建、上传、发布的内容拥有著作权，并对其合法性负责。\n- 禁止发布违法、侵权、色情、暴力、诈骗、赌博等内容。\n- 我们提供内容审核机制，违规内容将被删除，严重者移交司法机关。\n\n## 3. 积分与付费\n- 积分用于抵扣 AI 调用等资源消耗，充值后不可退款，除非法律另有规定。\n- 积分价格与模型计费标准以站内公示为准，我们保留调整权并提前公告。\n\n## 4. 服务变更与中断\n- 本服务按\"现状\"提供，我们会尽力保障可用性，但不对因不可抗力、网络故障导致的中断承担责任。\n- 我们可能随时升级或调整功能，重大变更将提前公告。\n\n## 5. 联系方式\n如有疑问请联系 support@zhengl.vip。')
ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content);
INSERT INTO site_docs (k,title,content) VALUES ('privacy','隐私政策','# NeoM 隐私政策\n\n我们重视你的隐私，本政策说明我们收集哪些信息以及如何使用。\n\n## 1. 收集的信息\n- 账号信息：用户名、加密后的密码、可选邮箱/手机号、昵称与头像。\n- 使用信息：登录日志（IP、设备、时间）、AI 调用记录（模型、token 数、耗时）与积分流水。\n- 内容信息：你创建的文档存储在对象存储（阿里云 OSS）中，服务端仅保存索引元数据。\n\n## 2. 信息用途\n- 提供登录鉴权、跨端同步、计费结算与故障排查。\n- 安全风控：识别异常登录、滥用与攻击行为。\n- 我们不会将你的文档内容用于模型训练，也不会出售你的个人信息。\n\n## 3. 存储与安全\n- 密码使用 bcrypt（cost 10）单向哈希存储，任何人（含管理员）都无法还原明文。\n- 第三方密钥（OSS AK/SK、AI API Key）使用 AES-256-GCM 加密存储。\n- 文件通过签名 URL 访问，默认不公开。\n\n## 4. 你的权利\n- 你可以随时导出或删除自己的文档与账号数据。\n- 账号注销后，我们将在 30 天内清除你的个人信息与文件（法律要求保留的除外）。\n\n## 5. 联系我们\n隐私相关问题请联系 support@zhengl.vip。')
ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content);
INSERT INTO site_docs (k,title,content) VALUES ('plugin-dev','插件开发指南','# NeoM 插件开发指南\n\n插件是一个 zip 包，内含 manifest.json 与入口 JS，通过插件 API 扩展 NeoM 的界面与能力。\n\n## 1. 目录结构\n```\nmy-plugin.zip\n├── manifest.json\n├── index.js\n└── assets/icon.svg\n```\n\n## 2. manifest.json\n```json\n{\n  \"id\": \"my-plugin\",\n  \"name\": \"我的插件\",\n  \"version\": \"1.0.0\",\n  \"minAppVersion\": \"1.0.0\",\n  \"description\": \"示例插件\",\n  \"author\": \"you\",\n  \"category\": \"productivity\",\n  \"icon\": \"sparkles\",\n  \"entry\": \"index.js\",\n  \"permissions\": [\"files:read\", \"files:write\"],\n  \"defaultEnabled\": false,\n  \"contributes\": {\n    \"ribbon\": true,\n    \"commands\": [{ \"id\": \"plugin.my-plugin.hello\", \"name\": \"打个招呼\" }]\n  }\n}\n```\n\n## 3. 入口 JS\n```js\nexport default {\n  onload(app) {\n    app.commands.register(\'plugin.my-plugin.hello\', () => app.toast(\'你好，NeoM！\'))\n  },\n  onunload(app) {\n    app.commands.unregister(\'plugin.my-plugin.hello\')\n  }\n}\n```\n\n## 4. 可用权限\n| 权限 | 说明 |\n|---|---|\n| files:read | 读取当前仓库文件 |\n| files:write | 写入当前仓库文件 |\n| ai | 调用 AI 模型接口 |\n| share | 创建分享与发布页 |\n| network | 发起外部网络请求（需审核） |\n\n## 5. 上传与审核\n在「插件 → 上传插件」选择 zip（< 5MB），系统会校验 manifest 必填字段并解压到服务端。上传后进入待审核状态，管理员通过后即可安装。\n\n## 6. 命令 ID 规范\n插件命令必须是 `plugin.<pluginId>.<action>` 三段式，例如 `plugin.canvas.open`。')
ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content);

-- 2. sensitive words (share comment filter)
INSERT INTO sensitive_words (word,action) VALUES ('法轮功','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('六四','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('赌博','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('博彩','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('色情','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('裸聊','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('毒品','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('冰毒','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('枪支','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('炸药','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('代开发票','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('办证','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('洗钱','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('诈骗','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('杀猪盘','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('翻墙软件','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('政治敏感','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('习近平','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('fuck','block') ON DUPLICATE KEY UPDATE action='block';
INSERT INTO sensitive_words (word,action) VALUES ('porn','block') ON DUPLICATE KEY UPDATE action='block';

-- 3. welcome notification (broadcast)
INSERT INTO notifications (user_id,kind,title,content)
SELECT NULL,'system','欢迎使用 NeoM','NeoM 1.0.0 已上线：注册赠送 100 积分，AI 助手与全部内置插件可用。遇到问题请联系 support@zhengl.vip。'
WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE kind='system' AND title='欢迎使用 NeoM');

-- 4. misc defaults
INSERT INTO sys_settings (k,v) VALUES ('share_title_tpl','{{name}} · NeoM 分享') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('publish_title_tpl','{{name}} · NeoM') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('max_versions_per_file','200') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('version_dedupe_minutes','10') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('recycle_keep_days','30') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('recycle_max_items','500') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('search_max_hits','200') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('ai_default_scene_chat','mimo-v2.6-flash') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('ai_default_scene_naming','mimo-v2.6-flash') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('ai_default_scene_asr','mimo-v2.5-asr') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
INSERT INTO sys_settings (k,v) VALUES ('ai_default_scene_tts','mimo-v2.5-tts') ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);
