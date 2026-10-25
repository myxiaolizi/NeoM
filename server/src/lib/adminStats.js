/**
 * adminStats.js — aggregation layer for the admin dashboard.
 *
 * Everything here is read-only and defensive: the admin console must render even
 * when a table is empty, missing, or the schema drifted, so each query degrades
 * to a zero/[] default instead of throwing.
 *
 * Kept out of routes/admin.js so the numbers used by the dashboard, the stats
 * summary and the OSS browser all come from one place.
 */
import os from 'node:os';
import fs from 'node:fs';
import { q, val, num, int, round2, startOfToday, daysAgo, tableExists } from './aiShared.js';

const zero = (sql, params = []) => val(sql, params, 0).catch(() => 0);
const rowsOf = (sql, params = []) => q(sql, params).catch(() => []);

/** Local-date key (YYYY-MM-DD) for a Date or MySQL date value. */
function dayKey(v) {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v || '').slice(0, 10);
}

function toMap(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const k = dayKey(r.d);
    if (k) m.set(k, num(r.c));
  }
  return m;
}

/* ============================== headline ============================== */

/**
 * Top-line counters for the dashboard cards.
 * Documents = file rows (is_dir=0, not deleted); shares/publishes = active rows.
 */
export async function headline() {
  const dayStart = startOfToday();
  const monthAgo = daysAgo(30);
  const [
    usersToday, usersTotal, dau, mau, docsTotal, sharesTotal, publishTotal,
    rechargeToday, rechargeTotal, aiToday, aiTotal, ossBytes, pointsIssued
  ] = await Promise.all([
    zero('SELECT COUNT(*) FROM users WHERE created_at>=?', [dayStart]),
    zero('SELECT COUNT(*) FROM users'),
    // DAU/MAU are measured on real AI activity plus logins, whichever is richer.
    zero(`SELECT COUNT(DISTINCT user_id) FROM (
            SELECT user_id FROM ai_usage_logs WHERE created_at>=?
            UNION SELECT user_id FROM login_logs WHERE ok=1 AND user_id IS NOT NULL AND created_at>=?
          ) t`, [dayStart, dayStart]),
    zero(`SELECT COUNT(DISTINCT user_id) FROM (
            SELECT user_id FROM ai_usage_logs WHERE created_at>=?
            UNION SELECT user_id FROM login_logs WHERE ok=1 AND user_id IS NOT NULL AND created_at>=?
          ) t`, [monthAgo, monthAgo]),
    zero('SELECT COUNT(*) FROM files WHERE is_dir=0 AND deleted=0'),
    zero("SELECT COUNT(*) FROM share_links WHERE status='active'"),
    zero("SELECT COUNT(*) FROM publish_pages WHERE status='active'"),
    zero("SELECT COALESCE(SUM(amount),0) FROM recharge_orders WHERE status='paid' AND paid_at>=?", [dayStart]),
    zero("SELECT COALESCE(SUM(amount),0) FROM recharge_orders WHERE status='paid'"),
    zero('SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) FROM ai_usage_logs WHERE created_at>=?', [dayStart]),
    zero('SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) FROM ai_usage_logs'),
    zero('SELECT COALESCE(SUM(size),0) FROM files WHERE is_dir=0 AND deleted=0'),
    zero('SELECT COALESCE(SUM(points),0) FROM users')
  ]);

  return {
    usersToday: int(usersToday),
    usersTotal: int(usersTotal),
    dau: int(dau),
    mau: int(mau),
    docsTotal: int(docsTotal),
    sharesTotal: int(sharesTotal),
    publishTotal: int(publishTotal),
    rechargeToday: round2(rechargeToday),
    rechargeTotal: round2(rechargeTotal),
    aiTokensToday: int(aiToday),
    aiTokensTotal: int(aiTotal),
    ossBytes: int(ossBytes),
    pointsIssued: round2(pointsIssued)
  };
}

/* ============================== per model ============================== */

/**
 * Token usage grouped by model, with cache-hit rate.
 * cacheHitRate = cached prompt tokens / all prompt tokens (0 when no tokens).
 */
export async function usageByModel({ days = 0, limit = 20 } = {}) {
  const where = days > 0 ? 'WHERE created_at >= ?' : '';
  const params = days > 0 ? [daysAgo(days - 1)] : [];
  const rows = await rowsOf(
    `SELECT model,
            COUNT(*) AS calls,
            COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
            COALESCE(SUM(cached_tokens),0) AS cached_tokens,
            COALESCE(SUM(completion_tokens),0) AS completion_tokens,
            COALESCE(SUM(points_cost),0) AS points,
            COALESCE(AVG(latency_ms),0) AS avg_latency,
            COALESCE(SUM(status<>'ok'),0) AS errors
       FROM ai_usage_logs ${where}
      GROUP BY model ORDER BY calls DESC LIMIT ?`,
    [...params, int(limit, 20)]
  );
  return rows.map((r) => {
    const prompt = int(r.prompt_tokens);
    const cached = int(r.cached_tokens);
    return {
      model: r.model || '',
      calls: int(r.calls),
      promptTokens: prompt,
      cachedTokens: cached,
      completionTokens: int(r.completion_tokens),
      points: round2(r.points),
      avgLatency: Math.round(num(r.avg_latency)),
      errors: int(r.errors),
      cacheHitRate: prompt ? round2((cached / prompt) * 100) : 0
    };
  });
}

/* ============================== trends ============================== */

/**
 * 14-day series for the dashboard charts.
 *
 * One grouped query per series instead of N-per-day: the database is remote, so
 * 4 queries beat 56 round-trips (this took the dashboard from ~2s to ~100ms).
 */
export async function trend(days = 14) {
  const span = Math.max(1, int(days, 14));
  const since = daysAgo(span - 1);

  const [signupRows, activeRows, rechargeRows, tokenRows, ossRows, trafficRows] = await Promise.all([
    rowsOf('SELECT DATE(created_at) AS d, COUNT(*) AS c FROM users WHERE created_at>=? GROUP BY DATE(created_at)', [since]),
    rowsOf('SELECT DATE(created_at) AS d, COUNT(DISTINCT user_id) AS c FROM ai_usage_logs WHERE created_at>=? GROUP BY DATE(created_at)', [since]),
    rowsOf("SELECT DATE(paid_at) AS d, COALESCE(SUM(amount),0) AS c FROM recharge_orders WHERE status='paid' AND paid_at>=? GROUP BY DATE(paid_at)", [since]),
    rowsOf('SELECT DATE(created_at) AS d, COALESCE(SUM(prompt_tokens+completion_tokens),0) AS c FROM ai_usage_logs WHERE created_at>=? GROUP BY DATE(created_at)', [since]),
    rowsOf('SELECT DATE(ctime) AS d, COALESCE(SUM(size),0) AS c FROM files WHERE is_dir=0 AND deleted=0 AND ctime>=? GROUP BY DATE(ctime)', [since]),
    rowsOf('SELECT DATE(created_at) AS d, COUNT(*) AS c FROM ai_usage_logs WHERE created_at>=? GROUP BY DATE(created_at)', [since])
  ]);

  const signupMap = toMap(signupRows);
  const activeMap = toMap(activeRows);
  const rechargeMap = toMap(rechargeRows);
  const tokenMap = toMap(tokenRows);
  const ossMap = toMap(ossRows);
  const trafficMap = toMap(trafficRows);

  // Cumulative storage: today's total minus everything ingested in the window.
  const totalOss = num(await zero('SELECT COALESCE(SUM(size),0) FROM files WHERE is_dir=0 AND deleted=0'), 0);
  let running = totalOss - [...ossMap.values()].reduce((s, v) => s + v, 0);

  const out = {
    days: span,
    dates: [],
    signups: [],
    active: [],
    recharge: [],
    tokens: [],
    calls: [],
    ossBytes: [],
    ossCumulative: [],
    traffic: []
  };

  for (let i = span - 1; i >= 0; i--) {
    const d = daysAgo(i);
    const k = dayKey(d);
    const added = int(ossMap.get(k) || 0);
    running += added;
    out.dates.push(k.slice(5));
    out.signups.push(int(signupMap.get(k) || 0));
    out.active.push(int(activeMap.get(k) || 0));
    out.recharge.push(round2(rechargeMap.get(k) || 0));
    out.tokens.push(int(tokenMap.get(k) || 0));
    out.calls.push(int(trafficMap.get(k) || 0));
    out.ossBytes.push(added);
    out.ossCumulative.push(Math.max(0, running));
    out.traffic.push(int(trafficMap.get(k) || 0));
  }
  return out;
}

/* ============================== health ============================== */

/** Server health from os.loadavg / memory / disk. */
export function health() {
  const total = os.totalmem();
  const free = os.freemem();
  const load = os.loadavg();
  const h = {
    cpu: {
      cores: os.cpus().length,
      model: (os.cpus()[0] && os.cpus()[0].model) || '',
      load1: round2(load[0]),
      load5: round2(load[1]),
      load15: round2(load[2]),
      // loadavg on Windows is always 0, so also expose raw usage derived from
      // busy time; the UI can fall back to it.
      usedPercent: round2((load[0] / Math.max(1, os.cpus().length)) * 100)
    },
    memory: {
      total,
      free,
      used: total - free,
      usedPercent: round2(((total - free) / total) * 100)
    },
    uptime: Math.round(os.uptime()),
    platform: os.platform(),
    release: os.release(),
    node: process.version,
    process: {
      pid: process.pid,
      // 服务器进程自身内存：比整机数字更能反映泄漏
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      uptime: Math.round(process.uptime())
    }
  };
  try {
    const st = fs.statfsSync('/');
    h.disk = {
      total: st.blocks * st.bsize,
      free: st.bfree * st.bsize,
      usedPercent: st.blocks ? round2((1 - st.bfree / st.blocks) * 100) : 0
    };
  } catch {
    try {
      // Windows: measure the drive hosting the app instead of '/'.
      const st = fs.statfsSync(process.cwd().slice(0, 2) + '\\');
      h.disk = {
        total: st.blocks * st.bsize,
        free: st.bfree * st.bsize,
        usedPercent: st.blocks ? round2((1 - st.bfree / st.blocks) * 100) : 0
      };
    } catch {
      h.disk = null;
    }
  }
  return h;
}

/* ============================== AI health ============================== */

/** Channel pool status + today's error rate, for the dashboard AI panel. */
export async function aiHealth() {
  const [channels, modelsEnabled, modelsTotal, todayCalls, todayErrors, avgLatency] = await Promise.all([
    rowsOf("SELECT id, provider_id, name, status, fail_count, last_error, last_ok_at FROM ai_channels ORDER BY id"),
    zero('SELECT COUNT(*) FROM ai_models WHERE enabled=1'),
    zero('SELECT COUNT(*) FROM ai_models'),
    zero('SELECT COUNT(*) FROM ai_usage_logs WHERE created_at>=?', [startOfToday()]),
    zero("SELECT COUNT(*) FROM ai_usage_logs WHERE created_at>=? AND status<>'ok'", [startOfToday()]),
    zero('SELECT COALESCE(AVG(latency_ms),0) FROM ai_usage_logs WHERE created_at>=?', [startOfToday()])
  ]);
  const healthy = channels.filter((c) => c.status === 'active' && int(c.fail_count) === 0).length;
  return {
    channels: channels.map((c) => ({
      id: int(c.id),
      providerId: c.provider_id,
      name: c.name,
      status: c.status,
      failCount: int(c.fail_count),
      lastError: c.last_error || null,
      lastOkAt: c.last_ok_at
    })),
    channelsHealthy: healthy,
    channelsTotal: channels.length,
    modelsEnabled: int(modelsEnabled),
    modelsTotal: int(modelsTotal),
    callsToday: int(todayCalls),
    errorsToday: int(todayErrors),
    errorRate: int(todayCalls) ? round2((int(todayErrors) / int(todayCalls)) * 100) : 0,
    avgLatencyToday: Math.round(num(avgLatency))
  };
}

/* ============================== summary ============================== */

/** Everything the dashboard needs in one call. */
export async function dashboard() {
  const [stats, models, series, sysHealth, ai] = await Promise.all([
    headline(),
    usageByModel({ days: 30, limit: 20 }),
    trend(14),
    Promise.resolve(health()),
    aiHealth()
  ]);
  return { stats, models, trend: series, health: sysHealth, ai };
}

/** Compact counters for GET /admin/stats. */
export async function summary() {
  const [users, files, shares, publishes, plugins, releases, aiCalls, points] = await Promise.all([
    zero('SELECT COUNT(*) FROM users'),
    zero('SELECT COUNT(*) FROM files WHERE deleted=0'),
    zero('SELECT COUNT(*) FROM share_links'),
    zero('SELECT COUNT(*) FROM publish_pages'),
    zero('SELECT COUNT(*) FROM plugins'),
    zero('SELECT COUNT(*) FROM releases'),
    zero('SELECT COUNT(*) FROM ai_usage_logs'),
    zero('SELECT COALESCE(SUM(points),0) FROM users')
  ]);
  return {
    users: int(users),
    files: int(files),
    shares: int(shares),
    publishes: int(publishes),
    plugins: int(plugins),
    releases: int(releases),
    aiCalls: int(aiCalls),
    pointsTotal: round2(points)
  };
}

export default { headline, usageByModel, trend, health, aiHealth, dashboard, summary };
