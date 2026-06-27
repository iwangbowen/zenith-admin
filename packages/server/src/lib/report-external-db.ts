/**
 * 报表外部数据库取数 —— MySQL / 外部 PostgreSQL 只读查询。
 * - 连接按 (type+host+port+db+user) 缓存复用，空闲超时回收。
 * - 仅允许只读 SELECT/WITH，自动包裹 LIMIT，statement 超时保护。
 * - 凭据（password）在数据源 config 中以 AES-GCM 密文存储，运行时解密。
 */
import postgres from 'postgres';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import { HTTPException } from 'hono/http-exception';
import { decryptField } from './encryption';
import type { ReportDatasourceType, ReportExternalDbConfig, ReportDataResult } from '@zenith/shared';

const QUERY_TIMEOUT_MS = 15_000;
const MAX_ROWS = 5000;
const IDLE_TTL_MS = 5 * 60_000;

interface PgPoolEntry { kind: 'pg'; sql: ReturnType<typeof postgres>; expire: number }
interface MyPoolEntry { kind: 'mysql'; pool: mysql.Pool; expire: number }
interface MssqlPoolEntry { kind: 'mssql'; pool: mssql.ConnectionPool; expire: number }
type PoolEntry = PgPoolEntry | MyPoolEntry | MssqlPoolEntry;

const pools = new Map<string, PoolEntry>();

function poolKey(type: ReportDatasourceType, c: ReportExternalDbConfig): string {
  return `${type}://${c.user}@${c.host}:${c.port}/${c.database}:${c.ssl ? 1 : 0}`;
}

/** 解密 config 中的 password（密文 → 明文），返回可连接的配置 */
function resolveConfig(config: ReportExternalDbConfig): Required<Pick<ReportExternalDbConfig, 'host' | 'port' | 'database' | 'user'>> & { password: string; ssl: boolean } {
  if (!config.host || !config.database || !config.user) {
    throw new HTTPException(400, { message: '外部数据库连接信息不完整（host/database/user 必填）' });
  }
  const password = config.password ? (decryptField(config.password) ?? config.password) : '';
  return { host: config.host, port: config.port || (0), database: config.database, user: config.user, password, ssl: !!config.ssl };
}

function isReadonlySelect(text: string): boolean {
  const t = text.trim().replace(/;\s*$/, '');
  if (/;/.test(t)) return false;
  return /^(select|with)\b/i.test(t);
}

function getPgPool(type: ReportDatasourceType, config: ReportExternalDbConfig): ReturnType<typeof postgres> {
  const key = poolKey(type, config);
  const existing = pools.get(key);
  if (existing && existing.kind === 'pg') { existing.expire = Date.now() + IDLE_TTL_MS; return existing.sql; }
  const c = resolveConfig(config);
  const sql = postgres({
    host: c.host, port: c.port || 5432, database: c.database, username: c.user, password: c.password,
    ssl: c.ssl ? 'require' : undefined, max: 3, idle_timeout: 30, connect_timeout: 10,
    prepare: false, onnotice: () => {},
  });
  pools.set(key, { kind: 'pg', sql, expire: Date.now() + IDLE_TTL_MS });
  return sql;
}

function getMyPool(config: ReportExternalDbConfig): mysql.Pool {
  const key = poolKey('mysql', config);
  const existing = pools.get(key);
  if (existing && existing.kind === 'mysql') { existing.expire = Date.now() + IDLE_TTL_MS; return existing.pool; }
  const c = resolveConfig(config);
  const pool = mysql.createPool({
    host: c.host, port: c.port || 3306, database: c.database, user: c.user, password: c.password,
    ssl: c.ssl ? {} : undefined, connectionLimit: 3, connectTimeout: 10_000, waitForConnections: true,
  });
  pools.set(key, { kind: 'mysql', pool, expire: Date.now() + IDLE_TTL_MS });
  return pool;
}

async function getMssqlPool(config: ReportExternalDbConfig): Promise<mssql.ConnectionPool> {
  const key = poolKey('sqlserver', config);
  const existing = pools.get(key);
  if (existing && existing.kind === 'mssql' && existing.pool.connected) { existing.expire = Date.now() + IDLE_TTL_MS; return existing.pool; }
  const c = resolveConfig(config);
  const pool = new mssql.ConnectionPool({
    server: c.host, port: c.port || 1433, database: c.database, user: c.user, password: c.password,
    options: { encrypt: c.ssl, trustServerCertificate: true },
    pool: { max: 3, idleTimeoutMillis: 30_000 },
    connectionTimeout: 10_000, requestTimeout: QUERY_TIMEOUT_MS,
  });
  await pool.connect();
  pools.set(key, { kind: 'mssql', pool, expire: Date.now() + IDLE_TTL_MS });
  return pool;
}

/** 定期回收空闲连接池 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pools) {
    if (entry.expire < now) {
      try {
        if (entry.kind === 'pg') void entry.sql.end({ timeout: 5 });
        else if (entry.kind === 'mysql') void entry.pool.end();
        else void entry.pool.close();
      } catch { /* ignore */ }
      pools.delete(key);
    }
  }
}, 60_000).unref?.();

/** 执行外部库只读查询（参数已转为占位符 + values，防注入；只读约束 + 行上限）*/
export async function runExternalQuery(
  type: ReportDatasourceType,
  config: ReportExternalDbConfig,
  sqlText: string,
  values: unknown[] = [],
  limit = 100,
): Promise<ReportDataResult> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
  if (!isReadonlySelect(trimmed)) throw new HTTPException(400, { message: '仅允许只读 SELECT/WITH 查询' });
  const capped = Math.max(1, Math.min(limit || 100, MAX_ROWS));

  try {
    if (type === 'postgresql') {
      const sql = getPgPool(type, config);
      await sql.unsafe(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`);
      const wrapped = `SELECT * FROM (${trimmed}) AS _sub LIMIT ${capped}`;
      const rows = (await sql.unsafe(wrapped, values as never[])) as unknown as Record<string, unknown>[];
      const arr = Array.isArray(rows) ? rows : [];
      const columns = arr.length ? Object.keys(arr[0]) : [];
      return { columns, rows: arr, total: arr.length };
    }
    if (type === 'sqlserver') {
      const pool = await getMssqlPool(config);
      const request = pool.request();
      values.forEach((v, i) => request.input(`p${i}`, v as never));
      // SELECT 注入 TOP；其余（WITH）取数后切片兜底行上限
      const queryText = /^select\b/i.test(trimmed)
        ? trimmed.replace(/^select\s+/i, `SELECT TOP (${capped}) `)
        : trimmed;
      const result = await request.query(queryText);
      const arr = ((result.recordset ?? []) as Record<string, unknown>[]).slice(0, capped);
      const columns = arr.length ? Object.keys(arr[0]) : [];
      return { columns, rows: arr, total: arr.length };
    }
    // mysql
    const pool = getMyPool(config);
    const conn = await pool.getConnection();
    try {
      await conn.query(`SET SESSION MAX_EXECUTION_TIME=${QUERY_TIMEOUT_MS}`).catch(() => {});
      const wrapped = `SELECT * FROM (${trimmed}) AS _sub LIMIT ${capped}`;
      const [rows] = await conn.query(wrapped, values);
      const arr = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
      const columns = arr.length ? Object.keys(arr[0]) : [];
      return { columns, rows: arr, total: arr.length };
    } finally { conn.release(); }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(502, { message: `外部数据库查询失败：${msg}` });
  }
}

/** 测试连接（SELECT 1） */
export async function testExternalConnection(type: ReportDatasourceType, config: ReportExternalDbConfig): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const start = Date.now();
  try {
    if (type === 'postgresql') {
      const sql = getPgPool(type, config);
      await sql.unsafe('SELECT 1 AS ok');
    } else if (type === 'mysql') {
      const pool = getMyPool(config);
      const conn = await pool.getConnection();
      try { await conn.query('SELECT 1 AS ok'); } finally { conn.release(); }
    } else if (type === 'sqlserver') {
      const pool = await getMssqlPool(config);
      await pool.request().query('SELECT 1 AS ok');
    } else {
      return { ok: false, message: '该类型无需连接测试' };
    }
    return { ok: true, message: '连接成功', latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
