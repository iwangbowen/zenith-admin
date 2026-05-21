/**
 * 数据库管理（DB Inspector）服务层。
 *
 * 安全策略：
 *  1. 所有用户提交的 SQL 都在 BEGIN; SET LOCAL TRANSACTION READ ONLY; ... ROLLBACK; 中执行，
 *     由 PostgreSQL 原生拒绝任何写操作。
 *  2. 设置 statement_timeout 防止长查询拖垮数据库。
 *  3. 单次查询最多返回 MAX_ROWS 行，超出会被自动截断。
 *  4. 表数据浏览接口对 schema/table/column 名做白名单校验，避免拼接注入。
 *  5. 路由层通过 guard({ permission: 'system:db-admin:*' }) 双层鉴权。
 */
import { sql, desc, eq, and } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import type { DbExecutor } from '../db/types';
import { dbAdminQueryHistory } from '../db/schema';
import { currentUserId } from '../lib/context';
import { formatDateTime } from '../lib/datetime';
import logger from '../lib/logger';

const QUERY_TIMEOUT = '60s';
const MAX_ROWS = 5000;
const HIDDEN_SCHEMAS = new Set([
  'pg_catalog',
  'information_schema',
  'pg_toast',
]);

// ─── 类型 ──────────────────────────────────────────────────────────────────────
export interface TableItem {
  schema: string;
  name: string;
  rowEstimate: number;
  sizeBytes: number;
  sizeText: string;
  comment: string | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment: string | null;
  maxLength: number | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  definition: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface TableStructure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  primaryKey: string[];
}

export interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

// ─── 工具：标识符白名单校验 ────────────────────────────────────────────────────
const IDENT_PATTERN = /^[A-Za-z_]\w*$/;

function assertIdent(value: string, label: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new HTTPException(400, { message: `非法的${label}：${value}` });
  }
}

function quoteIdent(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

// ─── 1. 表列表 ──────────────────────────────────────────────────────────────────
export async function listTables(): Promise<TableItem[]> {
  const hidden = Array.from(HIDDEN_SCHEMAS).map((s) => `'${s}'`).join(', ');
  const rows = await db.execute(sql.raw(`
    SELECT n.nspname AS schema,
           c.relname AS name,
           COALESCE(c.reltuples, 0)::bigint AS row_estimate,
           pg_total_relation_size(c.oid)::bigint AS size_bytes,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size_text,
           obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN (${hidden})
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT LIKE 'pg_toast_temp_%'
    ORDER BY n.nspname, c.relname
  `));
  return (rows as unknown as Array<{
    schema: string; name: string; row_estimate: string | number;
    size_bytes: string | number; size_text: string; comment: string | null;
  }>).map((r) => ({
    schema: r.schema,
    name: r.name,
    rowEstimate: Number(r.row_estimate),
    sizeBytes: Number(r.size_bytes),
    sizeText: r.size_text,
    comment: r.comment,
  }));
}

// ─── 2. 表结构 ──────────────────────────────────────────────────────────────────
export async function getTableStructure(schema: string, name: string): Promise<TableStructure> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');

  const [columnsRows, indexesRows, fkRows, pkRows] = await Promise.all([
    db.execute(sql`
      SELECT a.attname AS name,
             format_type(a.atttypid, a.atttypmod) AS data_type,
             NOT a.attnotnull AS is_nullable,
             pg_get_expr(d.adbin, d.adrelid) AS default_value,
             col_description(a.attrelid, a.attnum) AS comment,
             CASE WHEN a.atttypmod > 0 AND format_type(a.atttypid, NULL) IN ('character varying', 'character', 'bit varying', 'bit')
                  THEN a.atttypmod - 4
                  ELSE NULL END AS max_length,
             a.attnum
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = (${`${schema}.${name}`}::regclass)
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `),
    db.execute(sql`
      SELECT i.relname AS name,
             ix.indisunique AS is_unique,
             ix.indisprimary AS is_primary,
             pg_get_indexdef(ix.indexrelid) AS definition,
             ARRAY(
               SELECT a.attname
               FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
               ORDER BY k.ord
             ) AS columns
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schema} AND t.relname = ${name}
      ORDER BY ix.indisprimary DESC, i.relname
    `),
    db.execute(sql`
      SELECT con.conname AS name,
             ARRAY(
               SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
               ORDER BY k.ord
             ) AS columns,
             ref_ns.nspname AS referenced_schema,
             ref_cls.relname AS referenced_table,
             ARRAY(
               SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
               ORDER BY k.ord
             ) AS referenced_columns,
             con.confupdtype AS on_update,
             con.confdeltype AS on_delete
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
      JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
      WHERE con.contype = 'f' AND ns.nspname = ${schema} AND cls.relname = ${name}
      ORDER BY con.conname
    `),
    db.execute(sql`
      SELECT ARRAY(
        SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
        ORDER BY k.ord
      ) AS columns
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE con.contype = 'p' AND ns.nspname = ${schema} AND cls.relname = ${name}
      LIMIT 1
    `),
  ]);

  const pkArr = (pkRows as unknown as Array<{ columns: string[] }>)[0];
  const primaryKey = pkArr?.columns ?? [];
  const pkSet = new Set(primaryKey);

  const columns: ColumnInfo[] = (columnsRows as unknown as Array<{
    name: string; data_type: string; is_nullable: boolean;
    default_value: string | null; comment: string | null; max_length: number | string | null;
  }>).map((r) => ({
    name: r.name,
    dataType: r.data_type,
    isNullable: r.is_nullable,
    defaultValue: r.default_value,
    isPrimaryKey: pkSet.has(r.name),
    comment: r.comment,
    maxLength: r.max_length == null ? null : Number(r.max_length),
  }));

  const indexes: IndexInfo[] = (indexesRows as unknown as Array<{
    name: string; is_unique: boolean; is_primary: boolean; definition: string; columns: string[];
  }>).map((r) => ({
    name: r.name,
    isUnique: r.is_unique,
    isPrimary: r.is_primary,
    definition: r.definition,
    columns: r.columns ?? [],
  }));

  const fkActionMap: Record<string, string> = {
    a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT',
  };
  const foreignKeys: ForeignKeyInfo[] = (fkRows as unknown as Array<{
    name: string; columns: string[]; referenced_schema: string; referenced_table: string;
    referenced_columns: string[]; on_update: string; on_delete: string;
  }>).map((r) => ({
    name: r.name,
    columns: r.columns ?? [],
    referencedSchema: r.referenced_schema,
    referencedTable: r.referenced_table,
    referencedColumns: r.referenced_columns ?? [],
    onUpdate: fkActionMap[r.on_update] ?? r.on_update,
    onDelete: fkActionMap[r.on_delete] ?? r.on_delete,
  }));

  return { columns, indexes, foreignKeys, primaryKey };
}

// ─── 3. 表数据分页 ──────────────────────────────────────────────────────────────
export interface RowsParams {
  schema: string;
  name: string;
  page: number;
  pageSize: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  /** 列名 -> 关键字（使用 col::text ILIKE %kw% 匹配） */
  filters?: Record<string, string>;
}

export async function getTableRows(params: RowsParams): Promise<{
  list: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const { schema, name, page, pageSize, orderBy, orderDir = 'asc', filters } = params;
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');

  // 校验 orderBy 是否真实存在于表中
  if (orderBy) {
    assertIdent(orderBy, 'orderBy');
    const colCheck = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${name} AND column_name = ${orderBy}
      LIMIT 1
    `);
    if ((colCheck as unknown as unknown[]).length === 0) {
      throw new HTTPException(400, { message: `列不存在：${orderBy}` });
    }
  }

  // 校验 filters 中的列名都存在
  const filterEntries: Array<[string, string]> = filters
    ? Object.entries(filters).filter(([, v]) => typeof v === 'string' && v.length > 0)
    : [];
  if (filterEntries.length > 0) {
    for (const [col] of filterEntries) assertIdent(col, 'filter列');
    const filterCols = filterEntries.map(([c]) => c);
    const validCols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${name}
        AND column_name IN (${sql.join(filterCols.map((c) => sql`${c}`), sql`, `)})
    `);
    const validSet = new Set(
      (validCols as unknown as Array<{ column_name: string }>).map((r) => r.column_name),
    );
    for (const [col] of filterEntries) {
      if (!validSet.has(col)) throw new HTTPException(400, { message: `筛选列不存在：${col}` });
    }
  }

  const fullName = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const offset = (page - 1) * pageSize;
  const dir = orderDir === 'desc' ? 'DESC' : 'ASC';
  const orderClause = orderBy ? sql.raw(`ORDER BY ${quoteIdent(orderBy)} ${dir}`) : sql.raw('');

  const whereSql = filterEntries.length > 0
    ? sql`WHERE ${sql.join(
        filterEntries.map(([col, kw]) =>
          sql`${sql.raw(quoteIdent(col))}::text ILIKE ${'%' + kw + '%'}`,
        ),
        sql.raw(' AND '),
      )}`
    : sql.raw('');

  return runReadOnly(async (tx) => {
    const [listRows, totalRows] = await Promise.all([
      tx.execute(sql`SELECT * FROM ${sql.raw(fullName)} ${whereSql} ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`),
      tx.execute(sql`SELECT count(*)::bigint AS c FROM ${sql.raw(fullName)} ${whereSql}`),
    ]);
    const total = Number((totalRows as unknown as Array<{ c: string | number }>)[0]?.c ?? 0);
    return {
      list: (listRows as unknown as Array<Record<string, unknown>>).map(serializeRow),
      total,
      page,
      pageSize,
    };
  });
}

// ─── 4. 执行只读 SQL ────────────────────────────────────────────────────────────
export async function executeReadonlyQuery(sqlText: string): Promise<QueryResult> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) {
    throw new HTTPException(400, { message: 'SQL 不能为空' });
  }

  const start = Date.now();
  let success = false;
  let errorMessage: string | null = null;
  let result: QueryResult = { columns: [], rows: [], rowCount: 0, durationMs: 0, truncated: false };

  try {
    result = await runReadOnly(async (tx) => {
      const rows = await tx.execute(sql.raw(trimmed));
      return buildQueryResult(rows);
    });
    success = true;
    return result;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `SQL 执行失败：${errorMessage}` });
  } finally {
    const durationMs = Date.now() - start;
    result.durationMs = durationMs;
    await recordHistory({ sqlText: trimmed, durationMs, rowCount: result.rowCount, success, errorMessage });
  }
}

// ─── 5. EXPLAIN ────────────────────────────────────────────────────────────────
export async function explainQuery(sqlText: string): Promise<{ plan: unknown; durationMs: number }> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new HTTPException(400, { message: 'SQL 不能为空' });

  const start = Date.now();
  try {
    const plan = await runReadOnly(async (tx) => {
      const rows = await tx.execute(sql.raw(`EXPLAIN (FORMAT JSON) ${trimmed}`));
      const first = (rows as unknown as Array<Record<string, unknown>>)[0];
      // PostgreSQL 返回的字段名是 'QUERY PLAN'，是个数组
      const planValue = first?.['QUERY PLAN'] ?? first?.['query plan'] ?? first;
      return Array.isArray(planValue) ? planValue[0] : planValue;
    });
    return { plan, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `EXPLAIN 失败：${msg}` });
  }
}

// ─── 6. 导出 CSV ────────────────────────────────────────────────────────────────
export async function exportQueryCsv(sqlText: string): Promise<string> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new HTTPException(400, { message: 'SQL 不能为空' });

  try {
    return await runReadOnly(async (tx) => {
      const rows = await tx.execute(sql.raw(trimmed));
      const data = rows as unknown as Array<Record<string, unknown>>;
      const first = data[0];
      if (!first) return '';
      const headers = Object.keys(first);
      const lines = [headers.map(csvEscape).join(',')];
      for (const row of data) {
        lines.push(headers.map((h) => csvEscape(serializeCell(row[h]))).join(','));
      }
      return '\uFEFF' + lines.join('\n');
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `导出失败：${msg}` });
  }
}

// ─── 7. SQL 执行历史 ────────────────────────────────────────────────────────────
export async function listQueryHistory(page: number, pageSize: number): Promise<{
  list: Array<{
    id: number; sqlText: string; durationMs: number; rowCount: number;
    success: boolean; errorMessage: string | null; executedAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const userId = currentUserId();
  const offset = (page - 1) * pageSize;
  const [list, total] = await Promise.all([
    db.select().from(dbAdminQueryHistory)
      .where(eq(dbAdminQueryHistory.userId, userId))
      .orderBy(desc(dbAdminQueryHistory.id))
      .limit(pageSize)
      .offset(offset),
    db.$count(dbAdminQueryHistory, eq(dbAdminQueryHistory.userId, userId)),
  ]);
  return {
    list: list.map((r) => ({
      id: r.id,
      sqlText: r.sqlText,
      durationMs: r.durationMs,
      rowCount: r.rowCount,
      success: r.success,
      errorMessage: r.errorMessage,
      executedAt: formatDateTime(r.executedAt),
    })),
    total,
    page,
    pageSize,
  };
}

export async function clearQueryHistory(): Promise<void> {
  const userId = currentUserId();
  await db.delete(dbAdminQueryHistory).where(eq(dbAdminQueryHistory.userId, userId));
}

export async function deleteQueryHistory(id: number): Promise<void> {
  const userId = currentUserId();
  await db.delete(dbAdminQueryHistory)
    .where(and(eq(dbAdminQueryHistory.id, id), eq(dbAdminQueryHistory.userId, userId)));
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────────

/** 在只读事务中执行回调。任何写操作会被 PostgreSQL 直接拒绝。 */
async function runReadOnly<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL TRANSACTION READ ONLY`));
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`));
    await tx.execute(sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${QUERY_TIMEOUT}'`));
    return await callback(tx);
  });
}

/** 将 postgres-js 返回的结果整理为 QueryResult。超过 MAX_ROWS 时截断。 */
function buildQueryResult(rawRows: unknown): QueryResult {
  const arr = rawRows as Array<Record<string, unknown>> & {
    columns?: Array<{ name: string; type?: number; parser?: { name?: string } }>;
  };
  const truncated = arr.length > MAX_ROWS;
  const rows = (truncated ? arr.slice(0, MAX_ROWS) : arr).map(serializeRow);
  // 列信息：优先用 postgres-js 提供的；否则用第一行 keys
  let columns: QueryResult['columns'];
  if (Array.isArray(arr.columns) && arr.columns.length > 0) {
    columns = arr.columns.map((c) => ({
      name: c.name,
      dataType: c.parser?.name ?? String(c.type ?? ''),
    }));
  } else if (rows[0]) {
    columns = Object.keys(rows[0]).map((n) => ({ name: n, dataType: '' }));
  } else {
    columns = [];
  }
  return { columns, rows, rowCount: arr.length, durationMs: 0, truncated };
}

/** 行序列化：将 Date/Buffer/复杂对象转为可 JSON 化的形式。 */
function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = serializeCell(row[key]);
  }
  return out;
}

function serializeCell(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return formatDateTime(value);
  if (Buffer.isBuffer(value)) return String.raw`\x` + value.toString('hex');
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function csvEscape(value: unknown): string {
  if (value == null) return '';
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    str = String(value);
  } else {
    str = JSON.stringify(value);
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

async function recordHistory(params: {
  sqlText: string; durationMs: number; rowCount: number;
  success: boolean; errorMessage: string | null;
}): Promise<void> {
  try {
    const userId = currentUserId();
    await db.insert(dbAdminQueryHistory).values({
      userId,
      sqlText: params.sqlText.slice(0, 50000),
      durationMs: params.durationMs,
      rowCount: params.rowCount,
      success: params.success,
      errorMessage: params.errorMessage?.slice(0, 5000) ?? null,
    });
  } catch (err) {
    logger.warn('记录 SQL 历史失败', { err: err instanceof Error ? err.message : err });
  }
}
