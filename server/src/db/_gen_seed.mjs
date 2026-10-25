/**
 * One-off generator for sql/002_seed.sql + sql/003_defaults.sql.
 * Kept out of the runtime path. Run: node src/db/_gen_seed.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2';
import { SERVER_ROOT, encryptSecret, env } from '../lib/util.js';

const q = (v) => (v === null || v === undefined ? 'NULL' : mysql.escape(v));
const numQ = (v) => (v === null || v === undefined ? 'NULL' : Number(v));
const PWD_HASH = '$2b$10$dTFwLkBa0FJLVnVJ8/qe.OU8INx/PgOuYmWX1A8yK3ikh5Ve0uVAq'; // NeoM@2026

/* ------------------------------- site config ------------------------------ */
const FEATURES = [
  { id: 'editor', icon: 'editor', title: '所见即所得编辑器', desc: 'Vditor 内核，Markdown 即时渲染，支持图表、公式、脚注、任务列表与分屏源码视图。', link: '/register' },
  { id: 'ai', icon: 'ai', title: 'AI 写作助手', desc: '润色、扩写、摘要、翻译、命名与语音转写一站式接入，按量计费，几分钱一篇长文。', link: '/register' },
  { id: 'cloud', icon: 'cloud', title: '云端仓库同步', desc: '文档自动存阿里云 OSS，对象存储直连，多端实时同步，本地零残留。', link: '/download' },
  { id: 'plugins', icon: 'plugin', title: '24 款内置插件', desc: '白板、关系图谱、幻灯片、日记、随机漫游、字数统计，也可安装第三方插件。', link: '/plugins' },
  { id: 'share', icon: 'share', title: '分享与发布', desc: '一键生成免登录阅读页，支持评论、密码与有效期，发布页服务端直出可被搜索引擎收录。', link: '/register' },
  { id: 'multi', icon: 'devices', title: '全平台客户端', desc: 'Windows / macOS / Android / iOS / Linux，桌面端支持本地仓库与绿色版便携运行。', link: '/download' }
];

const FOOTER = {
  columns: [
    { title: '产品', links: [{ text: '功能特性', href: '/#features' }, { text: '应用商店', href: '/plugins' }, { text: '客户下载', href: '/download' }] },
    { title: '资源', links: [{ text: '插件开发', href: '/plugins/dev' }, { text: '服务条款', href: '/terms' }, { text: '隐私政策', href: '/privacy' }] },
    { title: '支持', links: [{ text: '帮助中心', href: '/plugins/dev' }, { text: '邮箱支持', href: 'mailto:support@zhengl.vip' }] }
  ],
  copyright: '© 2026 NeoM · 郑力工作室',
  icp: '粤ICP备2026000000号'
};

/* -------------------------------- plugins -------------------------------- */
// [id, name, category, icon, defaultEnabled, description, commands]
const PLUGINS = [
  ['canvas', '白板画布', 'visualization', 'canvas', true, '无限画布 + 卡片节点 + 连线，用于思维整理与流程草图。', [['open', '打开白板'], ['new', '新建白板']]],
  ['note-restructure', '笔记重组', 'productivity', 'shuffle', false, '按标题层级一键重构笔记结构，自动编号与目录生成。', [['run', '重组当前笔记']]],
  ['tag-list', '标签列表', 'data', 'tag', true, '汇总全库 #标签，按出现次数排序并可一键跳转。', [['open', '打开标签面板']]],
  ['outgoing-links', '出链', 'data', 'arrow-up-right', true, '列出当前文档指向的其他文档（wiki 链接）。', [['open', '查看出链']]],
  ['outline', '大纲', 'productivity', 'list', true, '提取标题生成可点击大纲，随滚动高亮。', [['open', '打开大纲'], ['toggle', '切换大纲']]],
  ['publish', '发布收藏', 'publish', 'send', false, '把笔记发布为公开 HTML 页面，支持密码与加密。', [['run', '发布当前文档']]],
  ['backlinks', '反向链接', 'data', 'link', true, '展示哪些文档引用了当前文档，构建知识网络。', [['open', '查看反向链接']]],
  ['workspace', '工作区', 'productivity', 'layers', true, '多工作区切换，隔离不同项目的文件与配置。', [['open', '切换工作区']]],
  ['graph', '关系图谱', 'visualization', 'graph', true, '全局/局部知识图谱，力导向布局，点击跳转。', [['open', '打开图谱'], ['local', '当前文档局部图谱']]],
  ['slides', '幻灯片', 'visualization', 'presentation', false, '把 Markdown 按 --- 分页演示，支持演讲者视图。', [['run', '开始演示']]],
  ['footnote-view', '脚注视图', 'productivity', 'footnote', false, '集中查看与跳转文档内所有脚注。', [['open', '查看脚注']]],
  ['quick-switcher', '快速切换', 'productivity', 'search', true, 'Alt+P 模糊搜索并跳转到任意文档。', [['open', '快速切换文档']]],
  ['recorder', '录音转写', 'media', 'mic', false, '录音并调用 ASR 模型转成文字插入正文。', [['start', '开始录音'], ['stop', '停止录音']]],
  ['random-note', '随机漫游', 'productivity', 'dice', false, '随机打开一篇笔记，回顾旧知识。', [['open', '随机打开笔记']]],
  ['daily-notes', '日记', 'productivity', 'calendar', true, '按日期自动创建日记文件，支持模板与连续日历。', [['open', '打开今日日记'], ['calendar', '日记日历']]],
  ['bookmarks', '书签', 'productivity', 'bookmark', true, '收藏常用文档与位置，一键回到上次阅读点。', [['open', '打开书签']]],
  ['properties', '文档属性', 'data', 'settings', true, '在 YAML front-matter 中维护标题、标签、状态等属性。', [['open', '编辑文档属性']]],
  ['database', '数据库视图', 'data', 'table', false, '把带 front-matter 的笔记聚合成表格/看板视图并筛选排序。', [['open', '打开数据库视图']]],
  ['web-browser', '内置浏览器', 'media', 'globe', false, '在应用内打开网页，可一键剪藏为 Markdown。', [['open', '打开浏览器']]],
  ['file-recovery', '文件恢复', 'core', 'history', true, '回收站与历史版本恢复，支持按时间点回滚。', [['open', '打开回收站']]],
  ['file-explorer', '文件浏览', 'core', 'folder', true, '树形文件浏览器，支持拖拽排序、重命名、移动与多选。', [['open', '打开文件面板']]],
  ['slash-commands', '斜杠命令', 'productivity', 'command', true, '输入 / 唤起命令面板，快速插入块、调用插件。', [['open', '打开斜杠菜单']]],
  ['page-preview', '页面预览', 'core', 'eye', true, 'Hover 预览文档内容与大纲，无需打开标签页。', [['toggle', '切换预览']]],
  ['word-count', '字数统计', 'core', 'counter', true, '实时统计字数、字符数、段落数与阅读时长。', [['toggle', '切换字数统计']]],
  ['ai', 'AI 助手', 'ai', 'sparkles', true, '官方模型直连：润色/扩写/摘要/翻译/命名/ASR/TTS，按积分计费。', [['open', '打开 AI 助手'], ['polish', 'AI 润色'], ['summary', 'AI 摘要']]]
];

const CATEGORY_LABEL = {
  core: '核心', visualization: '可视化', productivity: '效率', media: '媒体', data: '数据', ai: 'AI', publish: '发布'
};

function pluginManifest(p) {
  const [id, name, category, icon, defaultEnabled, description, cmds] = p;
  return {
    id,
    name,
    version: '1.0.0',
    minAppVersion: '1.0.0',
    description,
    author: 'NeoM',
    category,
    icon,
    builtin: true,
    entry: `plugins/${id}/index.js`,
    permissions: id === 'ai' ? ['ai', 'files:read', 'files:write'] : id === 'publish' ? ['files:read', 'share'] : ['files:read'],
    defaultEnabled,
    contributes: {
      ribbon: ['canvas', 'graph', 'ai', 'daily-notes', 'outline', 'tag-list', 'slides'].includes(id),
      leftPanel: ['file-explorer', 'outline', 'tag-list', 'graph', 'bookmarks', 'daily-notes'].includes(id),
      rightPanel: ['backlinks', 'outgoing-links', 'properties', 'ai', 'footnote-view', 'page-preview'].includes(id),
      statusItem: ['word-count', 'recorder', 'quick-switcher'].includes(id),
      commands: cmds.map(([action, cname]) => ({ id: `plugin.${id}.${action}`, name: cname }))
    }
  };
}

/* ---------------------------------- AI ----------------------------------- */
const PROVIDERS = [
  ['mimo', '小米 mimo', 'mimo', 'https://api.xiaomimimo.com/v1/chat/completions', 'https://api.xiaomimimo.com/v1/responses', 'https://api.xiaomimimo.com/anthropic/v1/messages', 'https://api.xiaomimimo.com', 1, 1, 1],
  ['deepseek', 'DeepSeek', 'deepseek', 'https://api.deepseek.com/v1/chat/completions', null, null, 'https://platform.deepseek.com/api_keys', 1, 1, 2],
  ['qwen', '通义千问', 'qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', null, null, 'https://bailian.console.aliyun.com/', 1, 1, 3],
  ['tencent', '腾讯云', 'tencent', 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', null, null, 'https://console.cloud.tencent.com/hunyuan/api-key', 1, 1, 4],
  ['zhipu', '智谱 Zhipu', 'zhipu', 'https://open.bigmodel.cn/api/paas/v4/chat/completions', null, null, 'https://open.bigmodel.cn/usercenter/apikeys', 1, 1, 5],
  ['volcengine', '火山引擎', 'volcengine', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', null, null, 'https://console.volcengine.com/ark', 1, 1, 6],
  ['qianfan', '百度千帆', 'qianfan', 'https://qianfan.baidubce.com/v2/chat/completions', null, null, 'https://console.bce.baidu.com/qianfan', 1, 1, 7],
  ['openai-compatible', '自定义 [OI] 兼容', 'openai-compatible', '', null, null, '', 1, 0, 8],
  ['anthropic', '自定义 Anthropic 兼容', 'anthropic', null, null, '', '', 1, 0, 9]
];

const M = 'mimo';
const BIG = 1048576;
const OUT = 131072;
const MODELS = [
  // id, provider, label, category, ctx, maxOut, rpm, tpm, billing, cacheIn, in, out, audioHour, call, recommended_for, tag, sort
  ['mimo-v2.6-pro', M, 'MiMo v2.6 Pro', 'omni', BIG, OUT, 100, 10000000, 'token', 0.025, 3.0, 6.0, 0, 0, '长文写作 / 复杂推理 / 多模态', '旗舰', 1],
  ['mimo-v2.6-flash', M, 'MiMo v2.6 Flash', 'text', BIG, OUT, 100, 10000000, 'token', 0.02, 1.0, 2.0, 0, 0, '日常对话 / 批量处理 / 高并发', '极速', 2],
  ['mimo-v2.6-pro-ultraspeed', M, 'MiMo v2.6 Pro Ultraspeed', 'text', BIG, OUT, 100, 10000000, 'token', 0.025, 3.0, 6.0, 0, 0, '低延迟长文 / 实时续写', '极速', 3],
  ['mimo-v2.5-asr', M, 'MiMo v2.5 ASR', 'asr', 8192, 2048, 100, 10000, 'audio', 0, 0, 0, 0.5, 0, '录音转写 / 会议纪要', '语音', 4],
  ['mimo-v2.5-tts', M, 'MiMo v2.5 TTS', 'tts', BIG, OUT, 100, 10000000, 'free', 0, 0, 0, 0, 0, '文本转语音 / 朗读', '限免', 5],
  ['mimo-v2.5-tts-voicedesign', M, 'MiMo v2.5 TTS 音色设计', 'tts', BIG, OUT, 100, 10000000, 'free', 0, 0, 0, 0, 0, '自定义音色设计 / 角色配音', '限免', 6],
  ['mimo-v2.5-tts-voiceclone', M, 'MiMo v2.5 TTS 音色克隆', 'voiceclone', BIG, OUT, 100, 10000000, 'call', 0, 0, 0, 0, 0, '声音克隆 / 专属音色', '克隆', 7]
];

/* -------------------------------- releases -------------------------------- */
const PLATFORMS = [
  ['win-x64', 'NeoM-1.0.0-win-x64.exe', 92_000_000],
  ['win-green', 'NeoM-1.0.0-win-x64-portable.zip', 96_500_000],
  ['mac-arm64', 'NeoM-1.0.0-arm64.dmg', 105_000_000],
  ['mac-x64', 'NeoM-1.0.0-x64.dmg', 108_000_000],
  ['android', 'NeoM-1.0.0-android.apk', 38_000_000],
  ['ios', 'NeoM-1.0.0-ios.ipa', 42_000_000]
];

const MD_DOMAIN = 'https://mdadmin.zhengl.vip';
const ADMIN_PREFIX = 'md/mdadmin';

/* ------------------------------- packages -------------------------------- */
const PACKAGES = [
  ['pkg-1000', '入门包', 10, 1000, 0, '', 1],
  ['pkg-5200', '进阶包', 50, 5000, 200, '最受欢迎', 2],
  ['pkg-11000', '专业包', 100, 10000, 1000, '超值', 3],
  ['pkg-60000', '创作包', 500, 50000, 10000, '团队首选', 4]
];

/* --------------------------------- build --------------------------------- */
const out = [];
const push = (s) => out.push(s);

push(`-- =====================================================================`);
push(`-- NeoM seed data (idempotent). Generated by src/db/_gen_seed.mjs`);
push(`-- admin account: admin / NeoM@2026  (bcrypt cost 10)`);
push(`-- =====================================================================`);
push(`SET NAMES utf8mb4;`);
push('');

/* admin user */
push('-- 1. default administrator (password: NeoM@2026, gift 100000 points)');
push(
  `INSERT INTO users (username,email,password_hash,nickname,role,points,status,storage_quota_mb,rpm_limit,tpm_limit,settings_json)
VALUES ('admin','admin@zhengl.vip',${q(PWD_HASH)},'管理员','admin',100000.0000,'active',102400,300,5000000,
        ${q(JSON.stringify({ theme: 'system', accent: '#2f6fed', signupGift: 100000 }))})
ON DUPLICATE KEY UPDATE role='admin', status='active', nickname='管理员', password_hash=VALUES(password_hash);`
);
push('');
push(`INSERT INTO vaults (user_id,name,kind)
SELECT id,'default','cloud' FROM users WHERE username='admin'
ON DUPLICATE KEY UPDATE kind='cloud';`);
push('');

/* site_config */
push('-- 2. portal site config');
const siteRows = [
  ['site_name', 'NeoM'],
  ['site_title', 'NeoM · 云端 Markdown 写作工作台'],
  ['site_desc', 'NeoM 是一款面向长文写作的云端 Markdown 编辑器：AI 辅助、插件扩展、全平台同步、一键分享发布。'],
  ['banner_title', '把想法写成作品'],
  ['banner_sub', 'NeoM 云端 Markdown 工作台 —— AI 辅助写作、知识图谱、插件扩展，Windows / macOS / 移动端全平台同步。'],
  ['banner_image', ''],
  ['banner_cta', '免费开始写作'],
  ['features', FEATURES],
  ['footer', FOOTER],
  ['icp', FOOTER.icp],
  ['copyright', FOOTER.copyright],
  ['contact', 'support@zhengl.vip'],
  ['agreement', 'https://m.zhengl.vip/terms'],
  ['announcement', 'NeoM 1.0.0 正式发布，注册即送 100 积分，AI 助手限时免费体验。'],
  ['notice', ''],
  ['register_enabled', '1'],
  ['default_theme', 'system'],
  ['download_title', '下载 NeoM 客户端'],
  ['oss_domain', MD_DOMAIN],
  ['client_version', '1.0.0'],
  ['mobile_base', env.publicBase]
];
for (const [k, v] of siteRows) {
  push(`INSERT INTO site_config (k,v) VALUES (${q(k)},${q(typeof v === 'string' ? v : JSON.stringify(v))})
ON DUPLICATE KEY UPDATE v=VALUES(v);`);
}
push('');

/* sys_settings */
push('-- 3. system settings (secrets are AES-256-GCM encrypted, key from env SECRETS_KEY)');
const sysRows = [
  ['register_gift_points', '100'],
  ['signin_points', '100'],
  ['point_per_cny', '100'],
  ['pay_enabled', '0'],
  ['register_enabled', '1'],
  ['upload_max_mb', '50'],
  ['share_comment_limit', '10'],
  ['share_comment_window', '600'],
  ['oss_bucket', env.oss.bucket],
  ['oss_endpoint', env.oss.endpoint],
  ['oss_region', env.oss.region],
  ['oss_domain', env.oss.domain],
  ['oss_prefix_admin', env.oss.prefixAdmin],
  ['oss_prefix_user', env.oss.prefixUser],
  ['oss_ak_enc', encryptSecret(env.oss.ak)],
  ['oss_sk_enc', encryptSecret(env.oss.sk)],
  ['mimo_api_key_enc', encryptSecret(env.mimo.apiKey)],
  ['ai_official_enabled', '1'],
  ['version', '1.0.0']
];
for (const [k, v] of sysRows) {
  push(`INSERT INTO sys_settings (k,v) VALUES (${q(k)},${q(v)})
ON DUPLICATE KEY UPDATE v=VALUES(v);`);
}
push('');

/* recharge packages */
push('-- 4. recharge packages');
for (const [id, name, price, points, bonus, tag, sort] of PACKAGES) {
  push(`INSERT INTO recharge_packages (id,name,price,points,bonus,tag,enabled,sort)
VALUES (${q(id)},${q(name)},${numQ(price)},${numQ(points)},${numQ(bonus)},${q(tag)},1,${sort})
ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),points=VALUES(points),bonus=VALUES(bonus),tag=VALUES(tag),sort=VALUES(sort);`);
}
push('');

/* plugins */
push('-- 5. built-in plugins (24 builtin + 1 ai plugin)');
for (let i = 0; i < PLUGINS.length; i++) {
  const p = PLUGINS[i];
  const manifest = pluginManifest(p);
  push(
    `INSERT INTO plugins (id,name,version,description,author,category,icon,builtin,manifest_json,status,downloads,rating,default_enabled,sort)
VALUES (${q(p[0])},${q(p[1])},'1.0.0',${q(p[5])},'NeoM',${q(CATEGORY_LABEL[p[2]] || p[2])},${q(p[3])},1,${q(JSON.stringify(manifest))},'published',0,5.00,${p[4] ? 1 : 0},${i + 1})
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category),icon=VALUES(icon),manifest_json=VALUES(manifest_json),default_enabled=VALUES(default_enabled),sort=VALUES(sort);`
  );
  push(
    `INSERT INTO plugin_versions (plugin_id,version,changelog,status) VALUES (${q(p[0])},'1.0.0','首个内置版本','published')
ON DUPLICATE KEY UPDATE changelog=VALUES(changelog);`
  );
}
push('');

/* ai providers */
push('-- 6. ai providers');
for (const [id, name, kind, chat, resp, anthropic, doc, needsKey, builtin, sort] of PROVIDERS) {
  push(
    `INSERT INTO ai_providers (id,name,kind,base_url_chat,base_url_responses,base_url_anthropic,api_doc_url,needs_key,builtin,enabled,sort)
VALUES (${q(id)},${q(name)},${q(kind)},${q(chat)},${q(resp)},${q(anthropic)},${q(doc)},${needsKey},${builtin},1,${sort})
ON DUPLICATE KEY UPDATE name=VALUES(name),kind=VALUES(kind),base_url_chat=VALUES(base_url_chat),base_url_responses=VALUES(base_url_responses),base_url_anthropic=VALUES(base_url_anthropic),api_doc_url=VALUES(api_doc_url),needs_key=VALUES(needs_key),builtin=VALUES(builtin),sort=VALUES(sort);`
  );
}
push('');

/* ai models */
push('-- 7. ai models + pricing (¥ per 1M tokens / per audio hour / per call)');
for (const m of MODELS) {
  const [id, prov, label, category, ctx, maxOut, rpm, tpm, billing, cacheIn, pin, pout, audioHour, call, rec, tag, sort] = m;
  push(
    `INSERT INTO ai_models (id,provider_id,label,category,context_window,max_output,rpm,tpm,billing,price_cache_in,price_in,price_out,price_audio_hour,price_call,recommended_for,tag,enabled,sort)
VALUES (${q(id)},${q(prov)},${q(label)},${q(category)},${ctx},${maxOut},${rpm},${tpm},${q(billing)},${numQ(cacheIn)},${numQ(pin)},${numQ(pout)},${numQ(audioHour)},${numQ(call)},${q(rec)},${q(tag)},1,${sort})
ON DUPLICATE KEY UPDATE provider_id=VALUES(provider_id),label=VALUES(label),category=VALUES(category),context_window=VALUES(context_window),max_output=VALUES(max_output),rpm=VALUES(rpm),tpm=VALUES(tpm),billing=VALUES(billing),price_cache_in=VALUES(price_cache_in),price_in=VALUES(price_in),price_out=VALUES(price_out),price_audio_hour=VALUES(price_audio_hour),price_call=VALUES(price_call),recommended_for=VALUES(recommended_for),tag=VALUES(tag),sort=VALUES(sort);`
  );
}
push('');

/* ai channel: mimo official key */
push('-- 8. official mimo channel (api key encrypted at rest)');
const mimoKey = env.mimo.apiKey;
const mimoMask = mimoKey ? `${mimoKey.slice(0, 6)}${'*'.repeat(10)}${mimoKey.slice(-4)}` : null;
push(
  `INSERT INTO ai_channels (provider_id,name,api_key_enc,api_key_mask,base_url,weight,enabled,status,models_json)
SELECT ${q('mimo')},'官方主渠道',${q(encryptSecret(mimoKey))},${q(mimoMask)},${q(env.mimo.baseUrl)},10,1,'active',${q(JSON.stringify(MODELS.filter((m) => m[1] === 'mimo').map((m) => m[0])))}
WHERE NOT EXISTS (SELECT 1 FROM ai_channels WHERE provider_id='mimo' AND name='官方主渠道');`
);
push('');

/* releases */
push('-- 9. release placeholders (1.0.0 for 6 platforms)');
const CHANGELOG = `## NeoM 1.0.0\n- 全新 Markdown 所见即所得编辑器（Vditor 3.11）\n- AI 助手：润色 / 扩写 / 摘要 / 翻译 / 命名 / 语音转写 / 语音合成\n- 24 款内置插件 + 插件商店与开发者上传\n- 云端仓库：对象存储直连、版本历史、回收站\n- 分享 / 发布：免登录阅读、评论、密码与有效期\n- 全平台客户端：Windows / macOS / Android / iOS / Linux`;
for (const [platform, filename, size] of PLATFORMS) {
  const key = `${ADMIN_PREFIX}/${filename}`;
  push(
    `INSERT INTO releases (platform,version,filename,size,oss_key,url,sha256,changelog,forced,channel,downloads)
VALUES (${q(platform)},'1.0.0',${q(filename)},${numQ(size)},${q(key)},${q(`${MD_DOMAIN}/${key}`)},NULL,${q(CHANGELOG)},0,'stable',0)
ON DUPLICATE KEY UPDATE filename=VALUES(filename),size=VALUES(size),oss_key=VALUES(oss_key),url=VALUES(url),changelog=VALUES(changelog);`
  );
}
push('');

await fs.writeFile(path.join(SERVER_ROOT, 'sql', '002_seed.sql'), out.join('\n'), 'utf8');
console.log(`[gen] 002_seed.sql written: ${out.length} lines, ${PLUGINS.length} plugins, ${MODELS.length} models, ${PLATFORMS.length} releases`);

/* ------------------------------ 003 defaults ----------------------------- */
const d = [];
const dp = (s) => d.push(s);
dp('-- =====================================================================');
dp('-- NeoM defaults: docs / sensitive words / notifications / extra settings');
dp('-- =====================================================================');
dp('SET NAMES utf8mb4;');
dp('');

const TERMS = `# NeoM 服务条款

欢迎使用 NeoM（以下简称"本服务"）。注册或使用本服务即表示你已阅读并同意本条款。

## 1. 账号
- 你需对账号下的全部行为负责，请妥善保管密码。
- 禁止将账号出售、出借或共享给他人用于违法用途。
- 我们有权对违规账号采取限制功能、封禁等措施。

## 2. 内容
- 你对自己创建、上传、发布的内容拥有著作权，并对其合法性负责。
- 禁止发布违法、侵权、色情、暴力、诈骗、赌博等内容。
- 我们提供内容审核机制，违规内容将被删除，严重者移交司法机关。

## 3. 积分与付费
- 积分用于抵扣 AI 调用等资源消耗，充值后不可退款，除非法律另有规定。
- 积分价格与模型计费标准以站内公示为准，我们保留调整权并提前公告。

## 4. 服务变更与中断
- 本服务按"现状"提供，我们会尽力保障可用性，但不对因不可抗力、网络故障导致的中断承担责任。
- 我们可能随时升级或调整功能，重大变更将提前公告。

## 5. 联系方式
如有疑问请联系 support@zhengl.vip。`;

const PRIVACY = `# NeoM 隐私政策

我们重视你的隐私，本政策说明我们收集哪些信息以及如何使用。

## 1. 收集的信息
- 账号信息：用户名、加密后的密码、可选邮箱/手机号、昵称与头像。
- 使用信息：登录日志（IP、设备、时间）、AI 调用记录（模型、token 数、耗时）与积分流水。
- 内容信息：你创建的文档存储在对象存储（阿里云 OSS）中，服务端仅保存索引元数据。

## 2. 信息用途
- 提供登录鉴权、跨端同步、计费结算与故障排查。
- 安全风控：识别异常登录、滥用与攻击行为。
- 我们不会将你的文档内容用于模型训练，也不会出售你的个人信息。

## 3. 存储与安全
- 密码使用 bcrypt（cost 10）单向哈希存储，任何人（含管理员）都无法还原明文。
- 第三方密钥（OSS AK/SK、AI API Key）使用 AES-256-GCM 加密存储。
- 文件通过签名 URL 访问，默认不公开。

## 4. 你的权利
- 你可以随时导出或删除自己的文档与账号数据。
- 账号注销后，我们将在 30 天内清除你的个人信息与文件（法律要求保留的除外）。

## 5. 联系我们
隐私相关问题请联系 support@zhengl.vip。`;

const PLUGIN_DEV = `# NeoM 插件开发指南

插件是一个 zip 包，内含 manifest.json 与入口 JS，通过插件 API 扩展 NeoM 的界面与能力。

## 1. 目录结构
\`\`\`
my-plugin.zip
├── manifest.json
├── index.js
└── assets/icon.svg
\`\`\`

## 2. manifest.json
\`\`\`json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "示例插件",
  "author": "you",
  "category": "productivity",
  "icon": "sparkles",
  "entry": "index.js",
  "permissions": ["files:read", "files:write"],
  "defaultEnabled": false,
  "contributes": {
    "ribbon": true,
    "commands": [{ "id": "plugin.my-plugin.hello", "name": "打个招呼" }]
  }
}
\`\`\`

## 3. 入口 JS
\`\`\`js
export default {
  onload(app) {
    app.commands.register('plugin.my-plugin.hello', () => app.toast('你好，NeoM！'))
  },
  onunload(app) {
    app.commands.unregister('plugin.my-plugin.hello')
  }
}
\`\`\`

## 4. 可用权限
| 权限 | 说明 |
|---|---|
| files:read | 读取当前仓库文件 |
| files:write | 写入当前仓库文件 |
| ai | 调用 AI 模型接口 |
| share | 创建分享与发布页 |
| network | 发起外部网络请求（需审核） |

## 5. 上传与审核
在「插件 → 上传插件」选择 zip（< 5MB），系统会校验 manifest 必填字段并解压到服务端。上传后进入待审核状态，管理员通过后即可安装。

## 6. 命令 ID 规范
插件命令必须是 \`plugin.<pluginId>.<action>\` 三段式，例如 \`plugin.canvas.open\`。`;

dp('-- 1. site documents');
for (const [k, title, content] of [['terms', '服务条款', TERMS], ['privacy', '隐私政策', PRIVACY], ['plugin-dev', '插件开发指南', PLUGIN_DEV]]) {
  dp(`INSERT INTO site_docs (k,title,content) VALUES (${q(k)},${q(title)},${q(content)})
ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content);`);
}
dp('');

dp('-- 2. sensitive words (share comment filter)');
const WORDS = ['法轮功', '六四', '赌博', '博彩', '色情', '裸聊', '毒品', '冰毒', '枪支', '炸药', '代开发票', '办证', '洗钱', '诈骗', '杀猪盘', '翻墙软件', '政治敏感', '习近平', 'fuck', 'porn'];
for (const w of WORDS) {
  dp(`INSERT INTO sensitive_words (word,action) VALUES (${q(w)},'block') ON DUPLICATE KEY UPDATE action='block';`);
}
dp('');

dp('-- 3. welcome notification (broadcast)');
dp(
  `INSERT INTO notifications (user_id,kind,title,content)
SELECT NULL,'system','欢迎使用 NeoM','NeoM 1.0.0 已上线：注册赠送 100 积分，AI 助手与全部内置插件可用。遇到问题请联系 support@zhengl.vip。'
WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE kind='system' AND title='欢迎使用 NeoM');`
);
dp('');

dp('-- 4. misc defaults');
const more = [
  ['share_title_tpl', '{{name}} · NeoM 分享'],
  ['publish_title_tpl', '{{name}} · NeoM'],
  ['max_versions_per_file', '200'],
  ['version_dedupe_minutes', '10'],
  ['recycle_keep_days', '30'],
  ['recycle_max_items', '500'],
  ['search_max_hits', '200'],
  ['ai_default_scene_chat', 'mimo-v2.6-flash'],
  ['ai_default_scene_naming', 'mimo-v2.6-flash'],
  ['ai_default_scene_asr', 'mimo-v2.5-asr'],
  ['ai_default_scene_tts', 'mimo-v2.5-tts']
];
for (const [k, v] of more) {
  dp(`INSERT INTO sys_settings (k,v) VALUES (${q(k)},${q(v)}) ON DUPLICATE KEY UPDATE v=IF(v IS NULL OR v='',VALUES(v),v);`);
}
dp('');

await fs.writeFile(path.join(SERVER_ROOT, 'sql', '003_defaults.sql'), d.join('\n'), 'utf8');
console.log(`[gen] 003_defaults.sql written: ${d.length} lines`);
