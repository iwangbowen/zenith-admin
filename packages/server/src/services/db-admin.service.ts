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
import { db, pgClient } from '../db';
import type { DbExecutor } from '../db/types';
import { dbAdminQueryHistory, dbQueryFavorites } from '../db/schema';
import { currentUserId } from '../lib/context';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
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
  kind: 'table' | 'view' | 'matview';
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
  /** 是否服务端分页（单条 SELECT/WITH 自动启用）；false 时为整段执行 + 5000 行硬截断 */
  paginated: boolean;
  /** 分页时的总行数；非分页为 null */
  total: number | null;
  page: number | null;
  pageSize: number | null;
}

// ─── 工具：标识符白名单校验 ────────────────────────────────────────────────────
const IDENT_PATTERN = /^[A-Za-z_]\w*$/;

export function assertIdent(value: string, label: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new HTTPException(400, { message: `非法的${label}：${value}` });
  }
}

export function quoteIdent(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

// ─── 1. 表列表 ──────────────────────────────────────────────────────────────────
const RELKIND_TO_KIND: Record<string, TableItem['kind']> = {
  r: 'table', p: 'table', v: 'view', m: 'matview',
};

export async function listTables(): Promise<TableItem[]> {
  const hidden = Array.from(HIDDEN_SCHEMAS).map((s) => `'${s}'`).join(', ');
  const rows = await db.execute(sql.raw(`
    SELECT n.nspname AS schema,
           c.relname AS name,
           c.relkind AS relkind,
           GREATEST(COALESCE(c.reltuples, 0), 0)::bigint AS row_estimate,
           pg_total_relation_size(c.oid)::bigint AS size_bytes,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size_text,
           obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm')
      AND n.nspname NOT IN (${hidden})
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT LIKE 'pg_toast_temp_%'
    ORDER BY n.nspname, c.relname
  `));
  return (rows as unknown as Array<{
    schema: string; name: string; relkind: string; row_estimate: string | number;
    size_bytes: string | number; size_text: string; comment: string | null;
  }>).map((r) => ({
    schema: r.schema,
    name: r.name,
    kind: RELKIND_TO_KIND[r.relkind] ?? 'table',
    rowEstimate: Number(r.row_estimate),
    sizeBytes: Number(r.size_bytes),
    sizeText: r.size_text,
    comment: r.comment,
  }));
}

// ─── 1b. 数据库总览 ──────────────────────────────────────────────────────────────
export interface OverviewTopTable {
  schema: string;
  name: string;
  sizeBytes: number;
  sizeText: string;
  rowEstimate: number;
}

export interface DbOverview {
  version: string;
  databaseName: string;
  databaseSize: number;
  databaseSizeText: string;
  schemaCount: number;
  tableCount: number;
  viewCount: number;
  indexCount: number;
  totalRowEstimate: number;
  activeConnections: number;
  maxConnections: number;
  startedAt: string | null;
  uptimeSeconds: number;
  topTables: OverviewTopTable[];
}

/** 数据库总览：版本、容量、对象计数、连接数、Top 表 */
export async function getOverview(): Promise<DbOverview> {
  const hidden = Array.from(HIDDEN_SCHEMAS).map((s) => `'${s}'`).join(', ');
  const [summaryRows, topRows] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        current_setting('server_version') AS version,
        current_database() AS database_name,
        pg_database_size(current_database())::bigint AS database_size,
        pg_size_pretty(pg_database_size(current_database())) AS database_size_text,
        current_setting('max_connections')::int AS max_connections,
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS active_connections,
        EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_seconds,
        pg_postmaster_start_time() AS started_at,
        (SELECT count(*) FROM pg_namespace n
           WHERE n.nspname NOT IN (${hidden})
             AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%')::int AS schema_count,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('r','p') AND n.nspname NOT IN (${hidden}))::int AS table_count,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('v','m') AND n.nspname NOT IN (${hidden}))::int AS view_count,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind = 'i' AND n.nspname NOT IN (${hidden}))::int AS index_count,
        (SELECT COALESCE(sum(GREATEST(c.reltuples, 0)), 0) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('r','p') AND n.nspname NOT IN (${hidden}))::bigint AS total_row_estimate
    `)),
    db.execute(sql.raw(`
      SELECT n.nspname AS schema, c.relname AS name,
             pg_total_relation_size(c.oid)::bigint AS size_bytes,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS size_text,
             GREATEST(COALESCE(c.reltuples, 0), 0)::bigint AS row_estimate
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p','m') AND n.nspname NOT IN (${hidden})
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 10
    `)),
  ]);

  const s = (summaryRows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  const startedAtRaw = s.started_at;
  const topTables: OverviewTopTable[] = (topRows as unknown as Array<{
    schema: string; name: string; size_bytes: string | number; size_text: string; row_estimate: string | number;
  }>).map((r) => ({
    schema: r.schema,
    name: r.name,
    sizeBytes: Number(r.size_bytes),
    sizeText: r.size_text,
    rowEstimate: Number(r.row_estimate),
  }));

  return {
    version: String(s.version ?? ''),
    databaseName: String(s.database_name ?? ''),
    databaseSize: Number(s.database_size ?? 0),
    databaseSizeText: String(s.database_size_text ?? ''),
    schemaCount: Number(s.schema_count ?? 0),
    tableCount: Number(s.table_count ?? 0),
    viewCount: Number(s.view_count ?? 0),
    indexCount: Number(s.index_count ?? 0),
    totalRowEstimate: Number(s.total_row_estimate ?? 0),
    activeConnections: Number(s.active_connections ?? 0),
    maxConnections: Number(s.max_connections ?? 0),
    startedAt: startedAtRaw instanceof Date ? formatDateTime(startedAtRaw) : formatNullableDateTime(startedAtRaw as string | null),
    uptimeSeconds: Number(s.uptime_seconds ?? 0),
    topTables,
  };
}
export interface ErDiagramFk {
  schema: string;
  table: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
}

export interface ErDiagramColumn {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
}

export interface ErDiagramTable {
  schema: string;
  name: string;
  columns: ErDiagramColumn[];
}

export interface ErDiagramSchema {
  tables: ErDiagramTable[];
  foreignKeys: ErDiagramFk[];
}

/** 一次性读取数据库内所有用户表 + 列 + 主键标记，用于 ER 图渲染 */
export async function getErSchema(): Promise<ErDiagramSchema> {
  const [tableRows, foreignKeys] = await Promise.all([
    db.execute(sql`
      SELECT ns.nspname AS schema,
             cls.relname AS "table",
             a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type,
             COALESCE(pk.is_pk, FALSE) AS is_primary_key,
             a.attnum AS attnum
      FROM pg_class cls
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      JOIN pg_attribute a ON a.attrelid = cls.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN LATERAL (
        SELECT TRUE AS is_pk
        FROM pg_index i
        WHERE i.indrelid = cls.oid
          AND i.indisprimary
          AND a.attnum = ANY (i.indkey)
        LIMIT 1
      ) pk ON TRUE
      WHERE cls.relkind IN ('r', 'p')
        AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY ns.nspname, cls.relname, a.attnum
    `),
    listAllForeignKeys(),
  ]);

  const tablesMap = new Map<string, ErDiagramTable>();
  (tableRows as unknown as Array<{
    schema: string; table: string; column_name: string; data_type: string; is_primary_key: boolean;
  }>).forEach((r) => {
    const key = `${r.schema}.${r.table}`;
    let t = tablesMap.get(key);
    if (!t) {
      t = { schema: r.schema, name: r.table, columns: [] };
      tablesMap.set(key, t);
    }
    t.columns.push({
      name: r.column_name,
      dataType: r.data_type,
      isPrimaryKey: r.is_primary_key,
    });
  });

  return {
    tables: Array.from(tablesMap.values()),
    foreignKeys,
  };
}

/** 一次性读取数据库内所有外键关系，用于 ER 图渲染 */
export async function listAllForeignKeys(): Promise<ErDiagramFk[]> {
  const rows = await db.execute(sql`
    SELECT ns.nspname AS schema,
           cls.relname AS "table",
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
           ) AS referenced_columns
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
    JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
    WHERE con.contype = 'f'
      AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY ns.nspname, cls.relname, con.conname
  `);
  return (rows as unknown as Array<{
    schema: string; table: string; columns: string[];
    referenced_schema: string; referenced_table: string; referenced_columns: string[];
  }>).map((r) => ({
    schema: r.schema,
    table: r.table,
    columns: r.columns ?? [],
    referencedSchema: r.referenced_schema,
    referencedTable: r.referenced_table,
    referencedColumns: r.referenced_columns ?? [],
  }));
}

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
  /** 全列模糊搜索关键字（对所有列 col::text ILIKE %kw% 取 OR） */
  search?: string;
}

export async function getTableRows(params: RowsParams): Promise<{
  list: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const { schema, name, page, pageSize, orderBy, orderDir = 'asc', filters, search } = params;
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');

  // 收集需要校验存在性的列（orderBy + filters 列名），一次性查 information_schema
  const filterEntries: Array<[string, string]> = filters
    ? Object.entries(filters).filter(([, v]) => typeof v === 'string' && v.length > 0)
    : [];
  if (orderBy) assertIdent(orderBy, 'orderBy');
  for (const [col] of filterEntries) assertIdent(col, 'filter列');

  const colsToCheck = Array.from(
    new Set<string>([
      ...(orderBy ? [orderBy] : []),
      ...filterEntries.map(([c]) => c),
    ]),
  );
  if (colsToCheck.length > 0) {
    const validCols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${name}
        AND column_name IN (${sql.join(colsToCheck.map((c) => sql`${c}`), sql`, `)})
    `);
    const validSet = new Set(
      (validCols as unknown as Array<{ column_name: string }>).map((r) => r.column_name),
    );
    if (orderBy && !validSet.has(orderBy)) {
      throw new HTTPException(400, { message: `列不存在：${orderBy}` });
    }
    for (const [col] of filterEntries) {
      if (!validSet.has(col)) throw new HTTPException(400, { message: `筛选列不存在：${col}` });
    }
  }

  const fullName = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const offset = (page - 1) * pageSize;
  const dir = orderDir === 'desc' ? 'DESC' : 'ASC';

  // 未指定排序时回退到主键 ASC，避免 UPDATE 后行的物理顺序漂移
  let effectiveOrderClause: ReturnType<typeof sql.raw> = sql.raw('');
  if (orderBy) {
    effectiveOrderClause = sql.raw(`ORDER BY ${quoteIdent(orderBy)} ${dir}`);
  } else {
    const pkRows = await db.execute(sql`
      SELECT a.attname AS col
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ${`${schema}.${name}`}::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)
    `);
    const pkCols = (pkRows as unknown as Array<{ col: string }>).map((r) => r.col);
    if (pkCols.length > 0) {
      const orderExpr = pkCols.map((c) => quoteIdent(c) + ' ASC').join(', ');
      effectiveOrderClause = sql.raw(`ORDER BY ${orderExpr}`);
    }
  }
  const orderClause = effectiveOrderClause;

  // 全列模糊搜索：对该表所有列做 col::text ILIKE %kw% 的 OR 组合
  let searchCond: ReturnType<typeof sql> | null = null;
  const searchKw = search?.trim();
  if (searchKw) {
    const allColsRows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${name}
      ORDER BY ordinal_position
    `);
    const allCols = (allColsRows as unknown as Array<{ column_name: string }>).map((r) => r.column_name);
    if (allCols.length > 0) {
      const ors = allCols.map((col) => sql`${sql.raw(quoteIdent(col))}::text ILIKE ${'%' + searchKw + '%'}`);
      searchCond = sql`(${sql.join(ors, sql.raw(' OR '))})`;
    }
  }

  const whereSql = (() => {
    const OP_RE = /^(eq|neq|gt|gte|lt|lte|like|ilike|isnull|notnull)\|([\s\S]*)$/;
    const parsed = filterEntries
      .map(([col, raw]) => {
        const m = OP_RE.exec(raw);
        if (m) return { col, op: m[1], val: m[2] };
        return { col, op: 'ilike', val: raw };
      })
      .filter((f) => {
        if (f.op === 'isnull' || f.op === 'notnull') return true;
        return f.val.length > 0;
      });
    const conds = parsed.map(({ col, op, val }) => {
      const c = sql.raw(quoteIdent(col));
      switch (op) {
        case 'eq': return sql`${c}::text = ${val}`;
        case 'neq': return sql`${c}::text <> ${val}`;
        case 'gt': return sql`${c} > ${val}`;
        case 'gte': return sql`${c} >= ${val}`;
        case 'lt': return sql`${c} < ${val}`;
        case 'lte': return sql`${c} <= ${val}`;
        case 'like': return sql`${c}::text LIKE ${'%' + val + '%'}`;
        case 'ilike': return sql`${c}::text ILIKE ${'%' + val + '%'}`;
        case 'isnull': return sql`${c} IS NULL`;
        case 'notnull': return sql`${c} IS NOT NULL`;
      }
    });
    if (searchCond) conds.push(searchCond);
    if (conds.length === 0) return sql.raw('');
    return sql`WHERE ${sql.join(conds, sql.raw(' AND '))}`;
  })();

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

// ─── 3.5. 表数据写入（INSERT / UPDATE / DELETE） ────────────────────────────────
/** 禁止写入的 schema（系统 / 元数据） */
const SCHEMA_FORBIDDEN_WRITE = new Set<string>([
  'pg_catalog', 'information_schema', 'pg_toast', 'drizzle',
]);
/** 禁止写入的表（{schema}.{name}） */
const TABLE_FORBIDDEN_WRITE = new Set<string>([
  'public.db_admin_query_history',
  'public.audit_logs',
  'public.__drizzle_migrations',
]);

function assertWritable(schema: string, name: string): void {
  if (SCHEMA_FORBIDDEN_WRITE.has(schema)) {
    throw new HTTPException(403, { message: `禁止写入系统 schema：${schema}` });
  }
  if (TABLE_FORBIDDEN_WRITE.has(`${schema}.${name}`)) {
    throw new HTTPException(403, { message: `禁止写入系统表：${schema}.${name}` });
  }
}

/** 把前端传来的 JSON 值转为带 cast 的 SQL 片段；null/undefined → NULL */
function toBoundSql(value: unknown, dataType: string): ReturnType<typeof sql> {
  if (value === null || value === undefined) return sql.raw('NULL');
  let bound: unknown = value;
  if (typeof value === 'object') {
    // jsonb / array / 其他对象：以 JSON 字符串传入，由 PG ::dataType cast
    bound = JSON.stringify(value);
  }
  // dataType 来自 format_type()，对 PG 是安全的合法类型字面量
  return sql`${bound}::${sql.raw(dataType)}`;
}

export async function insertTableRow(
  schema: string, name: string, values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');
  assertWritable(schema, name);

  const struct = await getTableStructure(schema, name);
  const colMap = new Map(struct.columns.map((c) => [c.name, c]));
  const entries = Object.entries(values).filter(([col]) => colMap.has(col));
  if (entries.length === 0) {
    throw new HTTPException(400, { message: '至少需要一个有效字段' });
  }
  for (const [col] of entries) assertIdent(col, '列名');

  const cols = entries.map(([c]) => sql.raw(quoteIdent(c)));
  const vals = entries.map(([c, v]) => toBoundSql(v, colMap.get(c)!.dataType));
  const full = sql.raw(`${quoteIdent(schema)}.${quoteIdent(name)}`);

  try {
    const inserted = await db.execute(sql`
      INSERT INTO ${full} (${sql.join(cols, sql.raw(', '))})
      VALUES (${sql.join(vals, sql.raw(', '))})
      RETURNING *
    `);
    const row = (inserted as unknown as Array<Record<string, unknown>>)[0];
    return serializeRow(row ?? {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `插入失败：${msg}` });
  }
}

export async function updateTableRow(
  schema: string, name: string,
  pkValues: Record<string, unknown>,
  changes: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');
  assertWritable(schema, name);

  const struct = await getTableStructure(schema, name);
  if (struct.primaryKey.length === 0) {
    throw new HTTPException(400, { message: '该表没有主键，无法编辑' });
  }
  const colMap = new Map(struct.columns.map((c) => [c.name, c]));
  const pkCols = struct.primaryKey;
  for (const pk of pkCols) {
    if (!(pk in pkValues)) throw new HTTPException(400, { message: `缺少主键值：${pk}` });
    assertIdent(pk, '主键列');
  }
  const changeEntries = Object.entries(changes).filter(
    ([col]) => colMap.has(col) && !pkCols.includes(col),
  );
  if (changeEntries.length === 0) {
    throw new HTTPException(400, { message: '没有可更新的字段' });
  }
  for (const [col] of changeEntries) assertIdent(col, '列名');

  const sets = changeEntries.map(
    ([c, v]) => sql`${sql.raw(quoteIdent(c))} = ${toBoundSql(v, colMap.get(c)!.dataType)}`,
  );
  const wheres = pkCols.map(
    (c) => sql`${sql.raw(quoteIdent(c))} = ${toBoundSql(pkValues[c], colMap.get(c)!.dataType)}`,
  );
  const full = sql.raw(`${quoteIdent(schema)}.${quoteIdent(name)}`);

  try {
    const updated = await db.execute(sql`
      UPDATE ${full} SET ${sql.join(sets, sql.raw(', '))}
      WHERE ${sql.join(wheres, sql.raw(' AND '))}
      RETURNING *
    `);
    const row = (updated as unknown as Array<Record<string, unknown>>)[0];
    if (!row) throw new HTTPException(404, { message: '记录不存在或未更新' });
    return serializeRow(row);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `更新失败：${msg}` });
  }
}

export async function getTableRowBeforeAudit(
  schema: string,
  name: string,
  pkValues: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');

  const struct = await getTableStructure(schema, name);
  if (struct.primaryKey.length === 0) {
    throw new HTTPException(400, { message: '该表没有主键，无法定位记录' });
  }
  const colMap = new Map(struct.columns.map((c) => [c.name, c]));
  const pkCols = struct.primaryKey;
  for (const pk of pkCols) {
    if (!(pk in pkValues)) throw new HTTPException(400, { message: `缺少主键值：${pk}` });
    assertIdent(pk, '主键列');
  }
  const wheres = pkCols.map(
    (c) => sql`${sql.raw(quoteIdent(c))} = ${toBoundSql(pkValues[c], colMap.get(c)!.dataType)}`,
  );
  const full = sql.raw(`${quoteIdent(schema)}.${quoteIdent(name)}`);
  const rows = await db.execute(sql`
    SELECT * FROM ${full}
    WHERE ${sql.join(wheres, sql.raw(' AND '))}
    LIMIT 1
  `);
  const row = (rows as unknown as Array<Record<string, unknown>>)[0];
  return row ? serializeRow(row) : null;
}

export async function deleteTableRow(
  schema: string, name: string, pkValues: Record<string, unknown>,
): Promise<void> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');
  assertWritable(schema, name);

  const struct = await getTableStructure(schema, name);
  if (struct.primaryKey.length === 0) {
    throw new HTTPException(400, { message: '该表没有主键，无法删除' });
  }
  const colMap = new Map(struct.columns.map((c) => [c.name, c]));
  const pkCols = struct.primaryKey;
  for (const pk of pkCols) {
    if (!(pk in pkValues)) throw new HTTPException(400, { message: `缺少主键值：${pk}` });
    assertIdent(pk, '主键列');
  }
  const wheres = pkCols.map(
    (c) => sql`${sql.raw(quoteIdent(c))} = ${toBoundSql(pkValues[c], colMap.get(c)!.dataType)}`,
  );
  const full = sql.raw(`${quoteIdent(schema)}.${quoteIdent(name)}`);

  try {
    const deleted = await db.execute(sql`
      DELETE FROM ${full} WHERE ${sql.join(wheres, sql.raw(' AND '))}
      RETURNING 1
    `);
    if ((deleted as unknown as Array<unknown>).length === 0) {
      throw new HTTPException(404, { message: '记录不存在' });
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `删除失败：${msg}` });
  }
}

// ─── 3.6. 批量数据导入（CSV / JSON） ────────────────────────────────────────────
const MAX_IMPORT_ROWS = 100_000;

export async function importTableData(
  schema: string,
  name: string,
  rows: Array<Record<string, unknown>>,
): Promise<{ inserted: number }> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');
  assertWritable(schema, name);

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new HTTPException(400, { message: '没有可导入的数据' });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new HTTPException(400, { message: `单次导入最多 ${MAX_IMPORT_ROWS} 行` });
  }

  const struct = await getTableStructure(schema, name);
  const colMap = new Map(struct.columns.map((c) => [c.name, c]));
  // 收集所有行出现过且属于该表的列
  const usedCols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((c) => colMap.has(c));
  if (usedCols.length === 0) {
    throw new HTTPException(400, { message: '导入数据的列与表结构不匹配' });
  }
  for (const c of usedCols) assertIdent(c, '列名');

  const full = sql.raw(`${quoteIdent(schema)}.${quoteIdent(name)}`);
  const colList = sql.join(usedCols.map((c) => sql.raw(quoteIdent(c))), sql.raw(', '));
  // 控制单条 INSERT 的绑定参数数量（PG 上限 65535）
  const batchSize = Math.max(1, Math.min(500, Math.floor(60000 / usedCols.length)));

  let inserted = 0;
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += batchSize) {
        const slice = rows.slice(i, i + batchSize);
        const valuesSql = slice.map((row) => {
          const cells = usedCols.map((c) =>
            toBoundSql(row[c] === undefined ? null : row[c], colMap.get(c)!.dataType),
          );
          return sql`(${sql.join(cells, sql.raw(', '))})`;
        });
        await tx.execute(sql`INSERT INTO ${full} (${colList}) VALUES ${sql.join(valuesSql, sql.raw(', '))}`);
        inserted += slice.length;
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `导入失败（已回滚，未写入任何数据）：${msg}` });
  }
  return { inserted };
}


/** 运行中查询的 backend pid 注册表：queryId -> pid，用于取消 */
const runningQueries = new Map<string, number>();

/** 判断是否为可分页的单条 SELECT/WITH 查询（无内部分号、无尾分号） */
function isPaginatableSelect(trimmed: string): boolean {
  if (/;/.test(trimmed)) return false;
  return /^(select|with)\b/i.test(trimmed);
}

export interface QueryOptions {
  queryId?: string;
  page?: number;
  pageSize?: number;
}

export async function executeReadonlyQuery(sqlText: string, options: QueryOptions = {}): Promise<QueryResult> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) {
    throw new HTTPException(400, { message: 'SQL 不能为空' });
  }

  const { queryId, page, pageSize } = options;
  const wantPagination = page != null && pageSize != null && pageSize > 0 && isPaginatableSelect(trimmed);

  const start = Date.now();
  let success = false;
  let errorMessage: string | null = null;
  let result: QueryResult = {
    columns: [], rows: [], rowCount: 0, durationMs: 0, truncated: false,
    paginated: false, total: null, page: null, pageSize: null,
  };

  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL TRANSACTION READ ONLY`));
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`));
      await tx.execute(sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${QUERY_TIMEOUT}'`));
      // 记录当前事务连接的 backend pid，用于取消
      if (queryId) {
        const pidRows = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        const pid = Number((pidRows as unknown as Array<{ pid: number }>)[0]?.pid);
        if (pid) runningQueries.set(queryId, pid);
      }

      if (wantPagination) {
        const offset = (page! - 1) * pageSize!;
        const [listRows, countRows] = await Promise.all([
          tx.execute(sql.raw(`SELECT * FROM (${trimmed}) AS _sub LIMIT ${pageSize} OFFSET ${offset}`)),
          tx.execute(sql.raw(`SELECT count(*)::bigint AS c FROM (${trimmed}) AS _sub`)),
        ]);
        const total = Number((countRows as unknown as Array<{ c: string | number }>)[0]?.c ?? 0);
        const built = buildQueryResult(listRows);
        return {
          ...built,
          rowCount: built.rows.length,
          truncated: false,
          paginated: true,
          total,
          page: page!,
          pageSize: pageSize!,
        };
      }

      const rows = await tx.execute(sql.raw(trimmed));
      return buildQueryResult(rows);
    });
    success = true;
    return result;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    // 取消导致的错误：PG 原始信息常位于 error.cause 链中
    const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
    if (/canceling statement due to user request/i.test(`${errorMessage} ${causeMsg}`)) {
      throw new HTTPException(400, { message: '查询已取消' });
    }
    throw new HTTPException(400, { message: `SQL 执行失败：${errorMessage}` });
  } finally {
    if (queryId) runningQueries.delete(queryId);
    const durationMs = Date.now() - start;
    result.durationMs = durationMs;
    await recordHistory({ sqlText: trimmed, durationMs, rowCount: result.rowCount, success, errorMessage });
  }
}

/** 取消正在执行的查询（按客户端提交的 queryId 定位 backend pid） */
export async function cancelQuery(queryId: string): Promise<boolean> {
  const pid = runningQueries.get(queryId);
  if (!pid) return false;
  const rows = await db.execute(sql`SELECT pg_cancel_backend(${pid}) AS ok`);
  return Boolean((rows as unknown as Array<{ ok: boolean }>)[0]?.ok);
}

// ─── 5. EXPLAIN ────────────────────────────────────────────────────────────────
export async function explainQuery(
  sqlText: string,
  analyze = false,
): Promise<{ plan: unknown; durationMs: number; analyzed: boolean }> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new HTTPException(400, { message: 'SQL 不能为空' });

  // EXPLAIN ANALYZE 会真正执行查询；只读事务会拒绝任何写操作，SELECT 安全
  const options = analyze
    ? 'ANALYZE, BUFFERS, FORMAT JSON'
    : 'FORMAT JSON';

  const start = Date.now();
  try {
    const plan = await runReadOnly(async (tx) => {
      const rows = await tx.execute(sql.raw(`EXPLAIN (${options}) ${trimmed}`));
      const first = (rows as unknown as Array<Record<string, unknown>>)[0];
      // PostgreSQL 返回的字段名是 'QUERY PLAN'，是个数组
      const planValue = first?.['QUERY PLAN'] ?? first?.['query plan'] ?? first;
      return Array.isArray(planValue) ? planValue[0] : planValue;
    });
    return { plan, durationMs: Date.now() - start, analyzed: analyze };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `EXPLAIN 失败：${msg}` });
  }
}

// ─── 6. 导出 CSV ────────────────────────────────────────────────────────────────
export async function exportQueryCsv(sqlText: string): Promise<ReadableStream<Uint8Array>> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new HTTPException(400, { message: 'SQL 不能为空' });

  const encoder = new TextEncoder();
  const BATCH_SIZE = 1000;

  // 用底层 postgres-js client：begin() 内开启只读事务 + cursor() 分批读取，
  // 避免一次性把全部结果集载入内存，导出 100w 行也只需 ~ batch 大小的临时空间。
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let headersWritten = false;
      let headerKeys: string[] = [];
      try {
        await pgClient.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL TRANSACTION READ ONLY`);
          await tx.unsafe(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`);
          await tx.unsafe(`SET LOCAL idle_in_transaction_session_timeout = '${QUERY_TIMEOUT}'`);
          const cursor = tx.unsafe(trimmed).cursor(BATCH_SIZE);
          for await (const rows of cursor) {
            if (!Array.isArray(rows) || rows.length === 0) continue;
            if (!headersWritten) {
              headerKeys = Object.keys(rows[0] as Record<string, unknown>);
              controller.enqueue(encoder.encode('\uFEFF' + headerKeys.map(csvEscape).join(',') + '\n'));
              headersWritten = true;
            }
            const chunk: string[] = [];
            for (const row of rows as Array<Record<string, unknown>>) {
              chunk.push(headerKeys.map((h) => csvEscape(serializeCell(row[h]))).join(','));
            }
            controller.enqueue(encoder.encode(chunk.join('\n') + '\n'));
          }
          if (!headersWritten) {
            controller.enqueue(encoder.encode('\uFEFF'));
          }
        });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.error(new HTTPException(400, { message: `导出失败：${msg}` }));
      }
    },
  });
}

// ─── 6b. 导出表数据 CSV ─────────────────────────────────────────────────────────
/** 将整表数据以流式 CSV 导出，内部复用 exportQueryCsv */
export async function exportTableDataCsv(
  schema: string,
  name: string,
): Promise<ReadableStream<Uint8Array>> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');
  return exportQueryCsv(`SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(name)}`);
}

// ─── 6a. 导出查询结果 JSON ───────────────────────────────────────────────────────
/** 将查询结果以流式 JSON 数组导出，分批游标读取避免内存峰值 */
export async function exportQueryJson(sqlText: string): Promise<ReadableStream<Uint8Array>> {
  const trimmed = sqlText.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new HTTPException(400, { message: 'SQL 不能为空' });

  const encoder = new TextEncoder();
  const BATCH_SIZE = 1000;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let first = true;
      try {
        controller.enqueue(encoder.encode('['));
        await pgClient.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL TRANSACTION READ ONLY`);
          await tx.unsafe(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`);
          await tx.unsafe(`SET LOCAL idle_in_transaction_session_timeout = '${QUERY_TIMEOUT}'`);
          const cursor = tx.unsafe(trimmed).cursor(BATCH_SIZE);
          for await (const rows of cursor) {
            if (!Array.isArray(rows) || rows.length === 0) continue;
            const chunk: string[] = [];
            for (const row of rows as Array<Record<string, unknown>>) {
              chunk.push(JSON.stringify(serializeRow(row)));
            }
            controller.enqueue(encoder.encode((first ? '' : ',') + chunk.join(',')));
            first = false;
          }
        });
        controller.enqueue(encoder.encode(']'));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.error(new HTTPException(400, { message: `导出失败：${msg}` }));
      }
    },
  });
}

// ─── 6c. 导出表 SQL (DDL / INSERT / 完整) ────────────────────────────────────────

/** 将值转换为 PostgreSQL SQL 字面量，用于生成 INSERT 语句 */
function toSqlLiteral(value: unknown, dataType: string): string {
  if (value === null || value === undefined) return 'NULL';

  const dt = dataType.toLowerCase();

  // 数值型：直接输出，不加引号
  if (
    typeof value === 'number' ||
    dt === 'integer' || dt === 'int' || dt === 'int2' || dt === 'int4' || dt === 'int8' ||
    dt === 'bigint' || dt === 'smallint' || dt === 'serial' || dt === 'bigserial' ||
    dt === 'real' || dt === 'double precision' || dt === 'float4' || dt === 'float8' ||
    dt.startsWith('numeric') || dt.startsWith('decimal')
  ) {
    return typeof value === 'number' ? String(value) : JSON.stringify(value);
  }

  // 布尔型
  if (typeof value === 'boolean' || dt === 'boolean' || dt === 'bool') {
    return value ? 'TRUE' : 'FALSE';
  }

  // 字符串型：转义单引号
  const str = typeof value === 'object' ? JSON.stringify(value) : `${value as string | number | boolean}`;
  const escaped = str.replaceAll("'", "''");

  // jsonb / json：加类型转换
  if (dt === 'jsonb' || dt === 'json') {
    return `'${escaped}'::${dt}`;
  }

  return `'${escaped}'`;
}

/** 生成 CREATE TABLE DDL（含索引和外键） */
function buildTableDdl(schema: string, name: string, structure: TableStructure): string {
  const fullName = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const parts: string[] = [`-- DDL: ${schema}.${name}`];

  const colDefs: string[] = structure.columns.map((col) => {
    let line = `  ${quoteIdent(col.name)} ${col.dataType}`;
    if (!col.isNullable) line += ' NOT NULL';
    if (col.defaultValue !== null) line += ` DEFAULT ${col.defaultValue}`;
    if (col.comment) line += ` -- ${col.comment.replaceAll('\n', ' ')}`;
    return line;
  });

  if (structure.primaryKey.length > 0) {
    colDefs.push(`  PRIMARY KEY (${structure.primaryKey.map(quoteIdent).join(', ')})`);
  }

  const tableDef = [
    `CREATE TABLE IF NOT EXISTS ${fullName} (`,
    colDefs.join(',\n'),
    ');',
  ].join('\n');
  parts.push(tableDef);

  // 非主键索引
  for (const idx of structure.indexes) {
    if (!idx.isPrimary) {
      parts.push(`${idx.definition};`);
    }
  }

  // 外键
  for (const fk of structure.foreignKeys) {
    const cols = fk.columns.map(quoteIdent).join(', ');
    const refCols = fk.referencedColumns.map(quoteIdent).join(', ');
    const refTable = `${quoteIdent(fk.referencedSchema)}.${quoteIdent(fk.referencedTable)}`;
    parts.push(
      `ALTER TABLE ${fullName} ADD CONSTRAINT ${quoteIdent(fk.name)} ` +
      `FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols}) ` +
      `ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete};`,
    );
  }

  return parts.join('\n\n');
}

export type SqlExportMode = 'ddl' | 'data' | 'full';

/**
 * 以流式方式导出表的 SQL 文件。
 * - mode=ddl  : CREATE TABLE + 索引 + 外键
 * - mode=data : INSERT INTO 语句
 * - mode=full : DDL + 数据
 */
export async function exportTableSql(
  schema: string,
  name: string,
  mode: SqlExportMode,
): Promise<ReadableStream<Uint8Array>> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');

  const structure = await getTableStructure(schema, name);
  const colNames = structure.columns.map((c) => c.name);
  const colTypes = new Map(structure.columns.map((c) => [c.name, c.dataType]));
  const fullName = `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const encoder = new TextEncoder();
  const BATCH_SIZE = 500;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (s: string) => controller.enqueue(encoder.encode(s));

      try {
        emit(`-- SQL export: ${schema}.${name}\n`);
        emit(`-- Generated: ${new Date().toISOString()}\n\n`);

        // ── DDL 部分 ────────────────────────────────────────────────────────
        if (mode === 'ddl' || mode === 'full') {
          emit(buildTableDdl(schema, name, structure));
          emit('\n');
        }

        // ── INSERT 数据部分 ──────────────────────────────────────────────────
        if (mode === 'data' || mode === 'full') {
          if (mode === 'full') emit('\n');

          await pgClient.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL TRANSACTION READ ONLY`);
            await tx.unsafe(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`);
            const cursor = tx.unsafe(`SELECT * FROM ${fullName}`).cursor(BATCH_SIZE);
            const colHeader = colNames.map(quoteIdent).join(', ');

            for await (const rows of cursor) {
              if (!Array.isArray(rows) || rows.length === 0) continue;
              for (const row of rows as Array<Record<string, unknown>>) {
                const vals = colNames.map((c) =>
                  toSqlLiteral(row[c], colTypes.get(c) ?? 'text'),
                ).join(', ');
                emit(`INSERT INTO ${fullName} (${colHeader}) VALUES (${vals});\n`);
              }
            }
          });
        }

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.error(new HTTPException(400, { message: `导出 SQL 失败：${msg}` }));
      }
    },
  });
}

// ─── 6d. 截断表 ──────────────────────────────────────────────────────────────────
const FORBIDDEN_TRUNCATE_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast', 'drizzle']);
const FORBIDDEN_TRUNCATE_TABLES = new Set([
  'public.db_admin_query_history',
  'public.audit_logs',
  'public.__drizzle_migrations',
]);

/** TRUNCATE TABLE — 清空整张表数据，不可恢复 */
export async function truncateTable(schema: string, name: string): Promise<void> {
  assertIdent(schema, 'schema');
  assertIdent(name, 'table');
  if (FORBIDDEN_TRUNCATE_SCHEMAS.has(schema)) {
    throw new HTTPException(403, { message: '禁止操作系统 schema' });
  }
  if (FORBIDDEN_TRUNCATE_TABLES.has(`${schema}.${name}`)) {
    throw new HTTPException(403, { message: '禁止操作该系统表' });
  }
  await db.execute(sql.raw(`TRUNCATE TABLE ${quoteIdent(schema)}.${quoteIdent(name)}`));
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

export async function getQueryHistoryBeforeAudit(id: number) {
  const userId = currentUserId();
  const [row] = await db.select().from(dbAdminQueryHistory)
    .where(and(eq(dbAdminQueryHistory.id, id), eq(dbAdminQueryHistory.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    sqlText: row.sqlText,
    durationMs: row.durationMs,
    rowCount: row.rowCount,
    success: row.success,
    errorMessage: row.errorMessage,
    executedAt: formatDateTime(row.executedAt),
  };
}

export async function getQueryHistoryClearBeforeAudit() {
  const userId = currentUserId();
  const [total, rows] = await Promise.all([
    db.$count(dbAdminQueryHistory, eq(dbAdminQueryHistory.userId, userId)),
    db.select().from(dbAdminQueryHistory)
      .where(eq(dbAdminQueryHistory.userId, userId))
      .orderBy(desc(dbAdminQueryHistory.id))
      .limit(20),
  ]);
  return {
    total,
    sample: rows.map((row) => ({
      id: row.id,
      sqlText: row.sqlText,
      durationMs: row.durationMs,
      rowCount: row.rowCount,
      success: row.success,
      errorMessage: row.errorMessage,
      executedAt: formatDateTime(row.executedAt),
    })),
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

/** 常见 PostgreSQL 类型 OID → 可读类型名，未收录的返回空字符串。 */
const PG_TYPE_NAMES: Record<number, string> = {
  16: 'bool', 17: 'bytea', 18: 'char', 19: 'name', 20: 'int8', 21: 'int2',
  23: 'int4', 25: 'text', 26: 'oid', 114: 'json', 142: 'xml', 600: 'point',
  700: 'float4', 701: 'float8', 829: 'macaddr', 869: 'inet', 650: 'cidr',
  1000: 'bool[]', 1001: 'bytea[]', 1005: 'int2[]', 1007: 'int4[]',
  1009: 'text[]', 1014: 'bpchar[]', 1015: 'varchar[]', 1016: 'int8[]',
  1021: 'float4[]', 1022: 'float8[]', 1028: 'oid[]', 1041: 'inet[]',
  1042: 'bpchar', 1043: 'varchar', 1082: 'date', 1083: 'time',
  1114: 'timestamp', 1115: 'timestamp[]', 1182: 'date[]', 1183: 'time[]',
  1184: 'timestamptz', 1185: 'timestamptz[]', 1186: 'interval', 1187: 'interval[]',
  1231: 'numeric[]', 1700: 'numeric', 2249: 'record', 2278: 'void',
  2950: 'uuid', 2951: 'uuid[]', 3614: 'tsvector', 3615: 'tsquery',
  3802: 'jsonb', 3807: 'jsonb[]', 3904: 'int4range', 3906: 'numrange',
  3908: 'tsrange', 3910: 'tstzrange', 3912: 'daterange', 3926: 'int8range',
};

/** postgres-js 内部解析器名（非真实 PG 类型，需要忽略）。 */
const INTERNAL_PARSER_NAMES = new Set(['transparentParser', 'parse', '']);

function buildQueryResult(rawRows: unknown): QueryResult {
  const arr = rawRows as Array<Record<string, unknown>> & {
    columns?: Array<{ name: string; type?: number; parser?: { name?: string } }>;
  };
  const truncated = arr.length > MAX_ROWS;
  const rows = (truncated ? arr.slice(0, MAX_ROWS) : arr).map(serializeRow);
  // 列信息：优先用 postgres-js 提供的；否则用第一行 keys
  let columns: QueryResult['columns'];
  if (Array.isArray(arr.columns) && arr.columns.length > 0) {
    columns = arr.columns.map((c) => {
      const oid = c.type;
      const mapped = oid == null ? undefined : PG_TYPE_NAMES[oid];
      const parserName = c.parser?.name;
      const fallback = parserName && !INTERNAL_PARSER_NAMES.has(parserName) ? parserName : '';
      let dataType: string;
      if (mapped) {
        dataType = mapped;
      } else if (oid == null) {
        dataType = fallback;
      } else {
        dataType = `oid:${oid}`;
      }
      return { name: c.name, dataType };
    });
  } else if (rows[0]) {
    columns = Object.keys(rows[0]).map((n) => ({ name: n, dataType: '' }));
  } else {
    columns = [];
  }
  return { columns, rows, rowCount: arr.length, durationMs: 0, truncated, paginated: false, total: null, page: null, pageSize: null };
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

// ─── SQL 收藏夹 ────────────────────────────────────────────────────────────────────

import type { DbQueryFavoriteRow } from '../db/schema';

export function mapDbQueryFavorite(row: DbQueryFavoriteRow) {
  return {
    id: row.id,
    name: row.name,
    sql: row.sql,
    description: row.description ?? null,
    tags: row.tags ?? [],
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listQueryFavorites() {
  const userId = currentUserId();
  const rows = await db
    .select()
    .from(dbQueryFavorites)
    .where(eq(dbQueryFavorites.userId, userId))
    .orderBy(desc(dbQueryFavorites.updatedAt));
  return rows.map(mapDbQueryFavorite);
}

export async function getQueryFavoriteBeforeAudit(id: number) {
  const userId = currentUserId();
  const [row] = await db
    .select()
    .from(dbQueryFavorites)
    .where(and(eq(dbQueryFavorites.id, id), eq(dbQueryFavorites.userId, userId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '收藏记录不存在' });
  return mapDbQueryFavorite(row);
}

export async function createQueryFavorite(input: {
  name: string;
  sql: string;
  description?: string;
  tags?: string[];
}) {
  const userId = currentUserId();
  const [row] = await db
    .insert(dbQueryFavorites)
    .values({
      userId,
      name: input.name,
      sql: input.sql,
      description: input.description ?? null,
      tags: input.tags ?? [],
    })
    .returning();
  return mapDbQueryFavorite(row);
}

export async function updateQueryFavorite(
  id: number,
  input: Partial<{ name: string; sql: string; description: string; tags: string[] }>,
) {
  const userId = currentUserId();
  const existing = await db
    .select()
    .from(dbQueryFavorites)
    .where(and(eq(dbQueryFavorites.id, id), eq(dbQueryFavorites.userId, userId)))
    .limit(1);
  if (!existing[0]) throw new HTTPException(404, { message: '收藏记录不存在' });

  const [updated] = await db
    .update(dbQueryFavorites)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.sql === undefined ? {} : { sql: input.sql }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
    })
    .where(and(eq(dbQueryFavorites.id, id), eq(dbQueryFavorites.userId, userId)))
    .returning();
  return mapDbQueryFavorite(updated);
}

export async function deleteQueryFavorite(id: number): Promise<void> {
  const userId = currentUserId();
  await db
    .delete(dbQueryFavorites)
    .where(and(eq(dbQueryFavorites.id, id), eq(dbQueryFavorites.userId, userId)));
}
