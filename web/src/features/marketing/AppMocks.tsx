/**
 * Pure CSS/SVG product mocks used by the landing page — no external images,
 * no screenshots to keep, instant first paint.
 */
import React from 'react'
import { Icon } from '@/components/Icon'

/* ------------------------------------------------------ editor mock */
export const EditorMock: React.FC = () => (
  <div className="mock mock-editor" role="img" aria-label="NeoM 编辑器界面示意">
    <div className="mk-bar">
      <span className="mk-dot r" />
      <span className="mk-dot y" />
      <span className="mk-dot g" />
      <div className="mk-tabs">
        <span className="mk-tab active">
          <Icon name="file-text" size={10} /> 知识库总览.md
        </span>
        <span className="mk-tab">
          <Icon name="file-text" size={10} /> 灵感收集.md
        </span>
        <span className="mk-tab">
          <Icon name="graph" size={10} /> 关系图谱
        </span>
      </div>
    </div>

    <div className="mk-body">
      <div className="mk-side">
        <div className="mk-side-title">云端仓库</div>
        <div className="mk-file">
          <Icon name="chevron-down" size={10} />
          <Icon name="folder" size={11} /> 01 项目
        </div>
        <div className="mk-file indent active">
          <Icon name="file-text" size={11} /> 知识库总览.md
        </div>
        <div className="mk-file indent">
          <Icon name="file-text" size={11} /> 产品规划.md
        </div>
        <div className="mk-file">
          <Icon name="chevron-right" size={10} />
          <Icon name="folder" size={11} /> 02 每日笔记
        </div>
        <div className="mk-file">
          <Icon name="chevron-right" size={10} />
          <Icon name="folder" size={11} /> 03 归档
        </div>
        <div className="mk-file">
          <Icon name="database" size={11} /> 文献数据库
        </div>
        <div className="mk-file">
          <Icon name="canvas" size={11} /> 白板.canvas
        </div>
      </div>

      <div className="mk-main">
        <div className="mk-h1">知识库总览</div>
        <div className="mk-row">
          <span className="mk-chip">#产品</span>
          <span className="mk-chip">#架构</span>
          <span className="mk-chip neutral">更新于 2 分钟前</span>
        </div>
        <div className="mk-p">
          这里是所有内容的入口。用双向链接把零散笔记连成网，再用关系图谱看清结构；任何一次修改都会保留历史版本。
        </div>
        <div className="mk-quote">
          “写作不是输出结论，而是把思考过程摊开。” —— 与 [[卡片笔记法]] 互链
        </div>
        <div className="mk-code">{`const notes = await neom.files.list()
// 42 篇笔记 · 3 台设备已同步 · 版本 v18`}</div>
        <div className="mk-row">
          <span className="mk-chip neutral">⌘ + ⇧ + I 唤起 AI</span>
          <span className="mk-chip neutral">/ 插入块</span>
        </div>
      </div>
    </div>

    <div className="mk-status">
      <span className="dot" />
      已保存 · 1,284 字 · 云端已同步
      <span style={{ marginLeft: 'auto' }}>所见即所得</span>
    </div>
  </div>
)

/* ---------------------------------------------------------- ai mock */
export const AiMock: React.FC = () => (
  <div className="mock mock-ai" role="img" aria-label="AI 助手面板示意">
    <div className="mk-ai-head">
      <span className="mk-dot g" style={{ background: 'var(--accent)' }} />
      AI 助手
      <span className="mk-ai-model">mimo-v2.6-flash ▾</span>
    </div>
    <div className="mk-ai-body">
      <div className="ai-msg me">
        <span className="av">我</span>
        <div className="ai-bubble">把这段会议记录整理成待办清单，并标注负责人。</div>
      </div>
      <div className="ai-msg">
        <span className="av">AI</span>
        <div className="ai-bubble">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>待办 · 3 项</div>
          <div>1. 完成同步冲突合并 — @小林 · 周五</div>
          <div>2. 插件商店上架审核 — @Aria · 周三</div>
          <div>3. 补齐移动端手势说明 — @Leo · 下周一</div>
        </div>
      </div>
      <div className="ai-msg me">
        <span className="av">我</span>
        <div className="ai-bubble">让语气更正式一些，输出为 Markdown 表格。</div>
      </div>
      <div className="mk-ai-input">
        继续输入，或选中文本交给 AI…
        <span className="send">
          <Icon name="send" size={11} />
        </span>
      </div>
    </div>
  </div>
)

/* ------------------------------------------------------- graph mock */
const GRAPH_NODES = [
  { x: 62, y: 126, label: '项目' },
  { x: 152, y: 62, label: '知识库' },
  { x: 254, y: 106, label: 'AI' },
  { x: 344, y: 52, label: '插件' },
  { x: 352, y: 168, label: '发布' },
  { x: 152, y: 196, label: '图谱' },
  { x: 250, y: 206, label: '数据库' }
]
const GRAPH_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [2, 4],
  [1, 5],
  [2, 6],
  [5, 6],
  [0, 2]
]

export const GraphMock: React.FC = () => (
  <div className="mock mock-pad" role="img" aria-label="关系图谱示意">
    <div className="mock-cap">
      <Icon name="graph" size={13} /> 全库关系图谱
      <span style={{ marginLeft: 'auto' }}>42 节点 · 76 连线</span>
    </div>
    <svg className="graph-svg" viewBox="0 0 420 250" role="presentation">
      {GRAPH_EDGES.map(([a, b], i) => (
        <line
          key={i}
          x1={GRAPH_NODES[a].x}
          y1={GRAPH_NODES[a].y}
          x2={GRAPH_NODES[b].x}
          y2={GRAPH_NODES[b].y}
          style={{ stroke: 'var(--border-strong)' }}
          strokeWidth="1"
        />
      ))}
      {GRAPH_NODES.map((n, i) => (
        <g key={n.label}>
          <circle
            cx={n.x}
            cy={n.y}
            r={i === 2 ? 9 : i === 1 ? 7.5 : 6}
            style={{ fill: i === 2 ? 'var(--accent)' : 'var(--accent-soft-2)' }}
          />
          <circle cx={n.x} cy={n.y} r={i === 2 ? 9 : 6} style={{ stroke: 'var(--accent)' }} strokeWidth="1" fill="none" />
          <text
            x={n.x}
            y={n.y + (i === 2 ? 22 : 19)}
            textAnchor="middle"
            style={{ fill: 'var(--text-2)', fontSize: 9.5, fontFamily: 'var(--font-ui)' }}
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  </div>
)

/* ---------------------------------------------------- database mock */
const DB_ROWS = [
  { name: '知识库总览', type: '笔记', status: '已发布', updated: '2 分钟前' },
  { name: '产品规划 Q4', type: '笔记', status: '草稿', updated: '昨天' },
  { name: '文献数据库', type: '文件夹', status: '协作中', updated: '3 天前' },
  { name: '关系图谱', type: '画布', status: '已发布', updated: '上周' }
]

export const DatabaseMock: React.FC = () => (
  <div className="mock mock-pad" role="img" aria-label="数据库视图示意">
    <div className="mock-cap">
      <Icon name="database" size={13} /> 数据库视图 · 表格
      <span style={{ marginLeft: 'auto' }}>4 条记录</span>
    </div>
    <div className="db-mock">
      <div className="row head">
        <div>名称</div>
        <div>类型</div>
        <div>状态</div>
        <div>更新</div>
      </div>
      {DB_ROWS.map((r) => (
        <div className="row" key={r.name}>
          <div>{r.name}</div>
          <div>{r.type}</div>
          <div>
            <span className="tag">{r.status}</span>
          </div>
          <div>{r.updated}</div>
        </div>
      ))}
    </div>
  </div>
)

/* --------------------------------------------------- sync flow mock */
export const SyncFlow: React.FC = () => (
  <div className="sync-flow">
    <div className="device-card">
      <Icon name="window" size={26} />
      <div className="n">Windows 桌面端</div>
      <div className="s">本地仓库 · 已同步</div>
    </div>
    <div className="sync-link">
      <div className="sync-dash" />
      <span className="lbl">实时同步</span>
      <div className="sync-dash" />
    </div>
    <div className="device-card">
      <Icon name="smartphone" size={26} />
      <div className="n">Android / iOS</div>
      <div className="s">离线可写 · 秒级回传</div>
    </div>
  </div>
)
