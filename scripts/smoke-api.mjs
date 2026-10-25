#!/usr/bin/env node
/**
 * NeoM API smoke test — exercises the real endpoints against a running server.
 *
 *   node scripts/smoke-api.mjs                      # default http://127.0.0.1:3300
 *   node scripts/smoke-api.mjs https://m.zhengl.vip
 *
 * Exits non-zero when a check fails, so it can gate a deploy.
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:3300').replace(/\/$/, '')
const ADMIN = { account: process.env.NEOM_ADMIN || 'admin', password: process.env.NEOM_ADMIN_PW || 'NeoM@2026' }

let token = null
const results = []

const call = async (method, path, body, { auth = true, raw = false } = {}) => {
  const headers = { 'Content-Type': 'application/json' }
  if (auth && token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  })
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const text = await res.text()
    return { ok: res.ok, status: res.status, text: text.slice(0, 200) }
  }
  const json = await res.json()
  return { ok: res.ok && json.status === true, status: res.status, json }
}

const check = async (name, fn) => {
  try {
    const detail = await fn()
    results.push({ name, pass: true, detail })
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ' — ' + detail : ''}`)
    return true
  } catch (e) {
    results.push({ name, pass: false, detail: e.message })
    console.log(`  \x1b[31m✗\x1b[0m ${name} — ${e.message}`)
    return false
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

const main = async () => {
  console.log(`\nNeoM API 冒烟测试 @ ${BASE}\n`)
  console.log('【公共接口】')

  await check('GET /api/health', async () => {
    const r = await call('GET', '/api/health', undefined, { auth: false })
    assert(r.ok, '健康检查失败')
    assert(r.json.data.db === true, '数据库未连通')
    assert((r.json.data.failed || []).length === 0, `未挂载路由: ${r.json.data.failed}`)
    return `${r.json.data.mounted.length} 个路由已挂载`
  })

  await check('GET /api/site/config', async () => {
    const r = await call('GET', '/api/site/config', undefined, { auth: false })
    assert(r.ok, '站点配置读取失败')
    assert(r.json.data.site_name, '缺少 site_name')
    return `site=${r.json.data.site_name}`
  })

  await check('GET /api/releases', async () => {
    const r = await call('GET', '/api/releases', undefined, { auth: false })
    assert(r.ok, '版本列表失败')
    const n = (r.json.data.platforms || []).length
    assert(n >= 6, `平台数量不足: ${n}`)
    return `${n} 个平台`
  })

  await check('GET /api/plugins/store', async () => {
    const r = await call('GET', '/api/plugins/store', undefined, { auth: false })
    assert(r.ok, '插件商店失败')
    const d = r.json.data
    const n = (Array.isArray(d) ? d : d.plugins || d.list || []).length
    assert(n >= 20, `插件数量不足: ${n}`)
    return `${n} 个插件`
  })

  await check('GET /api/plugins/manifest', async () => {
    const r = await call('GET', '/api/plugins/manifest', undefined, { auth: false })
    assert(r.ok, 'manifest 失败')
    return `${(Array.isArray(r.json.data) ? r.json.data : []).length} 个清单`
  })

  await check('GET /api/bootstrap', async () => {
    const r = await call('GET', '/api/bootstrap', undefined, { auth: false })
    assert(r.ok, 'bootstrap 失败')
    return `keys=${Object.keys(r.json.data).join(',')}`
  })

  await check('GET /api/ai/models (public)', async () => {
    const r = await call('GET', '/api/ai/models', undefined, { auth: false })
    assert(r.ok, '模型列表失败')
    return `${r.json.data.length} 个模型`
  })

  console.log('\n【认证】')
  await check('POST /api/auth/login', async () => {
    const r = await call('POST', '/api/auth/login', ADMIN, { auth: false })
    assert(r.ok, `登录失败: ${r.json?.msg || r.status}`)
    token = r.json.data.token
    assert(token, '未返回 token')
    return `role=${r.json.data.user.role} points=${r.json.data.user.points}`
  })

  await check('GET /api/auth/me', async () => {
    const r = await call('GET', '/api/auth/me')
    assert(r.ok, '获取当前用户失败')
    // The endpoint returns the profile either flat or wrapped in { user }.
    const user = r.json.data.user || r.json.data
    assert(user.username, '未返回用户信息')
    return `user=${user.username} role=${user.role}`
  })

  console.log('\n【文件与版本】')
  const testPath = `_smoke/test-${Date.now()}.md`
  await check('POST /api/files/write (创建)', async () => {
    const r = await call('POST', '/api/files/write', {
      path: testPath, content: '# 冒烟测试\n\nNeoM smoke test content。\n\n#tag\n', naming: 'keep'
    })
    assert(r.ok, `写入失败: ${r.json?.msg}`)
    return `etag=${(r.json.data.etag || '').slice(0, 8)}`
  })

  await check('GET /api/files/read', async () => {
    const r = await call('GET', `/api/files/read?path=${encodeURIComponent(testPath)}`)
    assert(r.ok, '读取失败')
    assert(String(r.json.data.content).includes('冒烟测试'), '内容不匹配')
    return `${r.json.data.content.length} 字符`
  })

  await check('GET /api/files/tree', async () => {
    const r = await call('GET', '/api/files/tree')
    assert(r.ok, '目录树失败')
    const n = Array.isArray(r.json.data) ? r.json.data.length : (r.json.data.list || []).length
    return `${n} 个条目`
  })

  await check('POST /api/files/write 冲突检测 (409)', async () => {
    const res = await fetch(`${BASE}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: testPath, content: 'stale write', baseEtag: 'deadbeefdeadbeef', naming: 'keep' })
    })
    const json = await res.json().catch(() => ({}))
    assert(res.status === 409 || json.code === 'CONFLICT', `期望冲突，实际 ${res.status} ${json.code || ''}`)
    return '409 CONFLICT 正确返回'
  })

  await check('GET /api/files/search', async () => {
    const r = await call('GET', '/api/files/search?q=' + encodeURIComponent('冒烟') + '&scope=all')
    assert(r.ok, '搜索失败')
    const n = (r.json.data.hits || []).length
    return `${n} 个命中`
  })

  await check('GET /api/versions/list', async () => {
    const r = await call('GET', `/api/versions/list?path=${encodeURIComponent(testPath)}`)
    assert(r.ok, '版本列表失败')
    return `${(r.json.data || []).length} 个版本`
  })

  console.log('\n【分享与发布】')
  let shareId = null
  await check('POST /api/share/create', async () => {
    const r = await call('POST', '/api/share/create', { path: testPath, mode: 'comment' })
    assert(r.ok, `创建分享失败: ${r.json?.msg}`)
    shareId = r.json.data.id
    return `mode=${r.json.data.mode} url=${(r.json.data.url || '').slice(0, 40)}`
  })

  await check('GET /api/share/get (免登录)', async () => {
    assert(shareId, '无 shareId')
    const r = await call('GET', `/api/share/get?id=${shareId}`, undefined, { auth: false })
    assert(r.ok, '匿名读取分享失败')
    assert(r.json.data.doc?.name, '缺少文档名')
    return `doc=${r.json.data.doc.name}`
  })

  await check('POST /api/share/comment (免登录)', async () => {
    const r = await call('POST', '/api/share/comment', {
      id: shareId, content: '冒烟测试评论', author: 'smoke-tester'
    }, { auth: false })
    assert(r.ok, `免登录评论失败: ${r.json?.msg}`)
    return '评论已提交'
  })

  let publishId = null
  await check('POST /api/publish/create', async () => {
    const r = await call('POST', '/api/publish/create', { path: testPath })
    assert(r.ok, `发布失败: ${r.json?.msg}`)
    publishId = r.json.data.id
    return `url=${(r.json.data.url || '').slice(0, 40)}`
  })

  await check('GET /p/:id (服务端直出 HTML)', async () => {
    assert(publishId, '无 publishId')
    const res = await fetch(`${BASE}/p/${publishId}`)
    const html = await res.text()
    assert(res.ok, `发布页 ${res.status}`)
    assert(/<html/i.test(html), '不是 HTML 页面')
    return `${html.length} 字节`
  })

  await check('GET /s/:id (分享页 HTML)', async () => {
    const res = await fetch(`${BASE}/s/${shareId}`)
    const html = await res.text()
    assert(res.ok, `分享页 ${res.status}`)
    return `${html.length} 字节`
  })

  console.log('\n【存储】')
  await check('GET /api/storage/settings', async () => {
    const r = await call('GET', '/api/storage/settings')
    assert(r.ok, '存储设置失败')
    return `vendor=${r.json.data.vendor || 'system'}`
  })

  await check('POST /api/storage/test (真实 OSS 连通)', async () => {
    const r = await call('POST', '/api/storage/test', {})
    assert(r.ok, '连通性测试请求失败')
    assert(r.json.data.ok === true, `OSS 不通: ${r.json.data.msg}`)
    return `${r.json.data.latencyMs ?? '?'}ms`
  })

  console.log('\n【AI】')
  await check('GET /api/ai/providers', async () => {
    const r = await call('GET', '/api/ai/providers')
    assert(r.ok, '供应商列表失败')
    assert(r.json.data.length >= 9, `供应商不足: ${r.json.data.length}`)
    return `${r.json.data.length} 个供应商`
  })

  await check('POST /api/ai/fetch-models (动态拉取)', async () => {
    const r = await call('POST', '/api/ai/fetch-models', { providerId: 'mimo' })
    assert(r.ok, '拉取模型失败')
    const models = r.json.data.models || []
    assert(models.length >= 7, `模型不足: ${models.length}`)
    return `${models.length} 个模型${r.json.data.fallback ? ' (兜底)' : ''}`
  })

  await check('POST /api/ai/test (连通性)', async () => {
    const r = await call('POST', '/api/ai/test', { providerId: 'mimo' })
    assert(r.ok, '测试请求失败')
    assert(r.json.data.ok === true, `AI 接口不通: ${r.json.data.msg}`)
    return `${r.json.data.latencyMs}ms, ${r.json.data.modelCount} 个模型`
  })

  await check('POST /api/ai/chat (真实调用 + 扣积分)', async () => {
    const before = await call('GET', '/api/billing/balance')
    const r = await call('POST', '/api/ai/chat', {
      model: 'mimo-v2.6-flash',
      messages: [{ role: 'user', content: '回复两个字：成功' }],
      max_tokens: 32,
      scene: 'chat'
    })
    assert(r.ok, `AI 对话失败: ${r.json?.msg}`)
    assert(r.json.data.content, '返回内容为空')
    const after = await call('GET', '/api/billing/balance')
    const spent = (before.json.data.points ?? 0) - (after.json.data.points ?? 0)
    return `"${String(r.json.data.content).slice(0, 20)}" tokens=${r.json.data.usage.prompt_tokens}/${r.json.data.usage.completion_tokens} 扣费=${r.json.data.usage.points_cost} 余额变化=${spent.toFixed(2)}`
  })

  console.log('\n【积分与账单】')
  await check('GET /api/billing/balance', async () => {
    const r = await call('GET', '/api/billing/balance')
    assert(r.ok, '余额失败')
    return `points=${r.json.data.points}`
  })

  await check('GET /api/billing/packages', async () => {
    const r = await call('GET', '/api/billing/packages')
    assert(r.ok, '套餐失败')
    assert(r.json.data.length >= 4, `套餐不足: ${r.json.data.length}`)
    return `${r.json.data.length} 档`
  })

  await check('GET /api/billing/ledger', async () => {
    const r = await call('GET', '/api/billing/ledger?size=5')
    assert(r.ok, '流水失败')
    const list = r.json.data.list || r.json.data.items || []
    return `${list.length} 条流水`
  })

  console.log('\n【管理后台】')
  await check('POST /api/admin/login', async () => {
    const r = await call('POST', '/api/admin/login', ADMIN, { auth: false })
    assert(r.ok, `管理员登录失败: ${r.json?.msg}`)
    token = r.json.data.token
    return 'token 已刷新'
  })

  await check('GET /api/admin/dashboard', async () => {
    const r = await call('GET', '/api/admin/dashboard')
    assert(r.ok, '仪表盘失败')
    const s = r.json.data.stats
    assert(s, '缺少 stats')
    return `users=${s.usersTotal} docs=${s.docsTotal} tokens=${s.aiTokensTotal}`
  })

  await check('GET /api/admin/users', async () => {
    const r = await call('GET', '/api/admin/users?size=5')
    assert(r.ok, '用户列表失败')
    return `${r.json.data.total} 个用户`
  })

  await check('GET /api/admin/models', async () => {
    const r = await call('GET', '/api/admin/models')
    assert(r.ok, '模型管理失败')
    const pro = r.json.data.find((m) => m.id === 'mimo-v2.6-pro')
    assert(pro, '缺少 mimo-v2.6-pro')
    assert(pro.priceCacheIn === 0.025 && pro.priceIn === 3 && pro.priceOut === 6,
      `pro 价格不符: ${pro.priceCacheIn}/${pro.priceIn}/${pro.priceOut}`)
    return `${r.json.data.length} 个模型，pro 定价 0.025/3.00/6.00 ✓`
  })

  await check('GET /api/admin/channels', async () => {
    const r = await call('GET', '/api/admin/channels')
    assert(r.ok, '渠道列表失败')
    assert(r.json.data.length >= 1, '无渠道')
    return `${r.json.data.length} 个渠道，hasKey=${r.json.data[0].hasKey}`
  })

  await check('GET /api/admin/plugins', async () => {
    const r = await call('GET', '/api/admin/plugins')
    assert(r.ok, '插件管理失败')
    const d = r.json.data
    const list = Array.isArray(d) ? d : d.list || d.plugins || []
    assert(list.length >= 25, `插件不足: ${list.length}`)
    return `${list.length} 个插件`
  })

  await check('GET /api/admin/shares', async () => {
    const r = await call('GET', '/api/admin/shares')
    assert(r.ok, '分享监管失败')
    return `分享=${r.json.data.total} 发布=${r.json.data.totalPublish}`
  })

  await check('GET /api/admin/releases', async () => {
    const r = await call('GET', '/api/admin/releases')
    assert(r.ok, '版本管理失败')
    const d = r.json.data
    const list = Array.isArray(d) ? d : d.list || []
    assert(list.length >= 6, `版本记录不足: ${list.length}`)
    return `${list.length} 条版本`
  })

  await check('GET /api/admin/site', async () => {
    const r = await call('GET', '/api/admin/site')
    assert(r.ok, '站点配置失败')
    return `keys=${Object.keys(r.json.data.site || {}).length}`
  })

  await check('GET /api/admin/security', async () => {
    const r = await call('GET', '/api/admin/security')
    assert(r.ok, '安全模块失败')
    return `审计=${(r.json.data.audits || []).length} 登录日志=${(r.json.data.logins || []).length}`
  })

  await check('GET /api/admin/audit', async () => {
    const r = await call('GET', '/api/admin/audit')
    assert(r.ok, '审计日志失败')
    return `${r.json.data.total} 条审计`
  })

  await check('GET /api/admin/oss', async () => {
    const r = await call('GET', '/api/admin/oss?prefix=md/')
    assert(r.ok, 'OSS 浏览失败')
    return `目录=${(r.json.data.dirs || []).length} 文件=${(r.json.data.files || []).length}`
  })

  console.log('\n【清理】')
  await check('POST /api/files/delete', async () => {
    const r = await call('POST', '/api/files/delete', { path: testPath })
    assert(r.ok, '删除失败')
    return '已移入回收站'
  })

  const pass = results.filter((r) => r.pass).length
  const fail = results.length - pass
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`结果：\x1b[32m${pass} 通过\x1b[0m / ${fail ? '\x1b[31m' : ''}${fail} 失败\x1b[0m / 共 ${results.length}`)
  if (fail) {
    console.log('\n失败项：')
    results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`))
    process.exit(1)
  }
  console.log('全部通过 ✓')
}

main().catch((e) => { console.error('测试脚本异常:', e); process.exit(1) })
