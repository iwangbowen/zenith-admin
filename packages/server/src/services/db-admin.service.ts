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
