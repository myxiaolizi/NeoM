/**
 * storage — 云存储设置（个人 OSS / COS / TOS / BOS / S3）
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { API, type StorageSettings } from '@/lib/contracts'
import { useStore } from '@/store'
import { STORAGE_VENDORS } from '@/features/marketing/portalData'
import { fmtDate, pick } from '@/features/marketing/portalKit'
import { Field, FormFooter, Section } from '../AccountUI'
import type { PanelProps } from '../AccountPage'

interface FormState {
  vendor: string
  bucket: string
  endpoint: string
  region: string
  access_key_id: string
  access_key_secret: string
  public_domain: string
  prefix: string
  path_style: boolean
}

const EMPTY: FormState = {
  vendor: 'system',
  bucket: '',
  endpoint: '',
  region: '',
  access_key_id: '',
  access_key_secret: '',
  public_domain: '',
  prefix: 'md/user/',
  path_style: false
}

const StoragePanel: React.FC<PanelProps> = ({ user }) => {
  const toast = useStore((s) => s.toast)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; latency?: number } | null>(null)
  const [hasSecret, setHasSecret] = useState(false)
  const [savedAt, setSavedAt] = useState<string>('')
  const [showSecret, setShowSecret] = useState(false)

  const vendor = useMemo(() => STORAGE_VENDORS.find((v) => v.id === form.vendor) || STORAGE_VENDORS[0], [form.vendor])
  const isSystem = form.vendor === 'system'

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }))

  const load = () => {
    setLoading(true)
    setLoadErr('')
    api
      .get<any>(API.storageGet)
      .then((raw) => {
        const cfg = (raw?.settings || raw || {}) as any
        setForm({
          vendor: String(pick(cfg, ['vendor'], 'system') || 'system'),
          bucket: String(pick(cfg, ['bucket'], '') || ''),
          endpoint: String(pick(cfg, ['endpoint'], '') || ''),
          region: String(pick(cfg, ['region'], '') || ''),
          access_key_id: String(pick(cfg, ['access_key_id', 'accessKeyId', 'ak'], '') || ''),
          access_key_secret: '',
          public_domain: String(pick(cfg, ['public_domain', 'publicDomain'], '') || ''),
          prefix: String(pick(cfg, ['prefix'], '') || ''),
          path_style: !!pick(cfg, ['path_style', 'pathStyle'], false)
        })
        setHasSecret(!!pick(cfg, ['hasSecret', 'has_secret'], false))
        setSavedAt(String(pick(cfg, ['test_at', 'updated_at'], '') || ''))
      })
      .catch((e: any) => setLoadErr(e?.message || '无法读取存储配置'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  /** Fill endpoint from the vendor template using the current bucket/region. */
  const applyTemplate = (vendorId: string) => {
    const v = STORAGE_VENDORS.find((x) => x.id === vendorId)
    if (!v) return
    const next: Partial<FormState> = { vendor: vendorId }
    if (v.id === 'system') {
      next.bucket = ''
      next.endpoint = ''
      next.region = ''
      next.access_key_id = ''
      next.access_key_secret = ''
      next.public_domain = ''
    } else {
      const b = form.bucket || 'your-bucket'
      const r = form.region || v.regionHint
      if (!form.region) next.region = v.regionHint
      next.endpoint = v.endpointTpl.replace('{bucket}', b).replace('{region}', r)
    }
    patch(next)
    setTestResult(null)
  }

  const save = async () => {
    if (!isSystem) {
      if (!form.bucket.trim()) {
        toast({ kind: 'warn', text: '请填写 Bucket 名称' })
        return
      }
      if (!form.endpoint.trim()) {
        toast({ kind: 'warn', text: '请填写 Endpoint（可点「填充模板」）' })
        return
      }
      if (!form.access_key_id.trim()) {
        toast({ kind: 'warn', text: '请填写 AccessKey ID' })
        return
      }
    }
    setSaving(true)
    try {
      const payload: Partial<StorageSettings> & Record<string, unknown> = {
        vendor: form.vendor as StorageSettings['vendor'],
        bucket: form.bucket.trim() || undefined,
        endpoint: form.endpoint.trim() || undefined,
        region: form.region.trim() || undefined,
        access_key_id: form.access_key_id.trim() || undefined,
        public_domain: form.public_domain.trim() || undefined,
        prefix: form.prefix.trim() || undefined,
        path_style: form.path_style
      }
      /* only send the secret when the user typed a new one */
      if (form.access_key_secret) payload.access_key_secret = form.access_key_secret
      await api.post(API.storageSave, payload)
      if (form.access_key_secret) setHasSecret(true)
      setForm((f) => ({ ...f, access_key_secret: '' }))
      setSavedAt(new Date().toISOString())
      toast({ kind: 'ok', text: '存储配置已保存' })
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message || '保存失败，请检查配置是否正确' })
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    const started = performance.now()
    try {
      const payload = {
        vendor: form.vendor,
        bucket: form.bucket.trim() || undefined,
        endpoint: form.endpoint.trim() || undefined,
        region: form.region.trim() || undefined,
        access_key_id: form.access_key_id.trim() || undefined,
        access_key_secret: form.access_key_secret || undefined,
        path_style: form.path_style
      }
      const raw = await api.post<any>(API.storageTest, payload)
      const ok = pick(raw, ['ok', 'success'], true) !== false
      const latency = Number(pick(raw, ['latencyMs', 'latency_ms', 'latency'], Math.round(performance.now() - started)))
      setTestResult({
        ok,
        msg: String(pick(raw, ['msg', 'message'], ok ? '连接成功' : '连接失败') || (ok ? '连接成功' : '连接失败')),
        latency
      })
      toast({ kind: ok ? 'ok' : 'warn', text: ok ? `连通性正常（${latency}ms）` : '连通性测试未通过' })
    } catch (e: any) {
      setTestResult({
        ok: false,
        msg: e?.message || '连通性测试失败',
        latency: Math.round(performance.now() - started)
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <Section
        icon="cloud"
        title="存储位置"
        desc="未设置个人 OSS 时，你的文件存放在系统默认 OSS 的专属目录 md/user/&lt;你的用户名&gt;/ 下；设置个人存储后文件直存你的云账号。"
        actions={
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />} 重新读取
          </button>
        }
      >
        {loading ? (
          <div className="p-state">
            <span className="spinner" /> 正在读取存储配置…
          </div>
        ) : (
          <>
            {loadErr && (
              <div className="p-inline-err" style={{ marginBottom: 14 }}>
                <Icon name="alert" size={14} />
                <span>{loadErr}（可继续填写并保存）</span>
              </div>
            )}

            <div className="ac-vendor-grid">
              {STORAGE_VENDORS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={'ac-vendor' + (form.vendor === v.id ? ' active' : '')}
                  onClick={() => applyTemplate(v.id)}
                >
                  <span className="row" style={{ gap: 7 }}>
                    <Icon name={v.id === 'system' ? 'server' : 'cloud'} size={14} />
                    <span className="n">{v.label}</span>
                  </span>
                  <span className="d">{v.id === 'system' ? '共享空间，免配置' : v.docs ? '兼容 S3 协议' : ''}</span>
                </button>
              ))}
            </div>

            {isSystem ? (
              <div className="p-note" style={{ marginTop: 16 }}>
                <Icon name="info" size={15} />
                <span>
                  当前使用系统默认存储。你的所有文件位于 <code className="mono">md/user/{user?.username || '<用户名>'}/</code>
                  ，配额上限 {user?.storage_quota_mb ? `${Math.round(user.storage_quota_mb / 1024)} GB` : '按站点默认'}。
                  如需独立域名与更高带宽，请选择上方任意厂商并填写自己的密钥。
                </span>
              </div>
            ) : (
              <>
                {vendor?.docs && (
                  <div className="row" style={{ marginTop: 14, gap: 8 }}>
                    <a className="btn btn-sm" href={vendor.docs} target="_blank" rel="noopener noreferrer">
                      <Icon name="external" size={12} /> 查看 {vendor.label} 文档
                    </a>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => applyTemplate(form.vendor)}
                    >
                      <Icon name="refresh" size={12} /> 填充 Endpoint 模板
                    </button>
                  </div>
                )}

                <div className="ac-grid2" style={{ marginTop: 16 }}>
                  <Field label="Bucket" required hint="存储桶名称，需为公有读或配置自定义域名才能直接访问图片">
                    <input className="input" value={form.bucket} onChange={(e) => patch({ bucket: e.target.value })} placeholder="my-neom-bucket" />
                  </Field>
                  <Field label="Region / 区域" hint={vendor?.regionHint ? `该厂商常用：${vendor.regionHint}` : ''}>
                    <input className="input" value={form.region} onChange={(e) => patch({ region: e.target.value })} placeholder={vendor?.regionHint || 'cn-hangzhou'} />
                  </Field>
                  <Field label="Endpoint" required hint="形如 https://{bucket}.oss-{region}.aliyuncs.com">
                    <input className="input mono" value={form.endpoint} onChange={(e) => patch({ endpoint: e.target.value })} placeholder="https://…" />
                  </Field>
                  <Field label="访问域名（可选）" hint="CDN 或自定义域名，留空则使用 Endpoint">
                    <input className="input" value={form.public_domain} onChange={(e) => patch({ public_domain: e.target.value })} placeholder="https://cdn.example.com" />
                  </Field>
                  <Field label="AccessKey ID" required>
                    <input className="input mono" value={form.access_key_id} onChange={(e) => patch({ access_key_id: e.target.value })} placeholder="LTAI…" autoComplete="off" />
                  </Field>
                  <Field
                    label="AccessKey Secret"
                    required={!hasSecret}
                    hint={hasSecret ? '已保存密钥，留空表示不修改' : '密钥在服务端加密存储，接口不会回传明文'}
                  >
                    <div className="pwd-wrap">
                      <input
                        className="input mono"
                        type={showSecret ? 'text' : 'password'}
                        value={form.access_key_secret}
                        onChange={(e) => patch({ access_key_secret: e.target.value })}
                        placeholder={hasSecret ? '••••••••（已保存，留空不修改）' : '请输入 AccessKey Secret'}
                        autoComplete="new-password"
                      />
                      <button type="button" className="eye" onClick={() => setShowSecret((v) => !v)} aria-label="显示或隐藏">
                        <Icon name={showSecret ? 'eye-off' : 'eye'} size={15} />
                      </button>
                    </div>
                  </Field>
                  <Field label="存储前缀" hint="文件会存放在该前缀下，建议保持 md/user/ 以区分其他文件">
                    <input className="input mono" value={form.prefix} onChange={(e) => patch({ prefix: e.target.value })} placeholder="md/user/" />
                  </Field>
                  <Field label="路径风格（Path Style）" hint="MinIO / 部分自建 S3 需要开启">
                    <label className="check">
                      <input type="checkbox" checked={form.path_style} onChange={(e) => patch({ path_style: e.target.checked })} />
                      使用 path-style 访问（https://endpoint/bucket/key）
                    </label>
                  </Field>
                </div>
              </>
            )}

            {testResult && (
              <div
                className={'p-note' + (testResult.ok ? '' : ' warn')}
                style={{ marginTop: 14, background: testResult.ok ? 'var(--ok-soft)' : undefined, color: testResult.ok ? 'var(--ok)' : undefined }}
              >
                <Icon name={testResult.ok ? 'check' : 'alert'} size={15} />
                <span>
                  {testResult.ok ? '连通性测试通过' : '连通性测试失败'}：{testResult.msg}
                  {typeof testResult.latency === 'number' ? ` · 延迟 ${testResult.latency} ms` : ''}
                </span>
              </div>
            )}

            {savedAt && (
              <div className="tiny dim" style={{ marginTop: 10 }}>
                最近更新：{fmtDate(savedAt, true)}
                {hasSecret && ' · 密钥已加密保存'}
              </div>
            )}

            <FormFooter note="保存前建议先点「连通性测试」，确认读写权限正确">
              <button className="btn" onClick={testConnection} disabled={testing}>
                {testing ? <span className="spinner" /> : <Icon name="wifi" size={13} />} 连通性测试
              </button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" /> : <Icon name="save" size={13} />} 保存配置
              </button>
            </FormFooter>
          </>
        )}
      </Section>

      <Section icon="shield" title="配置建议" desc="对象存储安全的最佳实践。">
        <div className="sync-list">
          {[
            { icon: 'key', t: '使用子账号密钥', d: '为 NeoM 单独创建 RAM 子账号，只授予指定 Bucket 的读写权限，避免主账号密钥泄露。' },
            { icon: 'lock', t: 'Bucket 权限最小化', d: '如仅需分享图片，可将 Bucket 设为公有读；笔记内容建议保持私有，通过预签名 URL 访问。' },
            { icon: 'globe', t: '绑定自定义域名', d: '配置 CDN 加速与 HTTPS 证书后，图片外链更快更稳定。' },
            { icon: 'refresh', t: '定期更换密钥', d: '建议每 90 天轮换一次 AccessKey，保存新密钥后旧密钥即可在云控制台删除。' }
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
      </Section>
    </>
  )
}

export default StoragePanel
