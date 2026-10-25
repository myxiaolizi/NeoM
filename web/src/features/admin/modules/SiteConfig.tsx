/**
 * Module 9 — 门户首页与站点系统配置
 */
import React, { useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  Field, KV, Note, PageHeader, Section, Tabs, Tag,
  callApi, cx, useApiData, useConfirm, useToast
} from '../components'

interface SiteState {
  site: Record<string, any>
  docs: { k: string; title: string; content: string }[]
  sys: Record<string, any>
}

const DEMO: SiteState = {
  site: {
    banner_title: '把想法写成作品',
    banner_sub: 'NeoM 云端 Markdown 工作台 —— AI 辅助写作、知识图谱、插件扩展，Windows / macOS / 移动端全平台同步。',
    banner_cta: '免费开始写作',
    copyright: '© 2026 NeoM · 郑力工作室',
    icp: '粤ICP备2026000000号',
    announcement: 'NeoM 1.0.0 正式发布，注册即送 100 积分，AI 助手限时免费体验。',
    features: [
      { title: '所见即所得编辑器', desc: 'Vditor 内核，Markdown 即时渲染' },
      { title: 'AI 写作助手', desc: '润色、扩写、摘要、翻译、命名与语音转写' },
      { title: '云端仓库同步', desc: '文档自动存阿里云 OSS，多端实时同步' },
      { title: '24 款内置插件', desc: '白板、关系图谱、幻灯片、日记、字数统计' },
      { title: '分享与发布', desc: '一键生成免登录阅读页' },
      { title: '全平台客户端', desc: 'Windows / macOS / Android / iOS' }
    ]
  },
  docs: [
    { k: 'terms', title: '用户服务协议', content: '（此处为用户服务协议正文）' },
    { k: 'privacy', title: '隐私政策', content: '（此处为隐私政策正文）' }
  ],
  sys: {
    register_enabled: 1, register_gift_points: 100, signin_points: 100,
    point_per_cny: 100, default_naming_mode: 'template', default_theme: 'system',
    smtp_host: '', smtp_port: 465, smtp_user: '', sms_provider: '', upload_max_mb: 50
  }
}

const SiteConfig: React.FC = () => {
  const confirm = useConfirm()
  const toast = useToast()
  const [tab, setTab] = useState<'portal' | 'features' | 'docs' | 'system'>('portal')
  const [draft, setDraft] = useState<Partial<SiteState>>({})
  const [busy, setBusy] = useState(false)

  const apiState = useApiData<SiteState>(
    async () => {
      const raw: any = await api.get('/api/admin/site')
      if (!raw || (!raw.site && !raw.sys)) throw new Error('empty')
      return { site: raw.site || {}, docs: raw.docs || [], sys: raw.sys || {} }
    },
    DEMO,
    []
  )

  const site = { ...apiState.data.site, ...(draft.site || {}) }
  const sys = { ...apiState.data.sys, ...(draft.sys || {}) }
  const docs = draft.docs || apiState.data.docs
  const features: any[] = Array.isArray(site.features) ? site.features : []

  const setSite = (k: string, v: any) => setDraft((d) => ({ ...d, site: { ...(d.site || {}), [k]: v } }))
  const setSys = (k: string, v: any) => setDraft((d) => ({ ...d, sys: { ...(d.sys || {}), [k]: v } }))
  const setDocs = (list: SiteState['docs']) => setDraft((d) => ({ ...d, docs: list }))

  const save = async () => {
    setBusy(true)
    const r = await callApi(
      () => api.post('/api/admin/site', { site, docs, sys }),
      '站点配置已保存',
      '保存失败'
    )
    setBusy(false)
    if (r.ok) {
      apiState.setData({ site, docs, sys })
      setDraft({})
    }
  }

  const dirty = Object.keys(draft).length > 0

  return (
    <>
      <PageHeader
        icon="globe"
        title="门户与站点配置"
        desc="首页 Banner、特性卡片、协议文档、注册开关、SMTP/SMS 与全局公告"
        demo={apiState.demo}
        reload={apiState.reload}
        loading={apiState.loading}
        actions={
          <>
            {dirty && <Tag tone="warn">有未保存修改</Tag>}
            <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy}>
              {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name="save" size={13} />}
              保存全部
            </button>
          </>
        }
      />

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { id: 'portal', label: '首页 Banner' },
          { id: 'features', label: '特性卡片', count: features.length },
          { id: 'docs', label: '协议与政策', count: docs.length },
          { id: 'system', label: '系统与通知' }
        ]}
      />

      {tab === 'portal' && (
        <>
          <Section title="Banner 文案" icon="image">
            <Field label="主标题">
              <input className="input" value={site.banner_title || ''} onChange={(e) => setSite('banner_title', e.target.value)} />
            </Field>
            <Field label="副标题">
              <textarea className="textarea" rows={3} value={site.banner_sub || ''} onChange={(e) => setSite('banner_sub', e.target.value)} />
            </Field>
            <div className="adm-grid-2">
              <Field label="CTA 按钮文案">
                <input className="input" value={site.banner_cta || ''} onChange={(e) => setSite('banner_cta', e.target.value)} />
              </Field>
              <Field label="宣传截图 URL" hint="留空则使用内置 CSS 示意图">
                <input className="input mono" value={site.banner_image || ''} onChange={(e) => setSite('banner_image', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="页脚与备案" icon="file-text">
            <div className="adm-grid-2">
              <Field label="版权信息">
                <input className="input" value={site.copyright || ''} onChange={(e) => setSite('copyright', e.target.value)} />
              </Field>
              <Field label="ICP 备案号">
                <input className="input" value={site.icp || ''} onChange={(e) => setSite('icp', e.target.value)} />
              </Field>
              <Field label="联系邮箱">
                <input className="input" value={site.contact || ''} onChange={(e) => setSite('contact', e.target.value)} />
              </Field>
              <Field label="默认主域名">
                <input className="input mono" value={site.mobile_base || 'https://m.zhengl.vip'} onChange={(e) => setSite('mobile_base', e.target.value)} />
              </Field>
            </div>
          </Section>
        </>
      )}

      {tab === 'features' && (
        <Section title="核心特性卡片" icon="grid" sub="显示在宣传首页的特性网格" actions={
          <button className="btn btn-sm" onClick={() => setSite('features', [...features, { title: '新特性', desc: '描述' }])}>
            <Icon name="plus" size={12} /> 新增卡片
          </button>
        }>
          {features.map((f, i) => (
            <div className="adm-feature-row" key={i}>
              <input className="input" placeholder="标题" value={f.title || ''}
                onChange={(e) => setSite('features', features.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input className="input" placeholder="描述" value={f.desc || ''}
                onChange={(e) => setSite('features', features.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))} />
              <button className="btn btn-ghost btn-sm"
                onClick={() => setSite('features', features.filter((_, j) => j !== i))}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
          {features.length === 0 && <div className="empty">暂无特性卡片</div>}
        </Section>
      )}

      {tab === 'docs' && (
        <Section title="协议与政策文档" icon="file-text" sub="用户服务协议 / 隐私政策 / 插件开发指南">
          {docs.map((d, i) => (
            <div key={d.k} style={{ marginBottom: 18 }}>
              <Field label={`${d.title}（${d.k}）`}>
                <textarea className="textarea" rows={6} value={d.content}
                  onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))} />
              </Field>
            </div>
          ))}
          {docs.length === 0 && <div className="empty">暂无文档</div>}
        </Section>
      )}

      {tab === 'system' && (
        <>
          <Section title="注册与积分" icon="user">
            <div className="adm-grid-3">
              <Field label="全站注册开关">
                <button className={cx('btn', Number(sys.register_enabled) ? 'btn-ok' : 'btn-ghost')}
                  onClick={() => setSys('register_enabled', Number(sys.register_enabled) ? 0 : 1)}>
                  {Number(sys.register_enabled) ? '已开启' : '已关闭'}
                </button>
              </Field>
              <Field label="新用户赠送积分">
                <input className="input num" type="number" value={sys.register_gift_points ?? 100}
                  onChange={(e) => setSys('register_gift_points', Number(e.target.value))} />
              </Field>
              <Field label="每日签到赠送积分">
                <input className="input num" type="number" value={sys.signin_points ?? 100}
                  onChange={(e) => setSys('signin_points', Number(e.target.value))} />
              </Field>
              <Field label="积分兑换比例（积分/元）">
                <input className="input num" type="number" value={sys.point_per_cny ?? 100}
                  onChange={(e) => setSys('point_per_cny', Number(e.target.value))} />
              </Field>
              <Field label="新用户默认命名方式">
                <select className="input" value={sys.default_naming_mode || 'template'}
                  onChange={(e) => setSys('default_naming_mode', e.target.value)}>
                  <option value="template">时间戳模板命名</option>
                  <option value="ai">AI 智能命名</option>
                </select>
              </Field>
              <Field label="默认主题">
                <select className="input" value={sys.default_theme || 'system'}
                  onChange={(e) => setSys('default_theme', e.target.value)}>
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="全局公告弹窗" icon="bell">
            <Field label="公告内容" hint="留空则不显示；首页顶部也会展示公告条">
              <textarea className="textarea" rows={3} value={site.announcement || ''}
                onChange={(e) => setSite('announcement', e.target.value)} />
            </Field>
          </Section>

          <Section title="邮件验证码（SMTP）" icon="send">
            <div className="adm-grid-3">
              <Field label="SMTP 主机"><input className="input mono" value={sys.smtp_host || ''} onChange={(e) => setSys('smtp_host', e.target.value)} /></Field>
              <Field label="端口"><input className="input num" type="number" value={sys.smtp_port ?? 465} onChange={(e) => setSys('smtp_port', Number(e.target.value))} /></Field>
              <Field label="发信账号"><input className="input mono" value={sys.smtp_user || ''} onChange={(e) => setSys('smtp_user', e.target.value)} /></Field>
            </div>
            <Field label="发信密码 / 授权码" hint="加密存储，保存后仅显示掩码">
              <input className="input" type="password" placeholder="不修改请留空" />
            </Field>
            <button className="btn btn-sm"><Icon name="send" size={12} /> 发送测试邮件</button>
          </Section>

          <Section title="短信验证码" icon="smartphone">
            <div className="adm-grid-2">
              <Field label="服务商">
                <select className="input" value={sys.sms_provider || ''} onChange={(e) => setSys('sms_provider', e.target.value)}>
                  <option value="">未启用</option>
                  <option value="aliyun">阿里云短信</option>
                  <option value="tencent">腾讯云短信</option>
                </select>
              </Field>
              <Field label="AccessKey / SecretKey" hint="加密存储">
                <input className="input" type="password" placeholder="不修改请留空" />
              </Field>
            </div>
            <Note tone="info">未配置 SMTP / SMS 时，注册与绑定仅支持邮箱/手机号格式校验，不发送真实验证码。</Note>
          </Section>
        </>
      )}

      {confirm.node}
    </>
  )
}

export default SiteConfig
