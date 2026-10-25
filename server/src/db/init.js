#!/usr/bin/env node
/**
 * DB initializer: executes sql/001_schema.sql, sql/002_seed.sql, sql/003_defaults.sql.
 *
 *   node src/db/init.js              # schema + seed + defaults (skip seed if already seeded unless --force)
 *   node src/db/init.js schema       # only schema
 *   node src/db/init.js seed         # only seed
 *   node src/db/init.js defaults     # only defaults
 *   node src/db/init.js all --force  # everything, re-run seed/defaults
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { SERVER_ROOT } from '../lib/util.js';

const SQL_DIR = path.join(SERVER_ROOT, 'sql');
const FILES = { schema: '001_schema.sql', seed: '002_seed.sql', defaults: '003_defaults.sql' };

async function runFile(conn, name) {
  const file = path.join(SQL_DIR, name);
  let sql;
  try {
    sql = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  } catch {
    console.log(`  - ${name}: 文件不存在，跳过`);
    return false;
  }
  const t0 = Date.now();
  await conn.query(sql);
  console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const which = args.filter((a) => !a.startsWith('--'));
  const targets = !which.length || which.includes('all') ? ['schema', 'seed', 'defaults'] : which;

  const cfg = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'neom',
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci'
  };
  console.log(`[init] ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  const conn = await mysql.createConnection(cfg);
  try {
    for (const t of targets) {
      if (!FILES[t]) {
        console.log(`  ! 未知目标 ${t}`);
        continue;
      }
      if (t !== 'schema' && !force) {
        // idempotent guard: skip seeding when users already exist
        try {
          const [rows] = await conn.query('SELECT COUNT(*) AS c FROM users');
          if (Number(rows[0].c) > 0) {
            console.log(`  - ${FILES[t]}: users 已有 ${rows[0].c} 行，跳过（--force 可强制重跑）`);
            continue;
          }
        } catch {
          /* table missing -> run the file */
        }
      }
      await runFile(conn, FILES[t]);
    }

    const [tables] = await conn.query(
      "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE'",
      [cfg.database]
    );
    const [users] = await conn.query('SELECT COUNT(*) AS c FROM users').catch(() => [[{ c: 0 }]]);
    const [plugins] = await conn.query('SELECT COUNT(*) AS c FROM plugins').catch(() => [[{ c: 0 }]]);
    const [models] = await conn.query('SELECT COUNT(*) AS c FROM ai_models').catch(() => [[{ c: 0 }]]);
    console.log(`[init] done — tables=${tables[0].c} users=${users[0].c} plugins=${plugins[0].c} models=${models[0].c}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('[init] FAILED:', e.code || '', e.message);
  if (e.sqlMessage) console.error('  sql:', e.sqlMessage);
  process.exit(1);
});
