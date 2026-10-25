/**
 * End-to-end self test for server-core endpoints.
 *   node _selftest.mjs [baseUrl]
 * Prints PASS/FAIL per case and exits non-zero on failure.
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3311';
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function api(method, path, { body, token, raw = false, headers = {} } = {}) {
  const opt = { method, headers: { ...headers } };
  if (token) opt.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opt);
  if (raw) return { res, text: await res.text() };
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    return { res, text: await res.text(), json: null };
  }
  return { res, json: await res.json() };
}

const uniq = Date.now().toString(36);

async function main() {
  console.log(`\n=== NeoM server-core self test @ ${BASE} ===\n`);

  /* ------------------------------- health -------------------------------- */
  console.log('[health]');
  {
    const { res, json } = await api('GET', '/api/health');
    ok('GET /api/health 200', res.status === 200, `status=${res.status}`);
    ok('health.status === true', json?.status === true);
    ok('health.data.db === true', json?.data?.db === true);
    ok('health mounted routers >= 9', (json?.data?.mounted || []).length >= 9, (json?.data?.mounted || []).join(','));
  }

  /* -------------------------------- site --------------------------------- */
  console.log('[site]');
  {
    const { res, json } = await api('GET', '/api/site/config');
    ok('GET /api/site/config', res.status === 200 && json?.status === true);
    ok('site.config has site_name', json?.data?.site_name === 'NeoM', json?.data?.site_name);
    ok('site.config features = 6 cards', Array.isArray(json?.data?.features) && json.data.features.length === 6, `${json?.data?.features?.length}`);
    const d = await api('GET', '/api/site/docs?key=terms');
    ok('GET /api/site/docs?key=terms', d.res.status === 200 && String(d.json?.data?.content || '').length > 100);
    const d2 = await api('GET', '/api/site/docs?key=privacy');
    ok('GET /api/site/docs?key=privacy', d2.res.status === 200 && String(d2.json?.data?.content || '').length > 100);
    const badKey = await api('GET', '/api/site/docs?key=../../etc');
    ok('site docs rejects traversal key', badKey.res.status === 400, `status=${badKey.res.status}`);
    const a = await api('GET', '/api/site/announcement');
    ok('GET /api/site/announcement', a.res.status === 200 && typeof a.json?.data?.announcement === 'string');
  }

  /* ------------------------------ bootstrap ------------------------------ */
  console.log('[bootstrap]');
  {
    const { res, json } = await api('GET', '/api/bootstrap');
    ok('GET /api/bootstrap 200', res.status === 200 && json?.status === true);
    ok('bootstrap.plugins = 25', json?.data?.plugins?.length === 25, `${json?.data?.plugins?.length}`);
    ok('bootstrap.models = 7', json?.data?.models?.length === 7, `${json?.data?.models?.length}`);
    ok('bootstrap.providers >= 9', (json?.data?.providers || []).length >= 9, `${json?.data?.providers?.length}`);
    ok('bootstrap.releases 6 platforms', (json?.data?.releases || []).length === 6, `${json?.data?.releases?.length}`);
    ok('bootstrap.site present', Boolean(json?.data?.site?.site_name));
  }

  /* ------------------------------- releases ------------------------------ */
  console.log('[releases]');
  let firstRelease = null;
  {
    const { res, json } = await api('GET', '/api/releases');
    ok('GET /api/releases', res.status === 200 && json?.status === true);
    ok('releases.platforms = 6', (json?.data?.platforms || []).length === 6, `${json?.data?.platforms?.length}`);
    const win = (json?.data?.platforms || []).find((p) => p.platform === 'win-x64');
    ok('win-x64 latest 1.0.0 with url', win?.latest?.version === '1.0.0' && String(win?.latest?.url).startsWith('https://mdadmin.zhengl.vip/'), win?.latest?.url);
    firstRelease = win?.latest;
    const chk = await api('GET', '/api/releases/check?platform=win-x64&version=0.9.0');
    ok('check 0.9.0 -> hasUpdate true', chk.json?.data?.hasUpdate === true);
    const chk2 = await api('GET', '/api/releases/check?platform=win-x64&version=1.0.0');
    ok('check 1.0.0 -> hasUpdate false', chk2.json?.data?.hasUpdate === false);
    const chk3 = await api('GET', '/api/releases/check?platform=linux-x64&version=1.0.0');
    ok('check unknown platform -> hasUpdate false', chk3.json?.data?.hasUpdate === false);
    const dl = await fetch(`${BASE}/api/releases/${firstRelease.id}/download`, { redirect: 'manual' });
    ok('GET /api/releases/:id/download 302', dl.status === 302, `status=${dl.status}`);
  }

  /* -------------------------------- auth -------------------------------- */
  console.log('[auth]');
  let adminToken = null;
  let userToken = null;
  let username = `t_${uniq}`;
  {
    const login = await api('POST', '/api/auth/login', { body: { account: 'admin', password: 'NeoM@2026' } });
    ok('POST /api/auth/login (admin)', login.res.status === 200 && login.json?.status === true, login.json?.msg);
    ok('admin role = admin', login.json?.data?.user?.role === 'admin');
    ok('admin points = 100000', Number(login.json?.data?.user?.points) === 100000, `${login.json?.data?.user?.points}`);
    ok('login returns token + refreshToken', Boolean(login.json?.data?.token) && Boolean(login.json?.data?.refreshToken));
    adminToken = login.json?.data?.token;

    const bad = await api('POST', '/api/auth/login', { body: { account: 'admin', password: 'wrong' } });
    ok('login wrong password -> 401', bad.res.status === 401 && bad.json?.status === false);

    const reg = await api('POST', '/api/auth/register', { body: { username, password: 'test123456', email: `${username}@t.vip` } });
    ok('POST /api/auth/register', reg.res.status === 200 && reg.json?.status === true, reg.json?.msg);
    ok('register gift = 100 points', Number(reg.json?.data?.user?.points) === 100, `${reg.json?.data?.user?.points}`);
    userToken = reg.json?.data?.token;

    const dup = await api('POST', '/api/auth/register', { body: { username, password: 'test123456' } });
    ok('duplicate username -> 400', dup.res.status === 400);

    const me = await api('GET', '/api/auth/me', { token: userToken });
    ok('GET /api/auth/me', me.res.status === 200 && me.json?.data?.username === username);

    const noTok = await api('GET', '/api/auth/me');
    ok('GET /api/auth/me without token -> 401', noTok.res.status === 401);

    const prof = await api('POST', '/api/auth/profile', { token: userToken, body: { nickname: '测试昵称', avatar: '' } });
    ok('POST /api/auth/profile', prof.res.status === 200 && prof.json?.data?.nickname === '测试昵称');

    const pwd = await api('POST', '/api/auth/password', { token: userToken, body: { old: 'test123456', new: 'test654321' } });
    ok('POST /api/auth/password', pwd.res.status === 200, pwd.json?.msg);

    const relogin = await api('POST', '/api/auth/login', { body: { account: username, password: 'test654321' } });
    ok('login with new password', relogin.res.status === 200);
    userToken = relogin.json?.data?.token;

    const sess = await api('GET', '/api/auth/sessions', { token: userToken });
    ok('GET /api/auth/sessions', sess.res.status === 200 && Array.isArray(sess.json?.data?.sessions));

    const refresh = await api('POST', '/api/auth/refresh', { body: { refreshToken: relogin.json?.data?.refreshToken } });
    ok('POST /api/auth/refresh', refresh.res.status === 200 && Boolean(refresh.json?.data?.token));

    const bind = await api('POST', '/api/auth/bind', { token: userToken, body: { phone: '13900000001' } });
    ok('POST /api/auth/bind', bind.res.status === 200 || bind.json?.code === 'TAKEN', bind.json?.msg);

    const banned = await api('POST', '/api/auth/logout', { token: userToken });
    ok('POST /api/auth/logout', banned.res.status === 200);
  }

  /* -------------------------------- files -------------------------------- */
  console.log('[files]');
  let etag1 = null;
  const p1 = `selftest/${uniq}.md`;
  {
    const w = await api('POST', '/api/files/write', { token: userToken, body: { path: p1, content: '# 自测标题\n\n第一行 hello world\n#测试标签\n' } });
    ok('POST /api/files/write (create)', w.res.status === 200 && w.json?.data?.etag, w.json?.msg);
    etag1 = w.json?.data?.etag;
    ok('write returns version 1', Number(w.json?.data?.version) === 1, `${w.json?.data?.version}`);

    const r = await api('GET', `/api/files/read?path=${encodeURIComponent(p1)}`, { token: userToken });
    ok('GET /api/files/read', r.res.status === 200 && r.json?.data?.content.includes('hello world'));
    ok('read etag matches write etag', r.json?.data?.etag === etag1);

    const tree = await api('GET', '/api/files/tree', { token: userToken });
    ok('GET /api/files/tree', tree.res.status === 200 && Array.isArray(tree.json?.data));
    ok('tree contains written file', (tree.json?.data || []).some((n) => n.path === p1), `${tree.json?.data?.length} nodes`);

    const conflict = await api('POST', '/api/files/write', { token: userToken, body: { path: p1, content: 'conflicting', baseEtag: 'deadbeefdeadbeefdeadbeefdeadbeef' } });
    ok('write stale baseEtag -> 409 CONFLICT', conflict.res.status === 409 && conflict.json?.code === 'CONFLICT', `status=${conflict.res.status}`);
    ok('conflict payload has remote.content/etag/mtime', Boolean(conflict.json?.data?.remote?.content) && Boolean(conflict.json?.data?.remote?.etag));

    const w2 = await api('POST', '/api/files/write', { token: userToken, body: { path: p1, content: '# 自测标题\n\n第二版 hello world\n#测试标签\n', baseEtag: etag1 } });
    ok('write matching baseEtag -> 200', w2.res.status === 200, w2.json?.msg);
    ok('version increments to 2', Number(w2.json?.data?.version) === 2, `${w2.json?.data?.version}`);

    const naming = await api('POST', '/api/files/write', {
      token: userToken,
      body: { path: `selftest/naming-${uniq}.md`, content: '# 命名测试标题\n\n正文', naming: 'template' }
    });
    ok('write naming=template renames', naming.json?.data?.renamed === true, naming.json?.data?.path);
    ok('naming template format YY年MM月DD日HHMM-【title】', /^\d{2}年\d{2}月\d{2}日\d{4}-【命名测试标题】\.md$/.test(String(naming.json?.data?.name)), naming.json?.data?.name);

    const mk = await api('POST', '/api/files/mkdir', { token: userToken, body: { path: `selftest/dir-${uniq}` } });
    ok('POST /api/files/mkdir', mk.res.status === 200);

    const mv = await api('POST', '/api/files/move', { token: userToken, body: { from: p1, to: `selftest/dir-${uniq}/moved.md` } });
    ok('POST /api/files/move', mv.res.status === 200 && mv.json?.data?.moved === true, mv.json?.msg);

    const cp = await api('POST', '/api/files/copy', { token: userToken, body: { from: `selftest/dir-${uniq}/moved.md` } });
    ok('POST /api/files/copy', cp.res.status === 200 && cp.json?.data?.copied === 1, cp.json?.data?.to);

    const rn = await api('POST', '/api/files/rename', { token: userToken, body: { from: `selftest/dir-${uniq}/moved.md`, to: `selftest/dir-${uniq}/renamed.md` } });
    ok('POST /api/files/rename', rn.res.status === 200, rn.json?.msg);

    const trav = await api('GET', `/api/files/read?path=${encodeURIComponent('../../etc/passwd')}`, { token: userToken });
    ok('read rejects path traversal -> 400', trav.res.status === 400 && trav.json?.code === 'BAD_PATH', `status=${trav.res.status}`);

    const trav2 = await api('POST', '/api/files/write', { token: userToken, body: { path: 'C:\\Windows\\x.md', content: 'x' } });
    ok('write rejects absolute windows path', trav2.res.status === 400);

    const abs = await api('POST', '/api/files/write', { token: userToken, body: { path: '/etc/x.md', content: 'x' } });
    ok('write rejects absolute posix path', abs.res.status === 400);

    const bs = await api('POST', '/api/files/create', { token: userToken, body: { dir: `selftest/dir-${uniq}` } });
    ok('POST /api/files/create auto name', bs.res.status === 200 && /\.md$/.test(bs.json?.data?.name || ''), bs.json?.data?.name);

    const s1 = await api('GET', `/api/files/search?q=hello&scope=content`, { token: userToken });
    ok('GET /api/files/search content', s1.res.status === 200 && (s1.json?.data?.hits || []).length >= 1, `${s1.json?.data?.hits?.length} hits`);
    const s2 = await api('GET', `/api/files/search?q=测试标签&scope=tag`, { token: userToken });
    ok('GET /api/files/search tag', s2.res.status === 200, `${s2.json?.data?.hits?.length} hits`);
    const s3 = await api('GET', `/api/files/search?q=selftest&scope=name`, { token: userToken });
    ok('GET /api/files/search name', s3.res.status === 200, `${s3.json?.data?.hits?.length} hits`);
    const s4 = await api('GET', `/api/files/search?q=hello&scope=all`, { token: userToken });
    ok('GET /api/files/search all', s4.res.status === 200);

    const rec = await api('GET', '/api/files/recent?limit=5', { token: userToken });
    ok('GET /api/files/recent', rec.res.status === 200 && Array.isArray(rec.json?.data));

    const sort = await api('POST', '/api/files/sort', { token: userToken, body: { orders: [{ path: `selftest/dir-${uniq}/renamed.md`, order: 5 }] } });
    ok('POST /api/files/sort', sort.res.status === 200 && sort.json?.data?.updated === 1);

    const cf = await api('GET', `/api/files/conflict?path=${encodeURIComponent(`selftest/dir-${uniq}/renamed.md`)}`, { token: userToken });
    ok('GET /api/files/conflict', cf.res.status === 200 && Boolean(cf.json?.data?.remote?.etag));

    const sync = await api('POST', '/api/files/sync', { token: userToken });
    ok('POST /api/files/sync', sync.res.status === 200 && sync.json?.data, `added=${sync.json?.data?.added?.length} updated=${sync.json?.data?.updated?.length}`);

    const st = await api('GET', '/api/files/stats', { token: userToken });
    ok('GET /api/files/stats', st.res.status === 200 && Number(st.json?.data?.files) >= 2, `files=${st.json?.data?.files}`);
  }

  /* -------------------------------- export ------------------------------- */
  console.log('[export]');
  {
    const target = `selftest/dir-${uniq}/renamed.md`;
    const md = await api('POST', '/api/files/export', { token: userToken, body: { path: target, format: 'md' }, raw: true });
    ok('export md text/markdown', md.res.status === 200 && (md.res.headers.get('content-type') || '').includes('markdown'));
    const html = await api('POST', '/api/files/export', { token: userToken, body: { path: target, format: 'html' }, raw: true });
    ok('export html contains <article>', html.res.status === 200 && html.text.includes('neom-doc'));
    const docx = await fetch(`${BASE}/api/files/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ path: target, format: 'docx' })
    });
    const buf = Buffer.from(await docx.arrayBuffer());
    ok('export docx is a zip (PK)', docx.status === 200 && buf[0] === 0x50 && buf[1] === 0x4b, `${buf.length} bytes`);
    const pdf = await api('POST', '/api/files/export', { token: userToken, body: { path: target, format: 'pdf' } });
    ok('export pdf -> {fallback:"html"}', pdf.json?.data?.fallback === 'html' && String(pdf.json?.data?.html).includes('<!DOCTYPE html>'));
    const badFmt = await api('POST', '/api/files/export', { token: userToken, body: { path: target, format: 'xls' } });
    ok('export unsupported -> 400', badFmt.res.status === 400);
  }

  /* ------------------------------- versions ------------------------------ */
  console.log('[versions]');
  let versionId = null;
  {
    // dedicated doc so move/rename earlier in this run cannot shadow history
    const target = `selftest/ver-${uniq}.md`;
    const w1 = await api('POST', '/api/files/write', { token: userToken, body: { path: target, content: 'version one content\n' } });
    const w2 = await api('POST', '/api/files/write', { token: userToken, body: { path: target, content: 'version two content changed\n', baseEtag: w1.json?.data?.etag } });
    ok('second write creates a version', w2.res.status === 200);

    const list = await api('GET', `/api/versions/list?path=${encodeURIComponent(target)}&limit=20`, { token: userToken });
    ok('GET /api/versions/list', list.res.status === 200 && (list.json?.data?.versions || []).length >= 1, `${list.json?.data?.versions?.length} versions`);
    versionId = list.json?.data?.versions?.[0]?.id;
    ok('version meta shape', Boolean(list.json?.data?.versions?.[0]?.created_at) && Boolean(list.json?.data?.versions?.[0]?.reason));

    const rd = await api('GET', `/api/versions/read?id=${versionId}`, { token: userToken });
    ok('GET /api/versions/read', rd.res.status === 200 && typeof rd.json?.data?.content === 'string');
    ok('version content is the OLD body', String(rd.json?.data?.content).includes('version one'), String(rd.json?.data?.content).slice(0, 30));

    const snap = await api('POST', '/api/versions/snapshot', { token: userToken, body: { path: target, content: 'snapshot content', reason: 'snapshot' } });
    ok('POST /api/versions/snapshot', snap.res.status === 200 && Boolean(snap.json?.data?.id));

    const diff2 = await api('GET', `/api/versions/diff?b=${versionId}&path=${encodeURIComponent(target)}`, { token: userToken });
    ok('GET /api/versions/diff (current vs version)', diff2.res.status === 200 && typeof diff2.json?.data?.left === 'string' && typeof diff2.json?.data?.right === 'string');
    ok('diff returns ops + unified', Array.isArray(diff2.json?.data?.ops) && String(diff2.json?.data?.unified).includes('@@'), `${diff2.json?.data?.ops?.length} ops`);

    const restore = await api('POST', '/api/versions/restore', { token: userToken, body: { id: versionId } });
    ok('POST /api/versions/restore', restore.res.status === 200, restore.json?.msg);
    const back = await api('GET', `/api/files/read?path=${encodeURIComponent(target)}`, { token: userToken });
    ok('restore rewrote content', String(back.json?.data?.content).includes('version one'));
  }

  /* -------------------------------- share -------------------------------- */
  console.log('[share/publish]');
  let shareId = null;
  let pubId = null;
  {
    const target = `selftest/dir-${uniq}/renamed.md`;
    const cr = await api('POST', '/api/share/create', { token: userToken, body: { path: target, mode: 'comment' } });
    ok('POST /api/share/create', cr.res.status === 200 && Boolean(cr.json?.data?.id), cr.json?.msg);
    shareId = cr.json?.data?.id;
    ok('share url shape', String(cr.json?.data?.url).includes(`/s/${shareId}`), cr.json?.data?.url);

    const lst = await api('GET', '/api/share/list', { token: userToken });
    ok('GET /api/share/list', lst.res.status === 200 && lst.json?.data?.length >= 1);

    const pub = await api('GET', `/api/share/get?id=${shareId}`);
    ok('GET /api/share/get (no auth)', pub.res.status === 200 && pub.json?.data?.doc?.content.length > 0, pub.json?.msg);
    ok('share/get mode = comment', pub.json?.data?.mode === 'comment');

    const cm = await api('POST', '/api/share/comment', { body: { id: shareId, content: '这是一条自测评论', author: '路人甲' } });
    ok('POST /api/share/comment (no auth)', cm.res.status === 200 && cm.json?.data?.author === '路人甲', cm.json?.msg);

    const sens = await api('POST', '/api/share/comment', { body: { id: shareId, content: '这里有赌博内容' } });
    ok('comment sensitive word blocked', sens.res.status === 400 && sens.json?.code === 'SENSITIVE', `status=${sens.res.status}`);

    const after = await api('GET', `/api/share/get?id=${shareId}`);
    ok('share/get returns comments', (after.json?.data?.comments || []).length >= 1, `${after.json?.data?.comments?.length}`);

    const page = await api('GET', `/s/${shareId}`, { raw: true });
    ok('GET /s/:id renders HTML', page.res.status === 200 && page.text.includes('neom-comments') && page.text.includes('这是一条自测评论'), `status=${page.res.status}`);

    const pcr = await api('POST', '/api/publish/create', { token: userToken, body: { path: target, encrypted: true, password: 'pw123456' } });
    ok('POST /api/publish/create encrypted', pcr.res.status === 200 && pcr.json?.data?.encrypted === true);
    pubId = pcr.json?.data?.id;

    const plist = await api('GET', '/api/publish/list', { token: userToken });
    ok('GET /api/publish/list', plist.res.status === 200 && plist.json?.data?.length >= 1);

    const gate = await api('GET', `/p/${pubId}`, { raw: true });
    ok('GET /p/:id without pwd -> 401 password form', gate.res.status === 401 && gate.text.includes('需要密码'), `status=${gate.res.status}`);
    const opened = await api('GET', `/p/${pubId}?pwd=pw123456`, { raw: true });
    ok('GET /p/:id with pwd -> 200 HTML', opened.res.status === 200 && opened.text.includes('neom-doc'), `status=${opened.res.status}`);

    const rev = await api('POST', '/api/share/revoke', { token: userToken, body: { id: shareId } });
    ok('POST /api/share/revoke', rev.res.status === 200);
    const blocked = await api('GET', `/api/share/get?id=${shareId}`);
    ok('revoked share -> 403', blocked.res.status === 403, `status=${blocked.res.status}`);
    const revPub = await api('POST', '/api/publish/revoke', { token: userToken, body: { id: pubId } });
    ok('POST /api/publish/revoke', revPub.res.status === 200);
    const gone = await api('GET', `/p/${pubId}`, { raw: true });
    ok('revoked publish -> 404', gone.res.status === 404, `status=${gone.res.status}`);
    const missing = await api('GET', '/s/doesnotexist', { raw: true });
    ok('unknown share -> 404 page', missing.res.status === 404, `status=${missing.res.status}`);
  }

  /* -------------------------------- storage ------------------------------ */
  console.log('[storage]');
  {
    const st = await api('GET', '/api/storage/settings', { token: userToken });
    ok('GET /api/storage/settings', st.res.status === 200 && st.json?.status === true);
    ok('settings never returns sk plaintext', !/OSS_?SK\s*[:=]\s*\S{20,}/i.test(JSON.stringify(st.json?.data || {})) && !('accessKeySecret' in (st.json?.data || {})));

    const test = await api('POST', '/api/storage/test', { token: userToken, body: {} });
    ok('POST /api/storage/test real probe ok', test.res.status === 200 && test.json?.data?.ok === true, test.json?.data?.msg);

    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('# 上传测试\n附件内容')], { type: 'text/markdown' }), 'upload-test.md');
    fd.append('kind', 'tupian');
    const up = await api('POST', '/api/storage/upload', { token: userToken, body: fd });
    ok('POST /api/storage/upload', up.res.status === 200 && Boolean(up.json?.data?.key), up.json?.msg);
    ok('upload key follows md/user/<username>/tupian', String(up.json?.data?.key || '').startsWith(`md/user/${username}/tupian/`), up.json?.data?.key);
    ok('upload returns signed url', String(up.json?.data?.url || '').includes('Signature=') || String(up.json?.data?.url || '').includes('OSSAccessKeyId'), String(up.json?.data?.url || '').slice(0, 90));

    const sign = await api('POST', '/api/storage/sign', { token: userToken, body: { key: up.json?.data?.key } });
    ok('POST /api/storage/sign', sign.res.status === 200 && Boolean(sign.json?.data?.url));

    const foreign = await api('POST', '/api/storage/sign', { token: userToken, body: { key: 'md/user/someoneelse/x.md' } });
    ok('sign foreign key -> 403', foreign.res.status === 403, `status=${foreign.res.status}`);

    const badKind = new FormData();
    badKind.append('file', new Blob([Buffer.from('x')]), 'a.txt');
    badKind.append('kind', '../etc');
    const bk = await api('POST', '/api/storage/upload', { token: userToken, body: badKind });
    ok('upload bad kind -> 400', bk.res.status === 400);
  }

  /* -------------------------------- plugins ------------------------------ */
  console.log('[plugins]');
  {
    const store = await api('GET', '/api/plugins/store');
    ok('GET /api/plugins/store published', store.res.status === 200 && store.json?.data?.plugins?.length >= 24, `${store.json?.data?.plugins?.length}`);
    ok('store contains ai plugin (25th)', (store.json?.data?.plugins || []).some((p) => p.id === 'ai'));
    const filt = await api('GET', '/api/plugins/store?category=AI');
    ok('store filter by category', filt.res.status === 200 && (filt.json?.data?.plugins || []).length >= 1, `${filt.json?.data?.plugins?.length}`);
    const q = await api('GET', '/api/plugins/store?q=图谱');
    ok('store search q', q.res.status === 200 && (q.json?.data?.plugins || []).length >= 1);

    const man = await api('GET', '/api/plugins/manifest');
    ok('GET /api/plugins/manifest = 25', man.json?.data?.manifests?.length === 25, `${man.json?.data?.manifests?.length}`);
    const canvas = (man.json?.data?.manifests || []).find((m) => m.id === 'canvas');
    ok('manifest has contributes.commands with plugin.<id>.* ids', (canvas?.contributes?.commands || []).every((c) => c.id.startsWith('plugin.canvas.')), JSON.stringify(canvas?.contributes?.commands));

    const inst = await api('POST', '/api/plugins/install', { token: userToken, body: { id: 'graph' } });
    ok('POST /api/plugins/install', inst.res.status === 200 && inst.json?.data?.enabled === true, inst.json?.msg);
    const mine = await api('GET', '/api/plugins/installed', { token: userToken });
    ok('GET /api/plugins/installed', mine.res.status === 200 && (mine.json?.data || []).some((p) => p.id === 'graph'));
    ok('installed entry has manifest', Boolean((mine.json?.data || []).find((p) => p.id === 'graph')?.manifest?.name));

    const tog = await api('POST', '/api/plugins/toggle', { token: userToken, body: { id: 'graph', enabled: false } });
    ok('POST /api/plugins/toggle off', tog.res.status === 200 && tog.json?.data?.enabled === false);

    const upd = await api('POST', '/api/plugins/update', { token: userToken, body: { id: 'graph' } });
    ok('POST /api/plugins/update', upd.res.status === 200 && Boolean(upd.json?.data?.version));

    const un = await api('POST', '/api/plugins/uninstall', { token: userToken, body: { id: 'graph' } });
    ok('POST /api/plugins/uninstall', un.res.status === 200, un.json?.msg);

    // build a tiny zip in memory to test upload validation
    const JSZip = (await import('jszip')).default;
    const good = new JSZip();
    good.file(
      'manifest.json',
      JSON.stringify({
        id: `selftest-plugin-${uniq}`,
        name: '自测插件',
        version: '1.0.0',
        minAppVersion: '1.0.0',
        description: '自测用',
        author: 'tester',
        category: 'productivity',
        icon: 'sparkles',
        entry: 'index.js',
        permissions: ['files:read'],
        defaultEnabled: false,
        contributes: { ribbon: true, commands: [{ id: `plugin.selftest-${uniq}.hello`, name: '打招呼' }] }
      })
    );
    good.file('index.js', 'export default { onload(app){ app.toast("hi") } }');
    const goodBuf = await good.generateAsync({ type: 'nodebuffer' });
    const f1 = new FormData();
    f1.append('file', new Blob([goodBuf], { type: 'application/zip' }), 'plugin.zip');
    const upl = await api('POST', '/api/plugins/upload', { token: userToken, body: f1 });
    ok('POST /api/plugins/upload valid zip', upl.res.status === 200 && upl.json?.data?.manifest?.id === `selftest-plugin-${uniq}`, upl.json?.msg);
    ok('uploaded plugin marked pending', upl.json?.data?.status === 'pending');

    const evil = new JSZip();
    evil.file('manifest.json', JSON.stringify({ id: 'evil', name: 'e', version: '1.0.0', description: 'd', author: 'a', category: 'core' }));
    evil.file('../../evil.txt', 'pwned');
    const evilBuf = await evil.generateAsync({ type: 'nodebuffer' });
    const f2 = new FormData();
    f2.append('file', new Blob([evilBuf], { type: 'application/zip' }), 'evil.zip');
    const tz = await api('POST', '/api/plugins/upload', { token: userToken, body: f2 });
    ok('upload zip with ../ rejected', tz.res.status === 400 && tz.json?.code === 'ZIP_TRAVERSAL', `${tz.res.status} ${tz.json?.code}`);

    const noMan = new JSZip();
    noMan.file('index.js', 'x');
    const nmBuf = await noMan.generateAsync({ type: 'nodebuffer' });
    const f3 = new FormData();
    f3.append('file', new Blob([nmBuf], { type: 'application/zip' }), 'noman.zip');
    const nm = await api('POST', '/api/plugins/upload', { token: userToken, body: f3 });
    ok('upload zip without manifest -> 400', nm.res.status === 400 && nm.json?.code === 'NO_MANIFEST', `${nm.res.status} ${nm.json?.code}`);

    const notZip = new FormData();
    notZip.append('file', new Blob([Buffer.from('not a zip')]), 'x.zip');
    const nz = await api('POST', '/api/plugins/upload', { token: userToken, body: notZip });
    ok('upload non-zip -> 400', nz.res.status === 400, `${nz.res.status} ${nz.json?.code}`);
  }

  /* ------------------------------ admin guard ---------------------------- */
  console.log('[authz]');
  {
    const r = await api('GET', '/api/files/tree');
    ok('files/tree without token -> 401', r.res.status === 401);
    const r2 = await api('GET', '/api/plugins/installed');
    ok('plugins/installed without token -> 401', r2.res.status === 401);
    const r3 = await api('GET', '/api/plugins/store');
    ok('plugins/store is public', r3.res.status === 200);
  }

  /* ------------------------------ cleanup bin ---------------------------- */
  console.log('[recycle bin]');
  {
    const target = `selftest/dir-${uniq}/renamed.md`;
    const del = await api('POST', '/api/files/delete', { token: userToken, body: { path: target } });
    ok('POST /api/files/delete (soft)', del.res.status === 200 && del.json?.data?.deleted === 1, del.json?.msg);
    const gone = await api('GET', `/api/files/read?path=${encodeURIComponent(target)}`, { token: userToken });
    ok('deleted file no longer readable -> 404', gone.res.status === 404, `status=${gone.res.status}`);
    const bin = await api('GET', '/api/files/recycle', { token: userToken });
    ok('GET /api/files/recycle', bin.res.status === 200 && bin.json?.data?.length >= 1, `${bin.json?.data?.length} items`);
    const snapId = bin.json?.data?.[0]?.id;
    const restore = await api('POST', '/api/files/restore', { token: userToken, body: { id: snapId } });
    ok('POST /api/files/restore', restore.res.status === 200 && restore.json?.data?.restored >= 1, restore.json?.msg);
    const back = await api('GET', `/api/files/read?path=${encodeURIComponent(target)}`, { token: userToken });
    ok('restored file readable again', back.res.status === 200, `status=${back.res.status}`);
    const purge = await api('POST', '/api/files/delete', { token: userToken, body: { id: snapId } });
    ok('purge from recycle bin', purge.res.status === 200 && purge.json?.data?.purged === true);
  }

  /* --------------------------------- 404 -------------------------------- */
  {
    const nf = await api('GET', '/api/does-not-exist');
    ok('unknown /api path -> 404', nf.res.status === 404);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail) {
    console.log('failures:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('SELFTEST CRASHED:', e);
  process.exitCode = 1;
});
