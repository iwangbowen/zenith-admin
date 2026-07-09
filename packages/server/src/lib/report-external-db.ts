import postgres from 'postgres';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import { HTTPException } from 'hono/http-exception';
import { decryptField } from './encryption';
import { createHash } from 'node:crypto';
import { resolveSafeOutboundHost } from './outbound-url';
import { normalizeReadonlyReportSql } from './report-sql-safety';
import type { ReportDatasourceType, ReportExternalDbConfig, ReportDataResult } from '@zenith/shared';

const QUERY_TIMEOUT_MS = 15_000;
const MAX_ROWS = 5000;
const IDLE_TTL_MS = 5 * 60_000;

interface PgPoolEntry { kind: 'pg'; sql: ReturnType<typeof postgres>; expire: number }
interface MyPoolEntry { kind: 'mysql'; pool: mysql.Pool; expire: number }
interface MssqlPoolEntry { kind: 'mssql'; pool: mssql.ConnectionPool; expire: number }
type PoolEntry = PgPoolEntry | MyPoolEntry | MssqlPoolEntry;

const pools = new Map<string, PoolEntry>();

function poolKey(type: ReportDatasourceType, c: ReportExternalDbConfig, tlsServerName?: string): string {
  const credential = createHash('sha256').update(c.password ?? '').digest('hex').slice(0, 16);
  return `${type}://${c.user}@${c.host}:${c.port}/${c.database}:${c.ssl ? 1 : 0}:${tlsServerName ?? ''}:${credential}`;
}

/** 解密 config 中的 password（密文 → 明文），返回可连接的配置 */
function resolveConfig(config: ReportExternalDbConfig): Required<Pick<ReportExternalDbConfig, 'host' | 'port' | 'database' | 'user'>> & { password: string; ssl: boolean } {
  if (!config.host || !config.database || !config.user) {
    throw new HTTPException(400, { message: '外部数据库连接信息不完整（host/database/user 必填）' });
  }
  const password = config.password ? (decryptField(config.password) ?? config.password) : '';
  return { host: config.host, port: config.port || (0), database: config.database, user: config.user, password, ssl: !!config.ssl };
}

function getPgPool(type: ReportDatasourceType, config: ReportExternalDbConfig, tlsServerName?: string): ReturnType<typeof postgres> {
  const key = poolKey(type, config, tlsServerName);
  const existing = pools.get(key);
  if (existing && existing.kind === 'pg') { existing.expire = Date.now() + IDLE_TTL_MS; return existing.sql; }
  const c = resolveConfig(config);
  const sql = postgres({
    host: c.host, port: c.port || 5432, database: c.database, username: c.user, password: c.password,
    ssl: c.ssl ? { rejectUnauthorized: true, servername: tlsServerName } : undefined,
    max: 3, idle_timeout: 30, connect_timeout: 10,
    prepare: false, onnotice: () => {},
    // 连接级 statement_timeout + 只读：每条连接建立时即生效，避免 SET 落在另一池连接上
    connection: { statement_timeout: QUERY_TIMEOUT_MS, default_transaction_read_only: true },
  });
  pools.set(key, { kind: 'pg', sql, expire: Date.now() + IDLE_TTL_MS });
  return sql;
}

function getMyPool(config: ReportExternalDbConfig, tlsServerName?: string): mysql.Pool {
  const key = poolKey('mysql', config, tlsServerName);
  const existing = pools.get(key);
  if (existing && existing.kind === 'mysql') { existing.expire = Date.now() + IDLE_TTL_MS; return existing.pool; }
  const c = resolveConfig(config);
  const ssl = c.ssl ? { rejectUnauthorized: true, servername: tlsServerName } : undefined;
  const pool = mysql.createPool({
    host: c.host, port: c.port || 3306, database: c.database, user: c.user, password: c.password,
    ssl,
    connectionLimit: 3, connectTimeout: 10_000, waitForConnections: true,
  });
  pools.set(key, { kind: 'mysql', pool, expire: Date.now() + IDLE_TTL_MS });
  return pool;
}

async function getMssqlPool(config: ReportExternalDbConfig, tlsServerName?: string): Promise<mssql.ConnectionPool> {
  const key = poolKey('sqlserver', config, tlsServerName);
  const existing = pools.get(key);
  if (existing && existing.kind === 'mssql' && existing.pool.connected) { existing.expire = Date.now() + IDLE_TTL_MS; return existing.pool; }
  // 旧池存在但已断开：先关闭再替换，避免连接/句柄泄露
  if (existing && existing.kind === 'mssql') {
    try { await existing.pool.close(); } catch { /* ignore */ }
    pools.delete(key);
  }
  const c = resolveConfig(config);
  const pool = new mssql.ConnectionPool({
    server: c.host, port: c.port || 1433, database: c.database, user: c.user, password: c.password,
    options: {
      encrypt: c.ssl,
      trustServerCertificate: !c.ssl,
      readOnlyIntent: true,
      serverName: tlsServerName,
    },
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
  const trimmed = normalizeReadonlyReportSql(sqlText);
  const capped = Math.max(1, Math.min(limit || 100, MAX_ROWS));

  try {
    const [address] = await resolveSafeOutboundHost(String(config.host ?? ''));
    const safeConfig = { ...config, host: address.address };
    const tlsServerName = String(config.host ?? '');
    if (type === 'postgresql') {
      const sql = getPgPool(type, safeConfig, tlsServerName);
      // statement_timeout 已在连接级设置（见 getPgPool），此处直接执行
      const wrapped = `SELECT * FROM (${trimmed}) AS _sub LIMIT ${capped}`;
      const rows = (await sql.unsafe(wrapped, values as never[])) as unknown as Record<string, unknown>[];
      const arr = Array.isArray(rows) ? rows : [];
      const columns = arr.length ? Object.keys(arr[0]) : [];
      return { columns, rows: arr, total: arr.length };
    }
    if (type === 'sqlserver') {
      const pool = await getMssqlPool(safeConfig, tlsServerName);
      const request = pool.request();
      values.forEach((v, i) => request.input(`p${i}`, v as never));
      // SET ROWCOUNT 限制返回行数：对 SELECT 与 WITH/CTE 均生效，且不破坏 DISTINCT（避免 TOP 注入）
      const result = await request.query(`
        SET ROWCOUNT ${capped};
        BEGIN TRY
          ${trimmed};
          SET ROWCOUNT 0;
        END TRY
        BEGIN CATCH
          SET ROWCOUNT 0;
          THROW;
        END CATCH
      `);
      const arr = ((result.recordset ?? []) as Record<string, unknown>[]).slice(0, capped);
      const columns = arr.length ? Object.keys(arr[0]) : [];
      return { columns, rows: arr, total: arr.length };
    }
    // mysql
    const pool = getMyPool(safeConfig, tlsServerName);
    const conn = await pool.getConnection();
    try {
      const wrapped = `SELECT * FROM (${trimmed}) AS _sub LIMIT ${capped}`;
      const [rows] = await conn.query({ sql: wrapped, values, timeout: QUERY_TIMEOUT_MS });
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
    const [address] = await resolveSafeOutboundHost(String(config.host ?? ''));
    const safeConfig = { ...config, host: address.address };
    const tlsServerName = String(config.host ?? '');
    if (type === 'postgresql') {
      const sql = getPgPool(type, safeConfig, tlsServerName);
      await sql.unsafe('SELECT 1 AS ok');
    } else if (type === 'mysql') {
      const pool = getMyPool(safeConfig, tlsServerName);
      const conn = await pool.getConnection();
      try { await conn.query('SELECT 1 AS ok'); } finally { conn.release(); }
    } else if (type === 'sqlserver') {
      const pool = await getMssqlPool(safeConfig, tlsServerName);
      await pool.request().query('SELECT 1 AS ok');
    } else {
      return { ok: false, message: '该类型无需连接测试' };
    }
    return { ok: true, message: '连接成功', latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
