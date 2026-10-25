/**
 * plugins — 我的插件（已安装 / 启用开关 / 卸载 / 上传自定义包）
 */
import React, { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API, type InstalledPlugin } from '@/lib/contracts'
import { useStore } from '@/store'
import { Dialog } from '@/components/Overlays'
import { fmtDate, pick, safeArr, useRemote } from '@/features/marketing/portalKit'
import { CATEGORY_LABEL } from '@/features/marketing/portalData'
import { EmptyBox, ErrorBox, Loading, Section, Toggle } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  builtin: { label: '内置', cls: 'neutral' },
  store: { label: '商店', cls: '' },
  uploaded: { label: '自上传', cls: 'warn' }
}

const normalize = (raw: any): InstalledPlugin => {
  const m = raw?.manifest || raw?.manifest_json || {}
  return {
    id: String(pick(raw, ['id', 'plugin_id'], '') || pick(m, ['id'], '')),
    version: String(pick(raw, ['version'], '') || pick(m, ['version'], '1.0.0')),
    enabled: pick(raw, ['enabled'], true) !== false,
    source: (pick(raw, ['source'], 'builtin') as InstalledPlugin['source']) || 'builtin',
    installed_at: String(pick(raw, ['installed_at', 'installedAt', 'created_at'], '')),
    manifest: Object.keys(m || {}).length ? { ...m, id: String(pick(m, ['id'], pick(raw, ['id'], ''))) } : undefined,
    update_available: pick(raw, ['update_available', 'updateAvailable', 'latest_version'], undefined)
  }
}

const PluginsPanel: React.FC<PanelProps> = () => {
  const toast = useStore((s) => s.toast)
  const installed = useRemote<any>(API.pluginsInstalled, [], (raw) => safeArr<any>(raw).map(normalize))
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [detail, setDetail] = useState<InstalledPlugin | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<InstalledPlugin | null>(null)
  const [localState, setLocalState] = useState<Record<string, boolean>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const isEnabled = (p: InstalledPlugin) => localState[p.id] ?? p.enabled

  const toggle = async (p: InstalledPlugin) => {
    const next = !isEnabled(p)
    setLocalState((s) => ({ ...s, [p.id]: next }))
    setBusy('toggle-' + p.id)
    try {
      await api.post(API.pluginsToggle, { id: p.id, enabled: next })
      toast({ kind: 'ok', text: `${next ? '已启用' : '已停用'}「${p.manifest?.name || p.id}」` })
    } catch (e: any) {
      setLocalState((s) => ({ ...s, [p.id]: !next }))
      toast({ kind: 'error', text: e?.message || '切换失败，请稍后重试' })
    } finally {
      setBusy(null)
    }
  }

  const uninstall = async (p: InstalledPlugin) => {
    setBusy('uninstall-' + p.id)
    try {
      await api.post(API.pluginsUninstall, { id: p.id })
      toast({ kind: 'ok', text: `已卸载「${p.manifest?.name || p.id}」` })
      setConfirmUninstall(null)
      installed.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '卸载失败' })
    } finally {
      setBusy(null)
    }
  }

  const update = async (p: InstalledPlugin) => {
    setBusy('update-' + p.id)
    try {
      await api.post(API.pluginsUpdate, { id: p.id })
      toast({ kind: 'ok', text: `「${p.manifest?.name || p.id}」已更新到最新版本` })
      installed.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '更新失败' })
    } finally {
      setBusy(null)
    }
  }

  const upload = async (file: File) => {
    if (!/\.zip$/i.test(file.name)) {
      toast({ kind: 'warn', text: '插件包需为 .zip 格式' })
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ kind: 'warn', text: '插件包不能超过 8 MB' })
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.upload<any>(API.pluginsUpload, form)
      const name = pick(res, ['manifest'], null) ? String(pick((res as any).manifest, ['name'], pick(res, ['id'], file.name))) : file.name
      toast({ kind: 'ok', text: `插件「${name}」已上传并安装` })
      installed.reload()
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '上传失败，请检查插件包结构（需含 manifest.json）' })
    } finally {
      setUploading(false)
    }
  }

  const rows = installed.data
  const updates = rows.filter((p) => !!p.update_available)

  return (
    <>
      <Section
        icon="puzzle"
        title="已安装插件"
        desc="内置插件随客户端更新，商店插件可单独升级，自上传插件仅在当前账号生效。"
        actions={
          <>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <span className="spinner" /> : <Icon name="upload" size={13} />} 上传插件包
            </button>
            <button className="btn btn-sm" onClick={installed.reload} disabled={installed.loading}>
              {installed.loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 刷新
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload(f)
                e.target.value = ''
              }}
            />
          </>
        }
      >
        {updates.length > 0 && (
          <div className="p-note" style={{ marginBottom: 14 }}>
            <Icon name="refresh" size={15} />
            <span className="grow">
              有 {updates.length} 个插件可更新：{updates.map((p) => p.manifest?.name || p.id).join('、')}
            </span>
            <button
              className="btn btn-sm"
              onClick={async () => {
                for (const p of updates) await update(p)
              }}
            >
              全部更新
            </button>
          </div>
        )}

        {installed.loading ? (
          <Loading text="正在加载插件列表…" />
        ) : installed.error ? (
          <ErrorBox message={installed.error} onRetry={installed.reload} />
        ) : rows.length === 0 ? (
          <EmptyBox
            icon="puzzle"
            title="还没有安装任何插件"
            desc="内置插件会在首次登录时自动注册；也可以去插件商店挑选，或上传自己开发的插件包。"
            action={
              <Link className="btn btn-sm btn-primary" to="/plugins">
                <Icon name="grid" size={13} /> 去插件商店
              </Link>
            }
          />
        ) : (
          <div>
            {rows.map((p) => {
              const src = SOURCE_META[p.source] || SOURCE_META.builtin
              const manifest = p.manifest
              return (
                <div className="ac-plugin" key={p.id}>
                  <span className="p-tile" style={{ width: 34, height: 34, borderRadius: 10 }}>
                    <Icon name={manifest?.icon || 'puzzle'} size={16} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="t">
                      {manifest?.name || p.id}
                      <span className="badge neutral">v{p.version}</span>
                      <span className={'badge ' + src.cls}>{src.label}</span>
                      {manifest?.category && <span className="badge neutral">{CATEGORY_LABEL[manifest.category] || manifest.category}</span>}
                      {p.update_available && (
                        <span className="badge warn">
                          <Icon name="refresh" size={10} /> 可更新至 v{p.update_available}
                        </span>
                      )}
                      {!isEnabled(p) && <span className="badge danger">已停用</span>}
                    </div>
                    <div className="d">{manifest?.description || '—'}</div>
                    <div className="d mono" style={{ opacity: 0.85 }}>
                      {p.id}
                      {p.installed_at ? ` · 安装于 ${fmtDate(p.installed_at)}` : ''}
                    </div>
                  </div>
                  <div className="ops">
                    <Toggle on={isEnabled(p)} onChange={() => toggle(p)} disabled={busy === 'toggle-' + p.id} />
                    <button className="btn btn-sm" onClick={() => setDetail(p)}>
                      <Icon name="info" size={12} /> 详情
                    </button>
                    {p.update_available && (
                      <button className="btn btn-sm btn-primary" onClick={() => update(p)} disabled={busy === 'update-' + p.id}>
                        {busy === 'update-' + p.id ? <span className="spinner" /> : <Icon name="refresh" size={12} />} 更新
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setConfirmUninstall(p)}
                      disabled={p.source === 'builtin'}
                      title={p.source === 'builtin' ? '内置插件不可卸载，可停用' : '卸载插件'}
                    >
                      <Icon name="trash" size={12} /> 卸载
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section icon="help" title="如何上传自定义插件" desc="插件包结构说明。">
        <div className="sync-list">
          {[
            { icon: 'folder', t: '打包为 zip', d: '根目录必须包含 manifest.json，可选 index.js（入口脚本）、icon.svg、README.md。' },
            { icon: 'file-text', t: 'manifest 必备字段', d: 'id、name、version、minAppVersion、description、author、category、permissions。' },
            { icon: 'key', t: '权限声明', d: '只申请真正需要的权限（files:read / files:write / editor:write / network 等），审核与用户都会据此判断风险。' },
            { icon: 'upload', t: '上传后即时生效', d: '上传成功即安装到当前账号，可在编辑器「设置 → 插件」中启用或调整位置。' }
          ].map((x) => (
            <div className="sync-item" key={x.t}>
              <span className="p-tile">
                <Icon name={x.icon} size={16} />
              </span>
              <div>
                <div className="t">{x.t}</div>
                <div className="d">{x.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btn-sm" to="/plugins/dev">
            <Icon name="code" size={13} /> 查看插件开发指南
          </Link>
          <Link className="btn btn-sm" to="/plugins">
            <Icon name="grid" size={13} /> 浏览插件商店
          </Link>
        </div>
      </Section>

      {detail && (
        <Dialog
          title={detail.manifest?.name || detail.id}
          icon={detail.manifest?.icon || 'puzzle'}
          onClose={() => setDetail(null)}
          width={620}
          footer={
            <>
              <button className="btn" onClick={() => setDetail(null)}>
                关闭
              </button>
              <Toggle on={isEnabled(detail)} onChange={() => toggle(detail)} />
            </>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            <p className="small" style={{ margin: 0, lineHeight: 1.7, color: 'var(--text-2)' }}>
              {detail.manifest?.description || '该插件没有提供描述。'}
            </p>
            <div className="ac-grid2">
              <div className="ac-kv">
                <span className="k">插件 ID</span>
                <span className="v mono">{detail.id}</span>
              </div>
              <div className="ac-kv">
                <span className="k">版本</span>
                <span className="v">{detail.version}</span>
              </div>
              <div className="ac-kv">
                <span className="k">作者</span>
                <span className="v">{detail.manifest?.author || '—'}</span>
              </div>
              <div className="ac-kv">
                <span className="k">分类</span>
                <span className="v">{CATEGORY_LABEL[detail.manifest?.category || ''] || detail.manifest?.category || '—'}</span>
              </div>
              <div className="ac-kv">
                <span className="k">来源</span>
                <span className="v">{SOURCE_META[detail.source]?.label || detail.source}</span>
              </div>
              <div className="ac-kv">
                <span className="k">最低版本</span>
                <span className="v">{detail.manifest?.minAppVersion || '—'}</span>
              </div>
            </div>

            <div>
              <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>
                申请的权限
              </div>
              {detail.manifest?.permissions?.length ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {detail.manifest.permissions.map((p) => (
                    <span className="chip" key={p} style={{ cursor: 'default' }}>
                      {p}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="tiny dim">未声明额外权限</span>
              )}
            </div>

            {!!detail.manifest?.contributes?.commands?.length && (
              <div>
                <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>
                  提供的命令
                </div>
                {detail.manifest.contributes.commands.map((c) => (
                  <div className="ac-kv" key={c.id}>
                    <span className="k mono">{c.id}</span>
                    <span className="v">
                      {c.name}
                      {c.hotkey ? ` · ${c.hotkey}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog>
      )}

      {confirmUninstall && (
        <Dialog
          title="确认卸载插件？"
          icon="alert"
          onClose={() => setConfirmUninstall(null)}
          width={430}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmUninstall(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => uninstall(confirmUninstall)}
                disabled={busy === 'uninstall-' + confirmUninstall.id}
              >
                {busy === 'uninstall-' + confirmUninstall.id ? <span className="spinner" /> : null} 卸载
              </button>
            </>
          }
        >
          <p className="small" style={{ lineHeight: 1.7, margin: 0 }}>
            将卸载「{confirmUninstall.manifest?.name || confirmUninstall.id}」。插件产生的数据与设置不会自动删除，
            重新安装后可继续使用。
          </p>
        </Dialog>
      )}
    </>
  )
}

export default PluginsPanel
