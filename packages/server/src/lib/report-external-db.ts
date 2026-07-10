import postgres from 'postgres';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import { HTTPException } from 'hono/http-exception';
import { decryptField } from './encryption';
import { createHash } from 'node:crypto';
import { resolveSafeOutboundHost } from './outbound-url';
import { normalizeReadonlyReportSql } from './report-sql-safety';
import type { ReportDatasourceType, ReportExternalDbConfig, ReportDataResult, ReportDatasetQueryOptions } from '@zenith/shared';

const QUERY_TIMEOUT_MS = 15_000;
const MAX_ROWS = 5000;
const IDLE_TTL_MS = 5 * 60_000;

interface PgPoolEntry { kind: 'pg'; sql: ReturnType<typeof postgres>; expire: number }
interface MyPoolEntry { kind: 'mysql'; pool: mysql.Pool; expire: number }
interface MssqlPoolEntry { kind: 'mssql'; pool: mssql.ConnectionPool; expire: number }
type PoolEntry = PgPoolEntry | MyPoolEntry | MssqlPoolEntry;

const pools = new Map<string, PoolEntry>();

function closePoolEntry(entry: PoolEntry) {
  try {
    if (entry.kind === 'pg') void entry.sql.end({ timeout: 5 });
    else if (entry.kind === 'mysql') void entry.pool.end();
    else void entry.pool.close();
  } catch { /* ignore */ }
}

function poolKey(type: ReportDatasourceType, c: ReportExternalDbConfig, tlsServerName?: string): string {
  const credential = createHash('sha256').update(c.password ?? '').digest('hex').slice(0, 16);
  return `${type}://${c.user}@${c.host}:${c.port}/${c.database}:${c.ssl ? 1 : 0}:${tlsServerName ?? ''}:${credential}`;
}

export async function invalidateExternalDatasourcePools(
  type: ReportDatasourceType,
  ...configs: Array<ReportExternalDbConfig | null | undefined>
): Promise<void> {
  const keys = new Set<string>();
  for (const cfg of configs) {
    if (!cfg) continue;
    keys.add(poolKey(type, cfg, String(cfg.host ?? '')));
  }
  for (const key of keys) {
    const entry = pools.get(key);
    if (!entry) continue;
    closePoolEntry(entry);
    pools.delete(key);
  }
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
      closePoolEntry(entry);
      pools.delete(key);
    }
  }
}, 60_000).unref?.();

function quoteWrappedField(field: string, dialect: 'postgresql' | 'mysql' | 'sqlserver'): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    throw new HTTPException(400, { message: '排序字段不合法' });
  }
  if (dialect === 'mysql') return `\`${field}\``;
  if (dialect === 'sqlserver') return `[${field}]`;
  return `"${field}"`;
}

export function stripSqlServerTopLevelOrderBy(sqlText: string): string {
  let depth = 0;
  let orderByIndex = -1;
  let quote: "'" | '"' | '[' | null = null;
  let lineComment = false;
  let blockComment = false;
  const isWord = (char: string | undefined) => !!char && /[A-Za-z0-9_]/.test(char);

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const next = sqlText[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      const close = quote === '[' ? ']' : quote;
      if (char === close) {
        if (quote !== '[' && next === close) { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === '\'' || char === '"' || char === '[') { quote = char; continue; }
    if (char === '(') { depth++; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0 || sqlText.slice(i, i + 5).toLowerCase() !== 'order') continue;
    if (isWord(sqlText[i - 1]) || isWord(sqlText[i + 5])) continue;
    let j = i + 5;
    while (/\s/.test(sqlText[j] ?? '')) j++;
    if (sqlText.slice(j, j + 2).toLowerCase() === 'by' && !isWord(sqlText[j + 2])) {
      orderByIndex = i;
    }
  }
  return orderByIndex >= 0 ? sqlText.slice(0, orderByIndex).trimEnd() : sqlText;
}

function buildWrappedSql(
  sqlText: string,
  options: ReportDatasetQueryOptions,
  dialect: 'postgresql' | 'mysql' | 'sqlserver',
): { dataSql: string; countSql: string; pageSize: number; offset: number } {
  const page = options.page ?? 1;
  const pageSize = Math.max(1, Math.min(options.pageSize ?? options.limit ?? 100, MAX_ROWS));
  const offset = options.page && options.pageSize ? Math.max(0, (page - 1) * pageSize) : 0;
  const limit = options.page && options.pageSize ? pageSize : Math.max(1, Math.min(options.limit ?? pageSize, MAX_ROWS));
  const orderDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const orderBy = options.sortField
    ? ` ORDER BY ${quoteWrappedField(options.sortField, dialect)} ${orderDir}`
    : (dialect === 'sqlserver' ? ' ORDER BY (SELECT 1)' : '');
  const limitSql = dialect === 'sqlserver'
    ? ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
    : ` LIMIT ${limit}${offset > 0 ? ` OFFSET ${offset}` : ''}`;
  return {
    dataSql: `SELECT * FROM (${sqlText}) AS _sub${orderBy}${limitSql}`,
    countSql: `SELECT COUNT(*) AS total FROM (${sqlText}) AS _count`,
    pageSize: limit,
    offset,
  };
}

/** 执行外部库只读查询（参数已转为占位符 + values，防注入；只读约束 + 行上限）*/
export async function runExternalQuery(
  type: ReportDatasourceType,
  config: ReportExternalDbConfig,
  sqlText: string,
  values: unknown[] = [],
  options: ReportDatasetQueryOptions = {},
): Promise<ReportDataResult> {
  const trimmed = normalizeReadonlyReportSql(sqlText);

  try {
    const [address] = await resolveSafeOutboundHost(String(config.host ?? ''));
    const safeConfig = { ...config, host: address.address };
    const tlsServerName = String(config.host ?? '');
    if (type === 'postgresql') {
      const sql = getPgPool(type, safeConfig, tlsServerName);
      const wrapped = buildWrappedSql(trimmed, options, 'postgresql');
      const [countRows, rows] = await Promise.all([
       sql.unsafe(wrapped.countSql, values as never[]),
       sql.unsafe(wrapped.dataSql, values as never[]),
      ]);
      const arr = Array.isArray(rows) ? rows : [];
      const columns = arr.length ? Object.keys(arr[0]) : [];
      const total = Number((Array.isArray(countRows) ? countRows[0] : countRows)?.total ?? arr.length);
      return { columns, fields: [], rows: arr, total: Number.isFinite(total) ? total : arr.length };
    }
    if (type === 'sqlserver') {
      const pool = await getMssqlPool(safeConfig, tlsServerName);
      const wrapped = buildWrappedSql(stripSqlServerTopLevelOrderBy(trimmed), options, 'sqlserver');
      const dataRequest = pool.request();
      values.forEach((v, i) => dataRequest.input(`p${i}`, v as never));
      const countRequest = pool.request();
      values.forEach((v, i) => countRequest.input(`p${i}`, v as never));
      const [countResult, dataResult] = await Promise.all([
       countRequest.query(wrapped.countSql),
       dataRequest.query(wrapped.dataSql),
      ]);
      const arr = (dataResult.recordset ?? []) as Record<string, unknown>[];
      const columns = arr.length ? Object.keys(arr[0]) : [];
      const total = Number((countResult.recordset ?? [])[0]?.total ?? arr.length);
      return { columns, fields: [], rows: arr, total: Number.isFinite(total) ? total : arr.length };
    }
    // mysql
    const pool = getMyPool(safeConfig, tlsServerName);
    const conn = await pool.getConnection();
    try {
      const wrapped = buildWrappedSql(trimmed, options, 'mysql');
      const [countResult, dataResult] = await Promise.all([
       conn.query({ sql: wrapped.countSql, values, timeout: QUERY_TIMEOUT_MS }),
       conn.query({ sql: wrapped.dataSql, values, timeout: QUERY_TIMEOUT_MS }),
      ]);
      const countRows = countResult[0];
      const rows = dataResult[0];
      const arr = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
      const columns = arr.length ? Object.keys(arr[0]) : [];
      const totalRow = Array.isArray(countRows) ? (countRows[0] as { total?: number } | undefined) : undefined;
      const total = Number(totalRow?.total ?? arr.length);
      return { columns, fields: [], rows: arr, total: Number.isFinite(total) ? total : arr.length };
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
