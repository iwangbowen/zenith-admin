/**
 * 数据库管理 —— 运维监控 / 对象浏览 / Drizzle 漂移对照 服务层。
 *
 * 安全策略：
 *  - 只读查询统一走 pg_catalog / pg_stat_* 视图。
 *  - 运维写操作（cancel/terminate/vacuum/analyze/reindex/refresh）对系统 schema 做保护，
 *    且 VACUUM / REINDEX / REFRESH 等无法在事务块内执行，使用底层 pgClient.unsafe 直接执行。
 *  - 标识符统一通过 assertIdent + quoteIdent 校验，避免拼接注入。
 */
import { sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db, pgClient } from '../db';
import * as schema from '../db/schema';
import { formatNullableDateTime } from '../lib/datetime';
import { assertIdent, quoteIdent } from './db-admin.service';

const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast', 'drizzle']);

function assertOpsAllowed(schemaName: string): void {
  if (SYSTEM_SCHEMAS.has(schemaName)) {
    throw new HTTPException(403, { message: `禁止对系统 schema 执行运维操作：${schemaName}` });
  }
}

// ─── 1. 活动连接 ─────────────────────────────────────────────────────────────────
export interface ActivityConnection {
  pid: number;
  username: string | null;
  applicationName: string | null;
  clientAddr: string | null;
  database: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  backendType: string | null;
  query: string | null;
  querySeconds: number | null;
  xactSeconds: number | null;
  backendSeconds: number | null;
  queryStart: string | null;
  backendStart: string | null;
  blockedBy: number[];
  isCurrent: boolean;
}

export async function getActiveConnections(): Promise<ActivityConnection[]> {
  const rows = await db.execute(sql`
    SELECT pid,
           usename AS username,
           application_name,
           client_addr::text AS client_addr,
           datname AS database,
           state,
           wait_event_type,
           wait_event,
           backend_type,
           query,
           EXTRACT(EPOCH FROM (now() - query_start))::float8 AS query_seconds,
           EXTRACT(EPOCH FROM (now() - xact_start))::float8 AS xact_seconds,
           EXTRACT(EPOCH FROM (now() - backend_start))::float8 AS backend_seconds,
           query_start,
           backend_start,
           pg_blocking_pids(pid) AS blocked_by,
           (pid = pg_backend_pid()) AS is_current
    FROM pg_stat_activity
    WHERE datname = current_database()
    ORDER BY (state = 'active') DESC, query_start ASC NULLS LAST
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    pid: Number(r.pid),
    username: (r.username as string) ?? null,
    applicationName: (r.application_name as string) || null,
    clientAddr: (r.client_addr as string) ?? null,
    database: (r.database as string) ?? null,
    state: (r.state as string) ?? null,
    waitEventType: (r.wait_event_type as string) ?? null,
    waitEvent: (r.wait_event as string) ?? null,
    backendType: (r.backend_type as string) ?? null,
    query: (r.query as string) ?? null,
    querySeconds: r.query_seconds == null ? null : Number(r.query_seconds),
    xactSeconds: r.xact_seconds == null ? null : Number(r.xact_seconds),
    backendSeconds: r.backend_seconds == null ? null : Number(r.backend_seconds),
    queryStart: formatNullableDateTime(r.query_start as Date | null),
    backendStart: formatNullableDateTime(r.backend_start as Date | null),
    blockedBy: Array.isArray(r.blocked_by) ? (r.blocked_by as number[]).map(Number) : [],
    isCurrent: Boolean(r.is_current),
  }));
}

async function assertNotCurrentBackend(pid: number): Promise<void> {
  const rows = await db.execute(sql`SELECT pg_backend_pid() AS pid`);
  const current = Number((rows as unknown as Array<{ pid: number }>)[0]?.pid);
  if (current === pid) {
    throw new HTTPException(400, { message: '不能终止当前请求所在的连接' });
  }
}

/** 取消正在执行的查询（温和，等价 Ctrl+C），返回是否成功 */
export async function cancelBackend(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) throw new HTTPException(400, { message: '非法 pid' });
  await assertNotCurrentBackend(pid);
  const rows = await db.execute(sql`SELECT pg_cancel_backend(${pid}) AS ok`);
  return Boolean((rows as unknown as Array<{ ok: boolean }>)[0]?.ok);
}

/** 强制终止连接（断开会话），返回是否成功 */
export async function terminateBackend(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) throw new HTTPException(400, { message: '非法 pid' });
  await assertNotCurrentBackend(pid);
  const rows = await db.execute(sql`SELECT pg_terminate_backend(${pid}) AS ok`);
  return Boolean((rows as unknown as Array<{ ok: boolean }>)[0]?.ok);
}

// ─── 2. 表维护 ───────────────────────────────────────────────────────────────────
export interface TableMaintenance {
  schema: string;
  name: string;
  liveTuples: number;
  deadTuples: number;
  deadRatio: number;
  sizeBytes: number;
  sizeText: string;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  vacuumCount: number;
  autovacuumCount: number;
  analyzeCount: number;
  autoanalyzeCount: number;
}

export async function getTableMaintenance(): Promise<TableMaintenance[]> {
  const rows = await db.execute(sql`
    SELECT schemaname AS schema,
           relname AS name,
           n_live_tup::bigint AS live_tuples,
           n_dead_tup::bigint AS dead_tuples,
           CASE WHEN n_live_tup + n_dead_tup > 0
                THEN round(n_dead_tup::numeric / (n_live_tup + n_dead_tup) * 100, 2)
                ELSE 0 END AS dead_ratio,
           pg_total_relation_size(relid)::bigint AS size_bytes,
           pg_size_pretty(pg_total_relation_size(relid)) AS size_text,
           last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
           vacuum_count::bigint, autovacuum_count::bigint,
           analyze_count::bigint, autoanalyze_count::bigint
    FROM pg_stat_user_tables
    ORDER BY n_dead_tup DESC, pg_total_relation_size(relid) DESC
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    schema: r.schema as string,
    name: r.name as string,
    liveTuples: Number(r.live_tuples ?? 0),
    deadTuples: Number(r.dead_tuples ?? 0),
    deadRatio: Number(r.dead_ratio ?? 0),
    sizeBytes: Number(r.size_bytes ?? 0),
    sizeText: r.size_text as string,
    lastVacuum: formatNullableDateTime(r.last_vacuum as Date | null),
    lastAutovacuum: formatNullableDateTime(r.last_autovacuum as Date | null),
    lastAnalyze: formatNullableDateTime(r.last_analyze as Date | null),
    lastAutoanalyze: formatNullableDateTime(r.last_autoanalyze as Date | null),
    vacuumCount: Number(r.vacuum_count ?? 0),
    autovacuumCount: Number(r.autovacuum_count ?? 0),
    analyzeCount: Number(r.analyze_count ?? 0),
    autoanalyzeCount: Number(r.autoanalyze_count ?? 0),
  }));
}

export type MaintenanceAction = 'vacuum' | 'vacuum_analyze' | 'analyze' | 'reindex';

/** 执行表维护操作。VACUUM / REINDEX 无法在事务块内运行，使用底层连接直接执行。 */
export async function runTableMaintenance(
  schemaName: string,
  name: string,
  action: MaintenanceAction,
): Promise<void> {
  assertIdent(schemaName, 'schema');
  assertIdent(name, 'table');
  assertOpsAllowed(schemaName);
  const full = `${quoteIdent(schemaName)}.${quoteIdent(name)}`;
  const stmt = {
    vacuum: `VACUUM ${full}`,
    vacuum_analyze: `VACUUM (ANALYZE) ${full}`,
    analyze: `ANALYZE ${full}`,
    reindex: `REINDEX TABLE ${full}`,
  }[action];
  try {
    await pgClient.unsafe(stmt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `操作失败：${msg}` });
  }
}

/** 刷新物化视图 */
export async function refreshMatview(schemaName: string, name: string): Promise<void> {
  assertIdent(schemaName, 'schema');
  assertIdent(name, 'matview');
  assertOpsAllowed(schemaName);
  // 校验确实是物化视图
  const check = await db.execute(sql`
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schemaName} AND c.relname = ${name} AND c.relkind = 'm'
  `);
  if ((check as unknown as Array<unknown>).length === 0) {
    throw new HTTPException(400, { message: '目标不是物化视图' });
  }
  try {
    await pgClient.unsafe(`REFRESH MATERIALIZED VIEW ${quoteIdent(schemaName)}.${quoteIdent(name)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `刷新失败：${msg}` });
  }
}

// ─── 3. 索引健康 ─────────────────────────────────────────────────────────────────
export interface IndexInfoRow {
  schema: string;
  table: string;
  index: string;
  scans: number;
  sizeBytes: number;
  sizeText: string;
  isUnique: boolean;
  isPrimary: boolean;
  columns: string[];
  definition: string;
}

export interface IndexHealth {
  unused: IndexInfoRow[];
  duplicate: Array<{ schema: string; table: string; columns: string[]; indexes: IndexInfoRow[] }>;
  totalIndexes: number;
  totalIndexBytes: number;
}

export async function getIndexHealth(): Promise<IndexHealth> {
  const rows = await db.execute(sql`
    SELECT s.schemaname AS schema,
           s.relname AS table,
           s.indexrelname AS index,
           s.idx_scan::bigint AS scans,
           pg_relation_size(s.indexrelid)::bigint AS size_bytes,
           pg_size_pretty(pg_relation_size(s.indexrelid)) AS size_text,
           ix.indisunique AS is_unique,
           ix.indisprimary AS is_primary,
           ix.indrelid::bigint AS rel_oid,
           ix.indkey::text AS indkey,
           pg_get_indexdef(s.indexrelid) AS definition,
           ARRAY(
             SELECT a.attname
             FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
             ORDER BY k.ord
           ) AS columns
    FROM pg_stat_user_indexes s
    JOIN pg_index ix ON ix.indexrelid = s.indexrelid
    ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC
  `);
  const all = (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    schema: r.schema as string,
    table: r.table as string,
    index: r.index as string,
    scans: Number(r.scans ?? 0),
    sizeBytes: Number(r.size_bytes ?? 0),
    sizeText: r.size_text as string,
    isUnique: Boolean(r.is_unique),
    isPrimary: Boolean(r.is_primary),
    columns: Array.isArray(r.columns) ? (r.columns as string[]) : [],
    definition: r.definition as string,
    _relOid: String(r.rel_oid),
    _indkey: String(r.indkey),
  }));

  const stripInternal = (x: typeof all[number]): IndexInfoRow => ({
    schema: x.schema, table: x.table, index: x.index, scans: x.scans,
    sizeBytes: x.sizeBytes, sizeText: x.sizeText, isUnique: x.isUnique,
    isPrimary: x.isPrimary, columns: x.columns, definition: x.definition,
  });

  // 未使用：扫描数为 0 且非主键（唯一约束保留但仍提示）
  const unused = all.filter((x) => x.scans === 0 && !x.isPrimary).map(stripInternal);

  // 重复：同表 + 相同列集（indkey）
  const groups = new Map<string, typeof all>();
  for (const x of all) {
    const key = `${x._relOid}|${x._indkey}`;
    const arr = groups.get(key) ?? [];
    arr.push(x);
    groups.set(key, arr);
  }
  const duplicate = Array.from(groups.values())
    .filter((g) => g.length > 1)
    .map((g) => ({
      schema: g[0].schema,
      table: g[0].table,
      columns: g[0].columns,
      indexes: g.map(stripInternal),
    }));

  return {
    unused,
    duplicate,
    totalIndexes: all.length,
    totalIndexBytes: all.reduce((s, x) => s + x.sizeBytes, 0),
  };
}

// ─── 4. 对象浏览 ─────────────────────────────────────────────────────────────────
export interface DbObjects {
  sequences: Array<{ schema: string; name: string; dataType: string; startValue: string; incrementBy: string; lastValue: string | null }>;
  functions: Array<{ schema: string; name: string; kind: string; language: string; args: string; result: string; definition: string | null }>;
  triggers: Array<{ schema: string; table: string; name: string; enabled: boolean; definition: string }>;
  enums: Array<{ schema: string; name: string; values: string[] }>;
  extensions: Array<{ name: string; version: string; schema: string; comment: string | null }>;
}

export async function listDbObjects(): Promise<DbObjects> {
  const hidden = sql`('pg_catalog', 'information_schema', 'pg_toast')`;
  const [seqRows, fnRows, trgRows, enumRows, extRows] = await Promise.all([
    db.execute(sql`
      SELECT schemaname AS schema, sequencename AS name, data_type::text AS data_type,
             start_value::text AS start_value, increment_by::text AS increment_by,
             last_value::text AS last_value
      FROM pg_sequences
      WHERE schemaname NOT IN ${hidden}
      ORDER BY schemaname, sequencename
    `),
    db.execute(sql`
      SELECT n.nspname AS schema, p.proname AS name,
             CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
                            WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window' ELSE 'other' END AS kind,
             l.lanname AS language,
             pg_get_function_arguments(p.oid) AS args,
             pg_get_function_result(p.oid) AS result,
             CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) ELSE NULL END AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname NOT IN ${hidden}
      ORDER BY n.nspname, p.proname
    `),
    db.execute(sql`
      SELECT n.nspname AS schema, c.relname AS "table", t.tgname AS name,
             (t.tgenabled <> 'D') AS enabled,
             pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname NOT IN ${hidden}
      ORDER BY n.nspname, c.relname, t.tgname
    `),
    db.execute(sql`
      SELECT n.nspname AS schema, t.typname AS name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ${hidden}
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname
    `),
    db.execute(sql`
      SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema,
             obj_description(e.oid, 'pg_extension') AS comment
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      ORDER BY e.extname
    `),
  ]);

  return {
    sequences: (seqRows as unknown as Array<Record<string, unknown>>).map((r) => ({
      schema: r.schema as string, name: r.name as string, dataType: r.data_type as string,
      startValue: r.start_value as string, incrementBy: r.increment_by as string,
      lastValue: (r.last_value as string) ?? null,
    })),
    functions: (fnRows as unknown as Array<Record<string, unknown>>).map((r) => ({
      schema: r.schema as string, name: r.name as string, kind: r.kind as string,
      language: r.language as string, args: (r.args as string) ?? '', result: (r.result as string) ?? '',
      definition: (r.definition as string) ?? null,
    })),
    triggers: (trgRows as unknown as Array<Record<string, unknown>>).map((r) => ({
      schema: r.schema as string, table: r.table as string, name: r.name as string,
      enabled: Boolean(r.enabled), definition: r.definition as string,
    })),
    enums: (enumRows as unknown as Array<Record<string, unknown>>).map((r) => ({
      schema: r.schema as string, name: r.name as string,
      values: Array.isArray(r.values) ? (r.values as string[]) : [],
    })),
    extensions: (extRows as unknown as Array<Record<string, unknown>>).map((r) => ({
      name: r.name as string, version: r.version as string, schema: r.schema as string,
      comment: (r.comment as string) ?? null,
    })),
  };
}

// ─── 5. Drizzle Schema 漂移对照 ──────────────────────────────────────────────────
export interface ColumnDiff {
  column: string;
  issue: 'missing_in_db' | 'extra_in_db' | 'type_mismatch' | 'nullable_mismatch';
  expected: string | null;
  actual: string | null;
}

export interface TableDrift {
  schema: string;
  table: string;
  status: 'missing_in_db' | 'extra_in_db' | 'column_diff';
  columns: ColumnDiff[];
}

export interface SchemaDrift {
  inSync: boolean;
  expectedTables: number;
  actualTables: number;
  drifts: TableDrift[];
}

/** 归一化 PG 类型名，用于 Drizzle 期望类型与 DB 实际类型对比 */
function canonicalType(raw: string): string {
  let t = raw.trim().toLowerCase();
  // 数组后缀
  let isArray = false;
  if (t.endsWith('[]')) { isArray = true; t = t.slice(0, -2).trim(); }
  if (t.startsWith('_')) { isArray = true; t = t.slice(1); }
  // 提取长度
  const lenMatch = /\(([0-9, ]+)\)/.exec(t);
  const len = lenMatch ? lenMatch[1].replace(/\s/g, '') : '';
  let base = t.replace(/\([^)]*\)/, '').replace(/\s+/g, ' ').trim();
  // 别名归一
  const alias: Record<string, string> = {
    serial: 'integer', serial4: 'integer', smallserial: 'smallint', serial2: 'smallint',
    bigserial: 'bigint', serial8: 'bigint',
    int: 'integer', int4: 'integer', int2: 'smallint', int8: 'bigint',
    bool: 'boolean',
    varchar: 'varchar', 'character varying': 'varchar',
    bpchar: 'char', character: 'char',
    timestamptz: 'timestamptz', 'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp',
    timetz: 'timetz', 'time with time zone': 'timetz', 'time without time zone': 'time',
    float4: 'real', float8: 'double precision', 'double precision': 'double precision',
    decimal: 'numeric', numeric: 'numeric',
    json: 'json', jsonb: 'jsonb', uuid: 'uuid', text: 'text', date: 'date',
  };
  base = alias[base] ?? base;
  const withLen = (base === 'varchar' || base === 'char') && len ? `${base}(${len})` : base;
  return isArray ? `${withLen}[]` : withLen;
}

interface ExpectedColumn { name: string; type: string; notNull: boolean }
interface ExpectedTable { schema: string; name: string; columns: ExpectedColumn[] }

function collectExpectedTables(): ExpectedTable[] {
  const out: ExpectedTable[] = [];
  for (const val of Object.values(schema)) {
    if (!is(val, PgTable)) continue;
    const cfg = getTableConfig(val as PgTable);
    out.push({
      schema: cfg.schema ?? 'public',
      name: cfg.name,
      columns: cfg.columns.map((c) => ({
        name: c.name,
        type: canonicalType(c.getSQLType()),
        notNull: c.notNull,
      })),
    });
  }
  return out;
}

export async function getSchemaDrift(): Promise<SchemaDrift> {
  const expectedTables = collectExpectedTables();
  const expectedByKey = new Map(expectedTables.map((t) => [`${t.schema}.${t.name}`, t]));
  // 仅对照 Drizzle 实际声明的 schema（通常是 public），避免把 pgboss / 扩展等第三方 schema 误判为漂移
  const managedSchemas = Array.from(new Set(expectedTables.map((t) => t.schema)));
  if (managedSchemas.length === 0) {
    return { inSync: true, expectedTables: 0, actualTables: 0, drifts: [] };
  }

  // 读取 DB 实际列：用 pg_catalog + format_type 得到与 Drizzle getSQLType 一致的类型串；
  // 排除分区子表（relispartition）避免误报。
  const rows = await db.execute(sql`
    SELECT n.nspname AS schema,
           c.relname AS "table",
           a.attname AS column,
           format_type(a.atttypid, a.atttypmod) AS full_type,
           a.attnotnull AS not_null
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND n.nspname IN (${sql.join(managedSchemas.map((s) => sql`${s}`), sql`, `)})
    ORDER BY n.nspname, c.relname, a.attnum
  `);

  const actualByTable = new Map<string, Map<string, { type: string; notNull: boolean }>>();
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    const key = `${r.schema as string}.${r.table as string}`;
    let cols = actualByTable.get(key);
    if (!cols) { cols = new Map(); actualByTable.set(key, cols); }
    cols.set(r.column as string, {
      type: canonicalType(r.full_type as string),
      notNull: Boolean(r.not_null),
    });
  }

  const drifts: TableDrift[] = [];

  // 期望存在的表逐一对照
  for (const exp of expectedTables) {
    const key = `${exp.schema}.${exp.name}`;
    const actualCols = actualByTable.get(key);
    if (!actualCols) {
      drifts.push({ schema: exp.schema, table: exp.name, status: 'missing_in_db', columns: [] });
      continue;
    }
    const colDiffs: ColumnDiff[] = [];
    const expectedColNames = new Set(exp.columns.map((c) => c.name));
    for (const ec of exp.columns) {
      const ac = actualCols.get(ec.name);
      if (!ac) {
        colDiffs.push({ column: ec.name, issue: 'missing_in_db', expected: ec.type, actual: null });
        continue;
      }
      if (ec.type !== ac.type) {
        colDiffs.push({ column: ec.name, issue: 'type_mismatch', expected: ec.type, actual: ac.type });
      }
      if (ec.notNull !== ac.notNull) {
        colDiffs.push({
          column: ec.name, issue: 'nullable_mismatch',
          expected: ec.notNull ? 'NOT NULL' : 'NULL',
          actual: ac.notNull ? 'NOT NULL' : 'NULL',
        });
      }
    }
    for (const acName of actualCols.keys()) {
      if (!expectedColNames.has(acName)) {
        colDiffs.push({ column: acName, issue: 'extra_in_db', expected: null, actual: actualCols.get(acName)!.type });
      }
    }
    if (colDiffs.length > 0) {
      drifts.push({ schema: exp.schema, table: exp.name, status: 'column_diff', columns: colDiffs });
    }
  }

  // DB 中存在但 schema.ts 未声明的表（迁移表已被 schema 过滤排除）
  for (const key of actualByTable.keys()) {
    if (!expectedByKey.has(key)) {
      const [s, t] = key.split('.');
      drifts.push({ schema: s, table: t, status: 'extra_in_db', columns: [] });
    }
  }

  drifts.sort((a, b) => `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`));

  return {
    inSync: drifts.length === 0,
    expectedTables: expectedTables.length,
    actualTables: actualByTable.size,
    drifts,
  };
}
