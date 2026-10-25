/**
 * `/plugins/dev` — NeoM plugin development guide.
 * Documents the real runtime contract in `web/src/plugins/*`:
 * manifest fields, the ESM factory entry, PluginContext, permissions,
 * contribution points, local debug loading, packaging and compatibility.
 */
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { DocsDialog, SiteFooter, SiteHeader } from '@/features/marketing/PortalChrome'
import { DEFAULT_SITE_CONFIG, normalizeSiteConfig } from '@/features/marketing/portalData'
import { useRemote } from '@/features/marketing/portalKit'
import { CodeBlock } from './CodeBlock'
import '@/styles/portal-base.css'
import '@/styles/portal-store.css'

const NAV = [
  { id: 'quickstart', label: '快速开始', icon: 'play' },
  { id: 'structure', label: '目录结构', icon: 'folder', sub: true },
  { id: 'manifest', label: 'manifest.json', icon: 'file-text' },
  { id: 'lifecycle', label: '入口与生命周期', icon: 'refresh' },
  { id: 'commands', label: '命令注册', icon: 'command' },
  { id: 'ui', label: '功能区 / 面板 / 状态栏', icon: 'layout-both' },
  { id: 'events', label: '事件总线', icon: 'wifi' },
  { id: 'storage', label: '存储 API', icon: 'database' },
  { id: 'permissions', label: '权限模型', icon: 'shield' },
  { id: 'debug', label: '调试与本地加载', icon: 'cpu' },
  { id: 'package', label: '打包与发布', icon: 'upload' },
  { id: 'compat', label: '版本兼容', icon: 'layers' },
  { id: 'example', label: '完整示例', icon: 'code' },
  { id: 'api', label: 'API 速查', icon: 'list' }
]

const Section: React.FC<{
  id: string
  n: number
  title: string
  icon: string
  children: React.ReactNode
}> = ({ id, n, title, icon, children }) => (
  <section className="guide-sec" id={id}>
    <header className="guide-sec-head">
      <span className="num">{n}</span>
      <Icon name={icon} size={16} />
      <h2>{title}</h2>
    </header>
    <div className="guide-sec-body">{children}</div>
  </section>
)

const PluginDevGuide: React.FC = () => {
  const [policy, setPolicy] = useState<'terms' | 'privacy' | null>(null)
  const config = useRemote<any>('/api/site/config', DEFAULT_SITE_CONFIG, normalizeSiteConfig)

  return (
    <div className="portal">
      <SiteHeader />

      <div className="p-page">
        <div className="p-page-head">
          <div>
            <div className="p-eyebrow">
              <Icon name="code" size={13} /> 开发者
            </div>
            <h1 className="p-title" style={{ fontSize: 26 }}>
              插件开发指南
            </h1>
            <p className="p-sub" style={{ fontSize: 13 }}>
              一个插件就是一个 zip 包：<code className="mono">manifest.json</code> 描述元数据与贡献点，
              <code className="mono">index.js</code> 导出一个工厂函数，接收宿主注入的 <code className="mono">PluginContext</code>。
              不需要构建工具，也不允许直接访问网络与文件系统——一切经由上下文。
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="p-btn" to="/plugins">
              <Icon name="grid" size={14} /> 插件商店
            </Link>
            <Link className="p-btn p-btn-soft" to="/account/plugins">
              <Icon name="upload" size={14} /> 上传我的插件
            </Link>
          </div>
        </div>

        <div className="guide-layout">
          {/* ------------------------------------------------------ nav */}
          <nav className="guide-nav">
            <div className="store-side-title">目录</div>
            {NAV.map((n) => (
              <a key={n.id} href={'#' + n.id} className={n.sub ? 'sub' : undefined}>
                {!n.sub && <Icon name={n.icon} size={13} />}
                {n.label}
              </a>
            ))}
          </nav>

          {/* ----------------------------------------------------- body */}
          <div className="guide-body">
            <div className="guide-note">
              <Icon name="info" size={15} />
              <span>
                本页与客户端当前运行时一致（宿主版本 <b>1.0.0</b>）。插件的全部能力来自
                <code className="mono"> PluginContext</code>，运行时只会授予 manifest 中声明过的权限。
              </span>
            </div>

            {/* ---------------------------------------------- quickstart */}
            <Section id="quickstart" n={1} title="快速开始" icon="play">
              <p>
                三步做出第一个插件：新建目录 → 写 manifest → 写入口文件 → 打包 zip 上传（或本地调试加载）。
              </p>
              <CodeBlock
                lang="bash"
                title="终端"
                code={`mkdir hello-neom && cd hello-neom
# 1) 写 manifest.json
# 2) 写 index.js
# 3) 打包（zip 根目录必须直接包含 manifest.json）
zip -r hello-neom.zip manifest.json index.js icon.svg`}
              />
              <div className="guide-note warn">
                <Icon name="alert" size={15} />
                <span>
                  zip 内<b>不要</b>多包一层目录。正确：<code className="mono">{'hello-neom.zip → manifest.json, index.js'}</code>；
                  错误：<code className="mono">{'hello-neom.zip → hello-neom/manifest.json'}</code>。
                </span>
              </div>
            </Section>

            {/* ----------------------------------------------- structure */}
            <Section id="structure" n={2} title="目录结构" icon="folder">
              <div className="guide-tree">{`hello-neom/
<span class="d">├─ manifest.json</span>     <span class="c"># 必需：元数据 + 贡献点 + 权限</span>
<span class="d">├─ index.js</span>          <span class="c"># 必需：ESM 入口，default 导出工厂函数</span>
<span class="d">├─ icon.svg</span>          <span class="c"># 可选：商店图标（也可用内置图标名）</span>
<span class="d">├─ style.css</span>         <span class="c"># 可选：样式（通过 &lt;link&gt; 或内联注入）</span>
<span class="d">├─ README.md</span>         <span class="c"># 可选：商店详情页说明</span>
<span class="d">└─ screenshots/</span>      <span class="c"># 可选：商店截图</span>
   <span class="f">└─ main.png</span>`}</div>
              <p style={{ marginTop: 14 }}>
                <b>内置插件</b>与第三方插件共用同一套 manifest 结构，只是内置插件以 TypeScript 写进客户端源码、
                走 <code className="mono">registerRuntime()</code> 注册；第三方插件是运行期动态 <code className="mono">import()</code>。
              </p>
            </Section>

            {/* ------------------------------------------------ manifest */}
            <Section id="manifest" n={3} title="manifest.json 字段" icon="file-text">
              <p>字段与 <code className="mono">lib/contracts.ts → PluginManifest</code> 完全一致，不允许额外字段。</p>
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 156 }}>字段</th>
                      <th style={{ width: 96 }}>类型</th>
                      <th style={{ width: 62 }}>必填</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['id', 'string', '是', '全局唯一，小写字母/数字/短横线，建议与目录同名。命令前缀会以它生成 plugin.<id>.*'],
                      ['name', 'string', '是', '展示名称，中文即可'],
                      ['version', 'string', '是', '语义化版本，如 1.2.0。升级必须递增'],
                      ['minAppVersion', 'string', '是', '最低宿主版本，低于该版本不会加载'],
                      ['description', 'string', '是', '一句话说明，商店列表与详情页使用'],
                      ['author', 'string', '是', '作者名或组织'],
                      ['category', 'enum', '是', 'core | visualization | productivity | media | data | ai | publish'],
                      ['icon', 'string', '是', 'Icon.tsx 内置图标名（如 puzzle / graph），或图标资源相对路径'],
                      ['builtin', 'boolean', '是', '第三方插件固定 false'],
                      ['entry', 'string', '是*', '入口 ESM 文件相对路径，默认 index.js'],
                      ['permissions', 'string[]', '是', '申请的权限，见第 8 节。未声明的能力会被运行时拒绝'],
                      ['defaultEnabled', 'boolean', '是', '首次安装后是否默认启用'],
                      ['contributes', 'object', '是', '贡献点：ribbon / leftPanel / rightPanel / statusItem / commands']
                    ].map(([f, t, r, d]) => (
                      <tr key={f as string}>
                        <td>
                          <code>{f}</code>
                        </td>
                        <td className="mono tiny">{t}</td>
                        <td className={r === '是' ? 'req' : 'dim'}>{r}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14 }}>
                <CodeBlock
                  lang="json"
                  title="manifest.json"
                  code={`{
  "id": "hello-neom",
  "name": "Hello NeoM",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "最小插件示例：注册命令 + 右侧面板",
  "author": "you",
  "category": "productivity",
  "icon": "puzzle",
  "builtin": false,
  "entry": "index.js",
  "permissions": ["files:read", "editor:write"],
  "defaultEnabled": false,
  "contributes": {
    "ribbon": true,
    "rightPanel": true,
    "commands": [
      { "id": "plugin.hello-neom.insert", "name": "插入问候语", "hotkey": "Mod+Shift+J" }
    ]
  }
}`}
                />
              </div>
            </Section>

            {/* ----------------------------------------------- lifecycle */}
            <Section id="lifecycle" n={4} title="入口与生命周期" icon="refresh">
              <p>
                运行时通过 <code className="mono">import(entry)</code> 加载你的模块，取 <code className="mono">default</code>
                （或 <code className="mono">plugin</code>）导出。它可以是工厂函数（推荐，支持异步初始化），也可以直接是对象。
              </p>
              <CodeBlock
                lang="javascript"
                title="index.js — 返回值结构"
                code={`export default async function createPlugin(ctx) {
  // ctx 是 PluginContext（见第 13 节），已按权限裁剪
  ctx.toast('Hello NeoM 已加载', 'ok')

  return {
    // ---- UI 贡献点（可选，返回 React 元素即可）----
    ribbonIcon: 'sparkles',                       // 功能区图标名
    renderPanel: ({ context }) => null,           // 左侧/侧栏面板
    renderRightPanel: ({ context }) => null,      // 右侧面板
    renderStatusItem: () => null,                 // 状态栏小部件

    // ---- 命令（可选）----
    commands: [],

    // ---- 整页视图（可选，命令 canvas/graph 这类用）----
    // fullScreen: (container) => { container.appendChild(el) },

    // ---- 生命周期 ----
    onActivate: (context) => { /* 插件被启用 */ },
    onDeactivate: () => { /* 插件被停用，清理定时器/监听 */ }
  }
}`}
              />
              <p>
                生命周期顺序：<b>加载</b>（import + 调用工厂）→ <b>注册</b>（写入运行时注册表）→ 若
                <code className="mono">defaultEnabled</code> 为 true 或用户已启用则 <b>激活</b>
                （注册命令 + 调用 <code className="mono">onActivate</code>）→ 用户停用时
                <code className="mono">onDeactivate</code> 并注销命令。
              </p>
              <div className="guide-note warn">
                <Icon name="alert" size={15} />
                <span>
                  <code className="mono">onDeactivate</code> 里必须清理你创建的一切：定时器、事件监听、
                  全局 DOM 节点。宿主不会替你回收，否则停用后仍在后台运行。
                </span>
              </div>
            </Section>

            {/* ------------------------------------------------ commands */}
            <Section id="commands" n={5} title="命令注册" icon="command">
              <p>
                命令会自动出现在命令面板（<span className="kbd">Ctrl/⌘ + P</span>）、功能区菜单与快捷键系统中。
                id 若不以下划线开头的 <code className="mono">plugin.</code> 起始，运行时会自动补成
                <code className="mono"> plugin.&lt;插件id&gt;.&lt;你的id&gt;</code>。
              </p>
              <CodeBlock
                lang="javascript"
                title="commands"
                code={`const commands = [
  {
    id: 'insert',                    // → plugin.hello-neom.insert
    title: '插入问候语',
    subtitle: '在当前光标处写入一句问候',   // 命令面板副标题
    category: 'Hello NeoM',              // 面板分组
    icon: 'sparkles',                    // 图标名
    shortcut: 'Mod+Shift+J',             // 可选，冲突时以 shell 快捷键为准
    keywords: 'hello hi greeting',       // 额外搜索关键词
    run: (ctx) => {
      ctx.insertText('你好，NeoM！\\n')   // 需要 editor:write 权限
      ctx.toast('已插入', 'ok')
    }
  }
]

return { commands }`}
              />
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>字段</th>
                      <th style={{ width: 86 }}>类型</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['id', 'string', '命令唯一 id；建议只用小写与短横线'],
                      ['title', 'string', '面板与菜单里的名称'],
                      ['run', 'function', '执行体，签名 (ctx) => void | Promise<void>'],
                      ['subtitle', 'string', '命令面板第二行说明'],
                      ['category', 'string', '分组标题，默认用插件 name'],
                      ['icon', 'string', 'Icon.tsx 内置图标名'],
                      ['shortcut', 'string', '形如 Mod+Shift+J；Mod = Ctrl(Win)/⌘(Mac)'],
                      ['keywords', 'string', '参与模糊搜索的额外关键词']
                    ].map(([f, t, d]) => (
                      <tr key={f}>
                        <td>
                          <code>{f}</code>
                        </td>
                        <td className="mono tiny">{t}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* ------------------------------------------------------ ui */}
            <Section id="ui" n={6} title="功能区 / 面板 / 状态栏挂载" icon="layout-both">
              <p>
                返回的 <code className="mono">renderPanel</code> / <code className="mono">renderRightPanel</code> /{' '}
                <code className="mono">renderStatusItem</code> 都是普通 React 组件函数，由宿主负责挂载位置。
                它们接收 <code className="mono">{'{ context }'}</code>。
              </p>
              <CodeBlock
                lang="jsx"
                title="index.js — 渲染函数"
                code={`import React from 'react'
const h = React.createElement

function HelloPanel({ context }) {
  const [n, setN] = React.useState(0)
  return h('div', { className: 'plugin-hello' },
    h('h4', null, 'Hello NeoM'),
    h('p', { className: 'dim small' }, '已点击 ' + n + ' 次'),
    h('button', {
      className: 'btn btn-sm',
      onClick: () => { setN(n + 1); context.insertText('👋 '.repeat(1)) }
    }, '插入问候')
  )
}

export default (ctx) => ({
  ribbonIcon: 'sparkles',
  renderPanel: (props) => h(HelloPanel, props),
  renderRightPanel: (props) => h(HelloPanel, props),
  renderStatusItem: () => h('span', { className: 'small dim' }, 'Hello')
})`}
              />
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 168 }}>贡献点</th>
                      <th>挂载位置</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['contributes.ribbon + ribbonIcon', '左侧/顶部功能区图标按钮，点击打开面板'],
                      ['contributes.leftPanel + renderPanel', '左侧栏面板（文件/大纲等并列）'],
                      ['contributes.rightPanel + renderRightPanel', '右侧属性面板（AI / 反链等并列）'],
                      ['contributes.statusItem + renderStatusItem', '底部状态栏小部件（字数统计那样）'],
                      ['contributes.commands', '命令面板 + 可绑定快捷键'],
                      ['fullScreen', '整页视图（画布 / 图谱类），通过 ctx.openFullScreen 或窗口宿主挂载']
                    ].map(([a, b]) => (
                      <tr key={a}>
                        <td>
                          <code>{a}</code>
                        </td>
                        <td>{b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="guide-note">
                <Icon name="info" size={15} />
                <span>
                  面板样式请复用主题类（<code className="mono">.btn .input .card .panel .badge .chip</code>）
                  与 CSS 变量（<code className="mono">var(--text) var(--accent) var(--surface)</code>），
                  这样深色模式会自动适配。
                </span>
              </div>
            </Section>

            {/* -------------------------------------------------- events */}
            <Section id="events" n={7} title="事件总线" icon="wifi">
              <p>
                客户端在 <code className="mono">window</code> 上派发标准 <code className="mono">CustomEvent</code>，
                事件名常量见 <code className="mono">lib/contracts.ts → EVT</code>。
              </p>
              <CodeBlock
                lang="javascript"
                title="订阅与派发"
                code={`import { EVT } from '@/lib/contracts'

// 文档保存后做点事（如：记录统计、同步到外部服务）
const onSaved = (e) => {
  const { path, version } = e.detail || {}
  ctx.toast(\`已保存 \${path} (v\${version})\`, 'info')
}
window.addEventListener(EVT.docSaved, onSaved)

// 停用时务必移除，避免泄漏
ctx.settings.set('__off', true)
// onDeactivate 中：window.removeEventListener(EVT.docSaved, onSaved)

// 派发自定义事件（插件之间解耦通信，建议加自己的前缀）
window.dispatchEvent(new CustomEvent('plugin.hello-neom.ping', { detail: { at: Date.now() } }))`}
              />
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 190 }}>常量</th>
                      <th style={{ width: 230 }}>事件名</th>
                      <th>触发时机</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['EVT.docSaved', 'neom:doc-saved', '文档保存成功，detail 含 path / version / etag'],
                      ['EVT.docOpened', 'neom:doc-opened', '打开文档'],
                      ['EVT.docClosed', 'neom:doc-closed', '关闭标签页'],
                      ['EVT.fileTreeChanged', 'neom:file-tree-changed', '文件增删改后'],
                      ['EVT.aiInsert', 'neom:ai-insert', 'AI 结果要求插入正文'],
                      ['EVT.aiReplaceSelection', 'neom:ai-replace', 'AI 结果替换选中内容'],
                      ['EVT.commandRun', 'neom:command', '命令执行'],
                      ['EVT.themeChanged', 'neom:theme', '深浅色切换'],
                      ['EVT.settingsChanged', 'neom:settings', '设置变更'],
                      ['EVT.toast', 'neom:toast', '需要弹出提示'],
                      ['EVT.conflict', 'neom:conflict', '检测到同步冲突']
                    ].map(([c, n, d]) => (
                      <tr key={c}>
                        <td>
                          <code>{c}</code>
                        </td>
                        <td className="mono tiny">{n}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* ------------------------------------------------- storage */}
            <Section id="storage" n={8} title="存储 API" icon="database">
              <p>
                插件有两条数据通道：<b>自身设置</b>（键值，随插件隔离，存 localStorage）与
                <b>仓库文件</b>（读写用户 Markdown 仓库，受 <code className="mono">files:write</code> 权限约束）。
              </p>
              <CodeBlock
                lang="javascript"
                title="settings + vault"
                code={`// ---------- 1. 插件设置（自动落在 neom.plugin.<id>）----------
const theme = ctx.settings.get('theme', 'auto')      // 读，带默认值
ctx.settings.set('theme', 'dark')                    // 写，立即持久化
const all = ctx.settings.all()                       // 拿到全部键值

// ---------- 2. 读取仓库 ----------
const files = await ctx.vault.list()                 // FileNode[]（需 files:read）
const doc = await ctx.vault.read('notes/todo.md')    // { path, name, content, etag, ... }

// ---------- 3. 写入仓库（需 files:write）----------
await ctx.vault.write('notes/todo.md', '# 新内容')     // etag 冲突请先 read
await ctx.vault.mkdir?.('notes', 'archive')          // 可选能力，需判断是否存在
const path = await ctx.createFile('草稿', '正文', 'notes') // 时间戳命名，返回路径

// ---------- 4. 后端 API（需 net:fetch；或 ai:chat 只能调 /api/ai/*）----------
const me = await ctx.api.get('/api/auth/me')
const out = await ctx.api.post('/api/ai/chat', { model: 'mimo-v2.6-flash', messages: [] })`}
              />
              <div className="guide-note warn">
                <Icon name="alert" size={15} />
                <span>
                  不要用 <code className="mono">fetch</code> / <code className="mono">localStorage</code> 直接访问——
                  商店插件运行在受限上下文里，绕过 <code className="mono">ctx.api</code> 将无法携带登录凭证，
                  也会被审核拒绝。
                </span>
              </div>
            </Section>

            {/* --------------------------------------------- permissions */}
            <Section id="permissions" n={9} title="权限模型" icon="shield">
              <p>
                运行时按 manifest 的 <code className="mono">permissions</code> 对 <code className="mono">PluginContext</code>{' '}
                做能力裁剪：未声明的能力调用会立即抛错并被捕获，插件不会因此崩溃整个编辑器。
              </p>
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>权限</th>
                      <th style={{ width: 210 }}>解锁能力</th>
                      <th>风险说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['files:read', 'ctx.vault.list / read', '可读取你的全部笔记内容'],
                      ['files:write', 'ctx.vault.write / mkdir / remove / rename、ctx.createFile', '可修改、删除你的文件'],
                      ['editor:write', 'ctx.insertText / replaceSelection', '可改写当前编辑中的正文'],
                      ['net:fetch', 'ctx.api.* 任意 /api 请求', '可代表你调用任意后端接口'],
                      ['ai:chat', 'ctx.api.* 仅限 /api/ai/*', '可调用 AI（官方通道会扣积分）'],
                      ['ui:modal', 'ctx.openModal / closeModal', '可弹出界面'],
                      ['settings', 'ctx.settings.*', '可读写插件自身设置']
                    ].map(([p, a, r]) => (
                      <tr key={p}>
                        <td>
                          <code>{p}</code>
                        </td>
                        <td className="mono tiny">{a}</td>
                        <td>{r}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ marginTop: 12 }}>
                原则：<b>最小必要</b>。只是展示信息的插件不应该申请 <code className="mono">files:write</code>；
                审核会核对代码实际行为与声明是否一致，超出声明范围的能力调用会被直接拒绝。
              </p>
            </Section>

            {/* --------------------------------------------------- debug */}
            <Section id="debug" n={10} title="调试与本地加载" icon="cpu">
              <p>
                开发阶段不必反复打包上传。两种方式：
              </p>
              <p>
                <b>① 本地开发目录（最快）</b>：把插件目录放到 <code className="mono">web/public/plugins-dev/hello-neom/</code>，
                Vite 会直接以静态资源提供服务，然后在浏览器控制台调用运行时的加载函数。
              </p>
              <CodeBlock
                lang="javascript"
                title="浏览器控制台（dev 模式）"
                code={`// web/src/plugins/index.ts 已导出 loadThirdPartyPlugin
const { loadThirdPartyPlugin } = await import('/src/plugins/index.ts')

// manifest 可以内联写，也可以 fetch 本地文件
const manifest = await (await fetch('/plugins-dev/hello-neom/manifest.json')).json()

const rt = await loadThirdPartyPlugin({
  id: manifest.id,
  entry: '/plugins-dev/hello-neom/index.js',   // 必须是可 import 的 ESM 地址
  manifest
})

// 启用它 → 命令立即出现在命令面板
const { setEnabled } = await import('/src/plugins/index.ts')
await setEnabled(manifest.id, true)

// 改完代码：重新执行上面两步即可热更新（旧的注册会被覆盖）`}
              />
              <p>
                <b>② 上传 zip 调试</b>：执行 <code className="mono">zip -r hello-neom.zip .</code> 后，在
                「个人中心 → 我的插件」或「插件商店 → 自己上传安装」中上传，效果与线上安装完全一致（走
                <code className="mono"> POST /api/plugins/upload</code>）。适合验证权限裁剪与打包结构。
              </p>
              <CodeBlock
                lang="javascript"
                title="常见排错"
                code={`// 1) 权限报错：插件「X」未声明 files:write 权限，操作已阻止
//    → 在 manifest.permissions 里补上，重新加载

// 2) 命令没出现：检查 id 前缀与 help 面板
//    → 命令必须通过返回值 commands 提供；停用状态下不注册

// 3) 面板空白：renderPanel 返回了 undefined
//    → 返回 null 是允许的（显示空面板），undefined 会被当成无贡献点

// 4) 深色模式样式错乱
//    → 不要写死 #fff/#000，改用 var(--text) / var(--surface) / var(--border)

// 5) 每次保存都触发两次
//    → onActivate 可能被重复调用，监听前先 removeEventListener 或加标记`}
              />
            </Section>

            {/* ------------------------------------------------- package */}
            <Section id="package" n={11} title="打包与发布" icon="upload">
              <p>
                打包规则只有三条：<b>zip 格式</b>、<b>根目录含 manifest.json</b>、<b>单包 ≤ 8 MB</b>。
                入口与 manifest 里引用的所有资源都必须打进包里（不允许运行时从外链加载脚本）。
              </p>
              <CodeBlock
                lang="bash"
                title="打包"
                code={`# 在插件目录内打包（不要在父目录打包）
zip -r hello-neom.zip manifest.json index.js icon.svg README.md

# 校验结构：应直接看到 manifest.json
unzip -l hello-neom.zip

# 本地自检 manifest 是否为合法 JSON
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('ok')"`}
              />
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>步骤</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['① 自动安装', 'POST /api/plugins/upload（multipart file）→ 立即装到当前账号，状态 source=uploaded'],
                      ['② 自测', '在「我的插件」启用 → 编辑器功能区/命令面板验证全部贡献点'],
                      ['③ 提交商店', '联系管理员或后台「插件」模块提交审核，填写描述、分类、截图与更新日志'],
                      ['④ 审核', '管理员核对权限声明与代码行为，通过后 status=published 可在商店搜到'],
                      ['⑤ 升级', '递增 version 并重新上传；用户端会显示“可更新”，调用 POST /api/plugins/update']
                    ].map(([a, b]) => (
                      <tr key={a}>
                        <td>
                          <b>{a}</b>
                        </td>
                        <td>{b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CodeBlock
                lang="javascript"
                title="上传（前端等价写法）"
                code={`const form = new FormData()
form.append('file', zipFile)            // File 对象，.zip
const res = await api.upload('/api/plugins/upload', form)
// → { id, manifest }  安装成功即为 source=uploaded、enabled 取决于 defaultEnabled

// 升级到新版本
await api.post('/api/plugins/update', { id: 'hello-neom' })`}
              />
            </Section>

            {/* -------------------------------------------------- compat */}
            <Section id="compat" n={12} title="版本兼容要求" icon="layers">
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 176 }}>项目</th>
                      <th style={{ width: 132 }}>当前要求</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['宿主版本', '1.0.0', 'manifest.minAppVersion 高于客户端版本时插件不会加载'],
                      ['模块格式', 'ESM', '必须使用 export default；不支持 CommonJS require'],
                      ['React', '18（宿主提供）', '第三方插件不要自带 React，使用宿主同一实例或 React.createElement 兼容写法'],
                      ['浏览器 / 内核', 'Chrome 100+ / Electron 22+', '可用可选链、顶层 await、structuredClone'],
                      ['入口资源', '包内相对路径', '禁止外链脚本与远程模块；图片可内联 data URI'],
                      ['manifest 字段', '与 contracts 一致', '多余字段在严格校验下会被拒绝'],
                      ['命令前缀', 'plugin.<id>.', '不符合前缀的命令 id 会被自动改写'],
                      ['无构建直发', '支持', '纯 ESM 直接可用；如需 TS 请自行构建后提交产物'],
                      ['样式隔离', '无 Shadow DOM', '样式请加插件前缀类名（如 .plugin-hello-*），避免污染全局']
                    ].map(([a, b, c]) => (
                      <tr key={a}>
                        <td>
                          <b>{a}</b>
                        </td>
                        <td className="mono tiny">{b}</td>
                        <td>{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ marginTop: 12 }}>
                向后兼容承诺：<code className="mono">PluginContext</code> 现有字段不会移除，只会新增可选能力；
                破坏性变更会提升宿主主版本并要求插件更新 <code className="mono">minAppVersion</code>。
              </p>
            </Section>

            {/* ------------------------------------------------- example */}
            <Section id="example" n={13} title="完整示例：一个可用的插件" icon="code">
              <p>
                一个“每日速记”插件：功能区按钮 + 命令 + 右侧面板，把内容追加到当天的日期笔记（自动创建）。
              </p>
              <CodeBlock
                lang="json"
                title="manifest.json"
                code={`{
  "id": "daily-scratch",
  "name": "每日速记",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "一键把想法追加到今天的日期笔记，右侧面板快速录入。",
  "author": "you",
  "category": "productivity",
  "icon": "edit",
  "builtin": false,
  "entry": "index.js",
  "permissions": ["files:read", "files:write", "editor:write"],
  "defaultEnabled": true,
  "contributes": {
    "ribbon": true,
    "rightPanel": true,
    "commands": [{ "id": "plugin.daily-scratch.append", "name": "追加到今日笔记", "hotkey": "Mod+Shift+D" }]
  }
}`}
              />
              <CodeBlock
                lang="javascript"
                title="index.js"
                code={`import React from 'react'
const h = React.createElement

const pad = (n) => (n < 10 ? '0' + n : '' + n)
const todayPath = () => {
  const d = new Date()
  return \`每日笔记/\${d.getFullYear()}-\${pad(d.getMonth() + 1)}-\${pad(d.getDate())}.md\`
}

/** 追加一行，文件不存在则创建 */
async function appendToday(ctx, text) {
  const path = todayPath()
  let content = ''
  try {
    const doc = await ctx.vault.read(path)   // files:read
    content = doc?.content || ''
  } catch {
    content = \`# \${path.split('/').pop().replace('.md', '')}\\n\\n\`
  }
  const stamp = new Date().toTimeString().slice(0, 5)
  const next = content.replace(/\\s*$/, '\\n') + \`- \${stamp} \${text}\\n\`
  await ctx.vault.write(path, next)          // files:write
  ctx.refreshTree()                          // 让文件树立即刷新
  return path
}

function ScratchPanel({ context }) {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await appendToday(context, text.trim())
      context.toast('已记入今日笔记', 'ok')
      setText('')
    } catch (e) {
      context.toast(e?.message || '写入失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return h('div', { style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
    h('div', { className: 'small', style: { fontWeight: 600 } }, '每日速记'),
    h('div', { className: 'tiny dim' }, todayPath()),
    h('textarea', {
      className: 'textarea',
      rows: 4,
      placeholder: '此刻的想法…（Ctrl/⌘ + Enter 提交）',
      value: text,
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit() }
    }),
    h('button', {
      className: 'btn btn-sm btn-primary',
      disabled: busy || !text.trim(),
      onClick: submit
    }, busy ? '写入中…' : '追加到今日笔记')
  )
}

export default (ctx) => {
  const appendCommand = {
    id: 'append',                    // → plugin.daily-scratch.append
    title: '追加到今日笔记',
    subtitle: '把当前选中/剪贴板文本记入今天',
    icon: 'edit',
    shortcut: 'Mod+Shift+D',
    run: async (c) => {
      const sel = c.getActiveContent().slice(0, 0) || ''
      const fallback = sel || '（空白记录）'
      const path = await appendToday(c, fallback)
      c.toast(\`已追加到 \${path.split('/').pop()}\`, 'ok')
    }
  }

  return {
    ribbonIcon: 'edit',
    commands: [appendCommand],
    renderRightPanel: (props) => h(ScratchPanel, props),
    onActivate: (c) => c.settings.set('activatedAt', Date.now()),
    onDeactivate: () => { /* 无监听，无需清理 */ }
  }
}`}
              />
              <CodeBlock
                lang="jsx"
                title="如需 TypeScript（本地内置插件写法，可参考 plugins/items/*）"
                code={`import type { PanelProps } from '@/plugins/types'

export const ScratchPanel = ({ context }: PanelProps) => {
  // 与上面相同的逻辑，只是类型更严格
  return null
}

// 内置插件走 registerRuntime()：
// import { registerRuntime } from '@/plugins/runtime'
// registerRuntime({ id, manifest, renderRightPanel, commands, onActivate })`}
              />
            </Section>

            {/* ----------------------------------------------------- api */}
            <Section id="api" n={14} title="PluginContext API 速查" icon="list">
              <div className="guide-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 210 }}>成员</th>
                      <th style={{ width: 180 }}>签名</th>
                      <th>说明 / 所需权限</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['id', 'string', '当前插件 id（只读），可用于设置命名空间'],
                      ['openFile(path)', '(string) => void', '在编辑器中打开文件'],
                      ['createFile(name?, content?, dir?)', '(...) => Promise<string>', '创建文件并返回路径 · files:write'],
                      ['getActiveContent()', '() => string', '当前文档正文'],
                      ['insertText(text)', '(string) => void', '在光标处插入 · editor:write'],
                      ['replaceSelection(text)', '(string) => void', '替换选中内容 · editor:write'],
                      ['toast(msg, kind?)', '(string, info|ok|warn|error) => void', '弹出提示'],
                      ['vault.list()', '() => Promise<FileNode[]>', '文件清单 · files:read'],
                      ['vault.read(path)', '(string) => Promise<DocContent>', '读取内容 · files:read'],
                      ['vault.write(path, content)', '(string, string) => Promise', '写入内容 · files:write'],
                      ['vault.remove / rename / mkdir', '可选', '可能未提供，调用前判断存在性 · files:write'],
                      ['api.get / post / put / del', '(url, body?) => Promise', '受控后端请求 · net:fetch（ai:chat 仅 /api/ai/*）'],
                      ['settings.get(key, fallback)', '<T>(string, T) => T', '读取插件设置'],
                      ['settings.set(key, value)', '(string, unknown) => void', '写入插件设置'],
                      ['settings.all()', '() => Record<string, unknown>', '读取全部设置'],
                      ['getActivePath()', '() => string | null', '当前文档路径'],
                      ['openModal(id, props?) / closeModal()', '(...) => void', '打开/关闭宿主弹窗 · ui:modal'],
                      ['openFullScreen(node) / closeFullScreen()', '(ReactNode) => void', '整页视图宿主'],
                      ['refreshTree()', '() => void', '让文件树重新拉取']
                    ].map(([m, s, d]) => (
                      <tr key={m}>
                        <td>
                          <code>{m}</code>
                        </td>
                        <td className="mono tiny">{s}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="guide-note" style={{ marginTop: 14, marginBottom: 0 }}>
                <Icon name="info" size={15} />
                <span>
                  本页依据客户端 <code className="mono">web/src/plugins/&#123;types,runtime,index&#125;.ts</code>{' '}
                  的实际约定编写；若后续契约调整，以 <code className="mono">docs/PLUGIN-DEV.md</code> 与
                  <code className="mono"> lib/contracts.ts</code> 为准。
                </span>
              </div>
            </Section>

            <div className="p-card" style={{ padding: 22, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span className="p-tile grad lg">
                <Icon name="puzzle" size={20} />
              </span>
              <div className="grow" style={{ minWidth: 200 }}>
                <div className="small" style={{ fontWeight: 680 }}>
                  准备好了？上传你的第一个插件
                </div>
                <div className="tiny muted" style={{ marginTop: 3 }}>
                  打包 zip 后在「我的插件」中上传，即时可用；自荐上架请联系管理员。
                </div>
              </div>
              <Link className="p-btn p-btn-primary p-btn-sm" to="/account/plugins">
                <Icon name="upload" size={13} /> 上传插件包
              </Link>
              <Link className="p-btn p-btn-sm" to="/plugins">
                浏览商店
              </Link>
            </div>
          </div>
        </div>
      </div>

      <SiteFooter config={config.data} onPolicy={(w) => setPolicy(w)} />
      {policy && <DocsDialog which={policy} onClose={() => setPolicy(null)} />}
    </div>
  )
}

export default PluginDevGuide
