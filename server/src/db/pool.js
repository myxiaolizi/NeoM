/**
 * mysql2 connection pool. Single shared pool for the whole process.
 * Env: DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_POOL
 */
import mysql from 'mysql2/promise';
import { SERVER_ROOT } from '../lib/util.js';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'neom',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'local',
  dateStrings: false,
  decimalNumbers: true,
  multipleStatements: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

/** query(sql, params) -> [rows, fields] */
export const query = (sql, params = []) => pool.query(sql, params);
export const execute = (sql, params = []) => pool.execute(sql, params);
export const getPool = () => pool;

/** Run fn(conn) inside a transaction; commits on resolve, rolls back on throw. */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** One-row helper: first row or null. */
export async function one(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows && rows[0] ? rows[0] : null;
}

export async function ping() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows?.[0]?.ok === 1;
}

export async function closePool() {
  await pool.end();
}

export { SERVER_ROOT };
export default pool;
