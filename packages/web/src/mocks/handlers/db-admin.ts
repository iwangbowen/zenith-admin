import { http, HttpResponse } from 'msw';
import { mockDateTime } from '@/mocks/utils/date';

const API = import.meta.env.VITE_API_BASE_URL || '';

// ─── 类型 ──────────────────────────────────────────────────────────────────────
interface MockColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment: string | null;
  maxLength: number | null;
  enumValues: string[] | null;
}

interface MockTableDef {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'matview';
  comment: string | null;
  columns: MockColumn[];
  indexes: Array<{ name: string; columns: string[]; isUnique: boolean; isPrimary: boolean; definition: string }>;
  foreignKeys: Array<{ name: string; columns: string[]; referencedSchema: string; referencedTable: string; referencedColumns: string[]; onUpdate: string; onDelete: string }>;
  rows: Array<Record<string, unknown>>;
}

function col(
  name: string,
  dataType: string,
  opts: Partial<Omit<MockColumn, 'name' | 'dataType'>> = {},
): MockColumn {
  return {
    name,
    dataType,
    isNullable: opts.isNullable ?? false,
    defaultValue: opts.defaultValue ?? null,
    isPrimaryKey: opts.isPrimaryKey ?? false,
    comment: opts.comment ?? null,
    maxLength: opts.maxLength ?? null,
    enumValues: opts.enumValues ?? null,
  };
}

// ─── 模拟数据 ───────────────────────────────────────────────────────────────────
const usersRows: Array<Record<string, unknown>> = Array.from({ length: 42 }, (_, i) => ({
  id: i + 1,
  username: i === 0 ? 'admin' : `user${i + 1}`,
  nickname: i === 0 ? '超级管理员' : `用户${i + 1}`,
  email: i === 0 ? 'admin@zenith.dev' : `user${i + 1}@example.com`,
  status: i % 7 === 0 ? 'disabled' : 'enabled',
  department_id: (i % 5) + 1,
  created_at: mockDateTime(),
}));

const rolesRows: Array<Record<string, unknown>> = [
  { id: 1, name: '超级管理员', code: 'super_admin', sort: 1, status: 'enabled', remark: '拥有全部权限', created_at: mockDateTime() },
  { id: 2, name: '系统管理员', code: 'admin', sort: 2, status: 'enabled', remark: '系统管理', created_at: mockDateTime() },
  { id: 3, name: '普通用户', code: 'user', sort: 3, status: 'enabled', remark: null, created_at: mockDateTime() },
  { id: 4, name: '访客', code: 'guest', sort: 4, status: 'disabled', remark: '只读访客', created_at: mockDateTime() },
];

const menusRows: Array<Record<string, unknown>> = Array.from({ length: 18 }, (_, i) => ({
  id: i + 1,
  parent_id: i < 4 ? 0 : ((i % 4) + 1),
  title: `菜单${i + 1}`,
  name: `Menu${i + 1}`,
  path: `/module-${i + 1}`,
  type: i < 4 ? 'directory' : (i % 3 === 0 ? 'button' : 'menu'),
  permission: i % 3 === 0 ? `system:module${i + 1}:view` : null,
  sort: i + 1,
  status: 'enabled',
  created_at: mockDateTime(),
}));

const operationLogsRows: Array<Record<string, unknown>> = Array.from({ length: 120 }, (_, i) => ({
  id: i + 1,
  username: i % 2 === 0 ? 'admin' : `user${(i % 10) + 1}`,
  module: ['用户管理', '角色管理', '菜单管理', '数据库管理'][i % 4],
  description: ['新增数据', '更新数据', '删除数据', '执行 SQL 查询'][i % 4],
  method: ['POST', 'PATCH', 'DELETE', 'POST'][i % 4],
  duration_ms: 10 + (i % 50) * 3,
  ip: `192.168.1.${(i % 250) + 1}`,
  created_at: mockDateTime(),
}));

const departmentsRows: Array<Record<string, unknown>> = [
  { id: 1, parent_id: 0, name: '总公司', sort: 1, status: 'enabled', created_at: mockDateTime() },
  { id: 2, parent_id: 1, name: '研发部', sort: 1, status: 'enabled', created_at: mockDateTime() },
  { id: 3, parent_id: 1, name: '市场部', sort: 2, status: 'enabled', created_at: mockDateTime() },
  { id: 4, parent_id: 1, name: '财务部', sort: 3, status: 'enabled', created_at: mockDateTime() },
  { id: 5, parent_id: 2, name: '前端组', sort: 1, status: 'enabled', created_at: mockDateTime() },
];

const tables: MockTableDef[] = [
  {
    schema: 'public', name: 'users', kind: 'table', comment: '系统用户表',
    columns: [
      col('id', 'integer', { isPrimaryKey: true, defaultValue: "nextval('users_id_seq'::regclass)", comment: '主键' }),
      col('username', 'character varying', { maxLength: 64, comment: '用户名' }),
      col('nickname', 'character varying', { maxLength: 64, isNullable: true, comment: '昵称' }),
      col('email', 'character varying', { maxLength: 128, isNullable: true, comment: '邮箱' }),
      col('status', 'user_status', { defaultValue: "'enabled'::user_status", comment: '状态（枚举）', enumValues: ['enabled', 'disabled'] }),
      col('department_id', 'integer', { isNullable: true, comment: '部门ID' }),
      col('created_at', 'timestamp with time zone', { defaultValue: 'now()', comment: '创建时间' }),
    ],
    indexes: [
      { name: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true, definition: 'CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)' },
      { name: 'users_username_key', columns: ['username'], isUnique: true, isPrimary: false, definition: 'CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username)' },
    ],
    foreignKeys: [
      { name: 'users_department_id_fkey', columns: ['department_id'], referencedSchema: 'public', referencedTable: 'departments', referencedColumns: ['id'], onUpdate: 'NO ACTION', onDelete: 'SET NULL' },
    ],
    rows: usersRows,
  },
  {
    schema: 'public', name: 'roles', kind: 'table', comment: '角色表',
    columns: [
      col('id', 'integer', { isPrimaryKey: true, defaultValue: "nextval('roles_id_seq'::regclass)" }),
      col('name', 'character varying', { maxLength: 64, comment: '角色名称' }),
      col('code', 'character varying', { maxLength: 64, comment: '角色编码' }),
      col('sort', 'integer', { defaultValue: '0' }),
      col('status', 'character varying', { maxLength: 16, defaultValue: "'enabled'::character varying" }),
      col('remark', 'text', { isNullable: true, comment: '备注' }),
      col('created_at', 'timestamp with time zone', { defaultValue: 'now()' }),
    ],
    indexes: [
      { name: 'roles_pkey', columns: ['id'], isUnique: true, isPrimary: true, definition: 'CREATE UNIQUE INDEX roles_pkey ON public.roles USING btree (id)' },
    ],
    foreignKeys: [],
    rows: rolesRows,
  },
  {
    schema: 'public', name: 'menus', kind: 'table', comment: '菜单/权限表',
    columns: [
      col('id', 'integer', { isPrimaryKey: true }),
      col('parent_id', 'integer', { defaultValue: '0', comment: '父级ID' }),
      col('title', 'character varying', { maxLength: 64 }),
      col('name', 'character varying', { maxLength: 64, isNullable: true }),
      col('path', 'character varying', { maxLength: 200, isNullable: true }),
      col('type', 'character varying', { maxLength: 16 }),
      col('permission', 'character varying', { maxLength: 128, isNullable: true }),
      col('sort', 'integer', { defaultValue: '0' }),
      col('status', 'character varying', { maxLength: 16, defaultValue: "'enabled'::character varying" }),
      col('created_at', 'timestamp with time zone', { defaultValue: 'now()' }),
    ],
    indexes: [
      { name: 'menus_pkey', columns: ['id'], isUnique: true, isPrimary: true, definition: 'CREATE UNIQUE INDEX menus_pkey ON public.menus USING btree (id)' },
    ],
    foreignKeys: [],
    rows: menusRows,
  },
  {
    schema: 'public', name: 'departments', kind: 'table', comment: '部门表',
    columns: [
      col('id', 'integer', { isPrimaryKey: true }),
      col('parent_id', 'integer', { defaultValue: '0' }),
      col('name', 'character varying', { maxLength: 64 }),
      col('sort', 'integer', { defaultValue: '0' }),
      col('status', 'character varying', { maxLength: 16, defaultValue: "'enabled'::character varying" }),
      col('created_at', 'timestamp with time zone', { defaultValue: 'now()' }),
    ],
    indexes: [
      { name: 'departments_pkey', columns: ['id'], isUnique: true, isPrimary: true, definition: 'CREATE UNIQUE INDEX departments_pkey ON public.departments USING btree (id)' },
    ],
    foreignKeys: [],
    rows: departmentsRows,
  },
  {
    schema: 'public', name: 'operation_logs', kind: 'table', comment: '操作日志表',
    columns: [
      col('id', 'integer', { isPrimaryKey: true }),
      col('username', 'character varying', { maxLength: 64, isNullable: true }),
      col('module', 'character varying', { maxLength: 64, isNullable: true }),
      col('description', 'text', { isNullable: true }),
      col('method', 'character varying', { maxLength: 10, isNullable: true }),
      col('duration_ms', 'integer', { defaultValue: '0' }),
      col('ip', 'character varying', { maxLength: 64, isNullable: true }),
      col('created_at', 'timestamp with time zone', { defaultValue: 'now()' }),
    ],
    indexes: [
      { name: 'operation_logs_pkey', columns: ['id'], isUnique: true, isPrimary: true, definition: 'CREATE UNIQUE INDEX operation_logs_pkey ON public.operation_logs USING btree (id)' },
    ],
    foreignKeys: [],
    rows: operationLogsRows,
  },
  {
    schema: 'public', name: 'v_active_users', kind: 'view', comment: '启用状态用户视图',
    columns: [
      col('id', 'integer', { isNullable: true }),
      col('username', 'character varying', { maxLength: 64, isNullable: true }),
      col('email', 'character varying', { maxLength: 128, isNullable: true }),
    ],
    indexes: [],
    foreignKeys: [],
    rows: usersRows.filter((r) => r.status === 'enabled').map((r) => ({ id: r.id, username: r.username, email: r.email })),
  },
];

function findTable(schema: string, name: string): MockTableDef | undefined {
  return tables.find((t) => t.schema === schema && t.name === name);
}

function tableSize(t: MockTableDef): number {
  return 16384 + t.rows.length * 128 + t.columns.length * 96;
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── 查询历史（内存态） ──────────────────────────────────────────────────────────
let historyId = 6;
const queryHistory: Array<{
  id: number; sqlText: string; durationMs: number; rowCount: number;
  success: boolean; errorMessage: string | null; executedAt: string;
}> = [
  { id: 1, sqlText: 'SELECT * FROM users LIMIT 50;', durationMs: 12, rowCount: 42, success: true, errorMessage: null, executedAt: mockDateTime() },
  { id: 2, sqlText: 'SELECT count(*) FROM operation_logs;', durationMs: 8, rowCount: 1, success: true, errorMessage: null, executedAt: mockDateTime() },
  { id: 3, sqlText: 'SELECT r.name, count(*) FROM roles r GROUP BY r.name;', durationMs: 21, rowCount: 4, success: true, errorMessage: null, executedAt: mockDateTime() },
  { id: 4, sqlText: 'SELCT * FROM uxers;', durationMs: 3, rowCount: 0, success: false, errorMessage: 'syntax error at or near "SELCT"', executedAt: mockDateTime() },
  { id: 5, sqlText: 'SELECT * FROM menus WHERE type = \'menu\';', durationMs: 15, rowCount: 9, success: true, errorMessage: null, executedAt: mockDateTime() },
];

function recordHistory(sqlText: string, durationMs: number, rowCount: number, success: boolean, errorMessage: string | null) {
  queryHistory.unshift({ id: historyId++, sqlText, durationMs, rowCount, success, errorMessage, executedAt: mockDateTime() });
  if (queryHistory.length > 200) queryHistory.pop();
}

// ─── 行筛选 / 搜索 / 排序 ────────────────────────────────────────────────────────
function applyRowsQuery(
  t: MockTableDef,
  params: { orderBy?: string; orderDir?: string; filtersStr?: string; search?: string },
): Array<Record<string, unknown>> {
  let rows = [...t.rows];
  const { orderBy, orderDir, filtersStr, search } = params;

  if (filtersStr) {
    try {
      const filters = JSON.parse(filtersStr) as Record<string, string>;
      for (const [colName, raw] of Object.entries(filters)) {
        const m = /^(eq|neq|gt|gte|lt|lte|like|ilike|isnull|notnull)\|([\s\S]*)$/.exec(raw);
        const op = m ? m[1] : 'ilike';
        const val = m ? m[2] : raw;
        rows = rows.filter((r) => {
          const cell = r[colName];
          const cellStr = cell == null ? '' : String(cell);
          switch (op) {
            case 'eq': return cellStr === val;
            case 'neq': return cellStr !== val;
            case 'gt': return Number(cell) > Number(val);
            case 'gte': return Number(cell) >= Number(val);
            case 'lt': return Number(cell) < Number(val);
            case 'lte': return Number(cell) <= Number(val);
            case 'like': return cellStr.includes(val);
            case 'isnull': return cell == null;
            case 'notnull': return cell != null;
            default: return cellStr.toLowerCase().includes(val.toLowerCase());
          }
        });
      }
    } catch { /* ignore */ }
  }

  if (search && search.trim()) {
    const kw = search.trim().toLowerCase();
    rows = rows.filter((r) => Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(kw)));
  }

  if (orderBy) {
    const dir = orderDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const av = a[orderBy];
      const bv = b[orderBy];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  return rows;
}

// ─── 查询执行（简单 SELECT 解析） ────────────────────────────────────────────────
function runMockQuery(sqlText: string): {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
  durationMs: number;
  paginatable: boolean;
} {
  const durationMs = 5 + Math.floor(Math.random() * 30);
  const lower = sqlText.toLowerCase();
  const fromMatch = /from\s+("?public"?\.)?"?([a-z_][a-z0-9_]*)"?/i.exec(sqlText);
  const tableName = fromMatch?.[2];
  const t = tableName ? findTable('public', tableName) : undefined;

  if (/count\s*\(\s*\*\s*\)/i.test(lower) && t) {
    return {
      columns: [{ name: 'count', dataType: 'int8' }],
      rows: [{ count: t.rows.length }],
      durationMs, paginatable: false,
    };
  }

  if (t) {
    const limitMatch = /limit\s+(\d+)/i.exec(lower);
    const rows = limitMatch ? t.rows.slice(0, Number(limitMatch[1])) : [...t.rows];
    return {
      columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType.split(' ')[0] })),
      rows,
      durationMs,
      paginatable: /^\s*(select|with)\b/i.test(sqlText) && !/;/.test(sqlText.trim().replace(/;\s*$/, '')),
    };
  }

  // 兜底：返回一行示意结果
  return {
    columns: [{ name: 'result', dataType: 'text' }],
    rows: [{ result: 'Demo 模式：仅支持对内置示例表的简单 SELECT 查询' }],
    durationMs, paginatable: false,
  };
}

function ok(data: unknown, message = 'success') {
  return HttpResponse.json({ code: 0, message, data });
}

// ─── Handlers ───────────────────────────────────────────────────────────────────
export const dbAdminHandlers = [
  // 表列表
  http.get(`${API}/api/db-admin/tables`, () => {
    return ok(tables.map((t) => {
      const size = tableSize(t);
      return {
        schema: t.schema, name: t.name, kind: t.kind,
        rowEstimate: t.rows.length, sizeBytes: size, sizeText: prettySize(size), comment: t.comment,
      };
    }));
  }),

  // 总览
  http.get(`${API}/api/db-admin/overview`, () => {
    const tableDefs = tables.filter((t) => t.kind === 'table');
    const viewDefs = tables.filter((t) => t.kind !== 'table');
    const totalRows = tableDefs.reduce((s, t) => s + t.rows.length, 0);
    const dbSize = tables.reduce((s, t) => s + tableSize(t), 0) + 8 * 1024 * 1024;
    const topTables = [...tables]
      .map((t) => ({ schema: t.schema, name: t.name, sizeBytes: tableSize(t), sizeText: prettySize(tableSize(t)), rowEstimate: t.rows.length }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 10);
    return ok({
      version: '16.4',
      databaseName: 'zenith_admin',
      databaseSize: dbSize,
      databaseSizeText: prettySize(dbSize),
      schemaCount: 3,
      tableCount: tableDefs.length,
      viewCount: viewDefs.length,
      indexCount: tables.reduce((s, t) => s + t.indexes.length, 0),
      totalRowEstimate: totalRows,
      activeConnections: 5,
      maxConnections: 100,
      startedAt: mockDateTime(),
      uptimeSeconds: 86400 * 3 + 3600 * 5,
      topTables,
    });
  }),

  // 表结构
  http.get(`${API}/api/db-admin/tables/:schema/:name/structure`, ({ params }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    return ok({
      columns: t.columns,
      indexes: t.indexes,
      foreignKeys: t.foreignKeys,
      primaryKey: t.columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
    });
  }),

  // 表数据
  http.get(`${API}/api/db-admin/tables/:schema/:name/rows`, ({ params, request }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = applyRowsQuery(t, {
      orderBy: url.searchParams.get('orderBy') ?? undefined,
      orderDir: url.searchParams.get('orderDir') ?? undefined,
      filtersStr: url.searchParams.get('filters') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });
    const start = (page - 1) * pageSize;
    return ok({ list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
  }),

  // 插入行
  http.post(`${API}/api/db-admin/tables/:schema/:name/rows`, async ({ params, request }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const body = await request.json() as { values: Record<string, unknown> };
    const pk = t.columns.find((c) => c.isPrimaryKey)?.name ?? 'id';
    const maxId = t.rows.reduce((m, r) => Math.max(m, Number(r[pk]) || 0), 0);
    const row: Record<string, unknown> = { ...body.values };
    if (row[pk] == null) row[pk] = maxId + 1;
    t.rows.push(row);
    return ok(row);
  }),

  // 更新行
  http.patch(`${API}/api/db-admin/tables/:schema/:name/rows`, async ({ params, request }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const body = await request.json() as { pk: Record<string, unknown>; changes: Record<string, unknown> };
    const target = t.rows.find((r) => Object.entries(body.pk).every(([k, v]) => String(r[k]) === String(v)));
    if (!target) return HttpResponse.json({ code: 404, message: '记录不存在', data: null }, { status: 404 });
    Object.assign(target, body.changes);
    return ok(target);
  }),

  // 批量更新行（事务语义：mock 中先全量校验再统一应用）
  http.post(`${API}/api/db-admin/tables/:schema/:name/batch-mutate`, async ({ params, request }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const body = await request.json() as { updates: Array<{ pk: Record<string, unknown>; changes: Record<string, unknown> }> };
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const targets: Array<{ row: Record<string, unknown>; changes: Record<string, unknown> }> = [];
    for (const [i, u] of updates.entries()) {
      const row = t.rows.find((r) => Object.entries(u.pk).every(([k, v]) => String(r[k]) === String(v)));
      if (!row) {
        return HttpResponse.json(
          { code: 404, message: `第 ${i + 1} 条更新未命中记录（可能已被删除或主键变更），已回滚全部变更`, data: null },
          { status: 404 },
        );
      }
      targets.push({ row, changes: u.changes });
    }
    for (const { row, changes } of targets) Object.assign(row, changes);
    return ok({ updated: targets.length });
  }),

  // 删除行
  http.delete(`${API}/api/db-admin/tables/:schema/:name/rows`, async ({ params, request }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const body = await request.json() as { pk: Record<string, unknown> };
    const idx = t.rows.findIndex((r) => Object.entries(body.pk).every(([k, v]) => String(r[k]) === String(v)));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '记录不存在', data: null }, { status: 404 });
    t.rows.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // 截断表
  http.post(`${API}/api/db-admin/tables/:schema/:name/truncate`, ({ params }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    t.rows.length = 0;
    return ok(null, '已截断');
  }),

  // 执行 SQL
  http.post(`${API}/api/db-admin/query`, async ({ request }) => {
    const body = await request.json() as { sql: string; page?: number; pageSize?: number };
    const r = runMockQuery(body.sql ?? '');
    const wantPage = body.page != null && body.pageSize != null && body.pageSize > 0 && r.paginatable;
    if (wantPage) {
      const total = r.rows.length;
      const start = (body.page! - 1) * body.pageSize!;
      const rows = r.rows.slice(start, start + body.pageSize!);
      recordHistory(body.sql ?? '', r.durationMs, rows.length, true, null);
      return ok({
        columns: r.columns, rows, rowCount: rows.length, durationMs: r.durationMs,
        truncated: false, paginated: true, total, page: body.page!, pageSize: body.pageSize!,
      });
    }
    const rows = r.rows.slice(0, 5000);
    recordHistory(body.sql ?? '', r.durationMs, rows.length, true, null);
    return ok({
      columns: r.columns, rows, rowCount: rows.length, durationMs: r.durationMs,
      truncated: r.rows.length > 5000, paginated: false, total: null, page: null, pageSize: null,
    });
  }),

  // 取消查询（Demo 模式下查询瞬时返回，恒为已结束）
  http.post(`${API}/api/db-admin/query/cancel`, () => ok({ ok: false })),

  // 批量导入
  http.post(`${API}/api/db-admin/tables/:schema/:name/import`, async ({ params, request }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const body = await request.json() as { rows: Array<Record<string, unknown>> };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const pk = t.columns.find((c) => c.isPrimaryKey)?.name ?? 'id';
    let maxId = t.rows.reduce((m, r) => Math.max(m, Number(r[pk]) || 0), 0);
    for (const row of rows) {
      const next = { ...row };
      if (next[pk] == null) next[pk] = ++maxId;
      t.rows.push(next);
    }
    return ok({ inserted: rows.length });
  }),

  // EXPLAIN
  http.post(`${API}/api/db-admin/explain`, async ({ request }) => {
    const body = await request.json() as { sql: string; analyze?: boolean };
    const analyze = Boolean(body.analyze);
    const plan = {
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'users',
        Alias: 'users',
        'Startup Cost': 0.0,
        'Total Cost': 12.34,
        'Plan Rows': 42,
        'Plan Width': 96,
        ...(analyze ? { 'Actual Startup Time': 0.012, 'Actual Total Time': 0.187, 'Actual Rows': 42, 'Actual Loops': 1 } : {}),
        Filter: "(status = 'enabled'::text)",
      },
      ...(analyze ? { 'Planning Time': 0.123, 'Execution Time': 0.256 } : {}),
    };
    return ok({ plan, durationMs: analyze ? 9 : 4, analyzed: analyze });
  }),

  // 查询历史
  http.get(`${API}/api/db-admin/query/history`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const start = (page - 1) * pageSize;
    return ok({ list: queryHistory.slice(start, start + pageSize), total: queryHistory.length, page, pageSize });
  }),

  http.delete(`${API}/api/db-admin/query/history/:id`, ({ params }) => {
    const id = Number(params.id);
    const idx = queryHistory.findIndex((h) => h.id === id);
    if (idx !== -1) queryHistory.splice(idx, 1);
    return ok(null, '已删除');
  }),

  http.delete(`${API}/api/db-admin/query/history`, () => {
    queryHistory.length = 0;
    return ok(null, '已清空');
  }),

  // ER 图
  http.get(`${API}/api/db-admin/er-schema`, () => {
    return ok({
      tables: tables.map((t) => ({
        schema: t.schema, name: t.name,
        columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType.split(' ')[0], isPrimaryKey: c.isPrimaryKey })),
      })),
      foreignKeys: tables.flatMap((t) => t.foreignKeys.map((fk) => ({
        schema: t.schema, table: t.name, columns: fk.columns,
        referencedSchema: fk.referencedSchema, referencedTable: fk.referencedTable, referencedColumns: fk.referencedColumns,
      }))),
    });
  }),

  http.get(`${API}/api/db-admin/er-diagram`, () => {
    return ok(tables.flatMap((t) => t.foreignKeys.map((fk) => ({
      schema: t.schema, table: t.name, columns: fk.columns,
      referencedSchema: fk.referencedSchema, referencedTable: fk.referencedTable, referencedColumns: fk.referencedColumns,
    }))));
  }),

  // 导出（CSV / JSON）— 返回文本，供下载按钮工作
  http.post(`${API}/api/db-admin/query/export.csv`, async ({ request }) => {
    const body = await request.json() as { sql: string };
    const result = runMockQuery(body.sql ?? '');
    const header = result.columns.map((c) => c.name).join(',');
    const lines = result.rows.map((r) => result.columns.map((c) => String(r[c.name] ?? '')).join(','));
    return new HttpResponse(`\uFEFF${header}\n${lines.join('\n')}`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }),

  http.post(`${API}/api/db-admin/query/export.json`, async ({ request }) => {
    const body = await request.json() as { sql: string };
    const result = runMockQuery(body.sql ?? '');
    return new HttpResponse(JSON.stringify(result.rows, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }),

  http.get(`${API}/api/db-admin/tables/:schema/:name/export.csv`, ({ params }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const header = t.columns.map((c) => c.name).join(',');
    const lines = t.rows.map((r) => t.columns.map((c) => String(r[c.name] ?? '')).join(','));
    return new HttpResponse(`\uFEFF${header}\n${lines.join('\n')}`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }),

  http.get(`${API}/api/db-admin/tables/:schema/:name/export.sql`, ({ params }) => {
    const t = findTable(String(params.schema), String(params.name));
    if (!t) return HttpResponse.json({ code: 404, message: '表不存在', data: null }, { status: 404 });
    const lines = t.rows.map((r) => {
      const cols = t.columns.map((c) => `"${c.name}"`).join(', ');
      const vals = t.columns.map((c) => {
        const v = r[c.name];
        if (v == null) return 'NULL';
        return typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
      }).join(', ');
      return `INSERT INTO "${t.schema}"."${t.name}" (${cols}) VALUES (${vals});`;
    });
    return new HttpResponse(`-- Demo export: ${t.schema}.${t.name}\n${lines.join('\n')}`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }),

  // ─── 运维：活动连接 ──────────────────────────────────────────────────────────
  http.get(`${API}/api/db-admin/activity`, () => {
    const now = mockDateTime();
    return ok([
      {
        pid: 101, username: 'postgres', applicationName: 'zenith-admin', clientAddr: '172.18.0.1',
        state: 'active', waitEventType: null, waitEvent: null, backendType: 'client backend',
        query: 'SELECT * FROM pg_stat_activity WHERE datname = current_database()',
        querySeconds: 0.03, xactSeconds: 0.03, backendSeconds: 1820,
        queryStart: now, backendStart: now, blockedBy: [], isCurrent: true,
      },
      {
        pid: 102, username: 'postgres', applicationName: 'zenith-admin', clientAddr: '172.18.0.1',
        state: 'idle', waitEventType: 'Client', waitEvent: 'ClientRead', backendType: 'client backend',
        query: 'SELECT id, username FROM users WHERE status = $1', querySeconds: 12.4, xactSeconds: null,
        backendSeconds: 3600, queryStart: now, backendStart: now, blockedBy: [], isCurrent: false,
      },
      {
        pid: 103, username: 'app', applicationName: 'worker', clientAddr: '172.18.0.5',
        state: 'active', waitEventType: 'Lock', waitEvent: 'transactionid', backendType: 'client backend',
        query: 'UPDATE operation_logs SET module = $1 WHERE id = $2', querySeconds: 45.8, xactSeconds: 46.0,
        backendSeconds: 600, queryStart: now, backendStart: now, blockedBy: [104], isCurrent: false,
      },
      {
        pid: 104, username: 'app', applicationName: 'worker', clientAddr: '172.18.0.6',
        state: 'idle in transaction', waitEventType: null, waitEvent: null, backendType: 'client backend',
        query: 'BEGIN', querySeconds: 60.1, xactSeconds: 62.0, backendSeconds: 700,
        queryStart: now, backendStart: now, blockedBy: [], isCurrent: false,
      },
    ]);
  }),

  http.post(`${API}/api/db-admin/activity/:pid/cancel`, () => ok({ ok: true })),
  http.post(`${API}/api/db-admin/activity/:pid/terminate`, () => ok({ ok: true })),

  // ─── 运维：表维护 ────────────────────────────────────────────────────────────
  http.get(`${API}/api/db-admin/maintenance/tables`, () => {
    const now = mockDateTime();
    return ok(tables.filter((t) => t.kind === 'table').map((t, i) => {
      const live = t.rows.length;
      const dead = Math.round(live * [0.28, 0.05, 0.12, 0.02, 0.01][i % 5]);
      const total = live + dead;
      const size = tableSize(t);
      return {
        schema: t.schema, name: t.name,
        liveTuples: live, deadTuples: dead,
        deadRatio: total > 0 ? Math.round((dead / total) * 10000) / 100 : 0,
        sizeBytes: size, sizeText: prettySize(size),
        lastVacuum: i % 3 === 0 ? now : null, lastAutovacuum: now,
        lastAnalyze: i % 2 === 0 ? now : null, lastAutoanalyze: now,
        vacuumCount: i, autovacuumCount: i * 3, analyzeCount: i, autoanalyzeCount: i * 2,
      };
    }).sort((a, b) => b.deadTuples - a.deadTuples));
  }),

  http.post(`${API}/api/db-admin/tables/:schema/:name/maintenance`, () => ok(null, '已执行')),
  http.post(`${API}/api/db-admin/tables/:schema/:name/refresh`, () => ok(null, '已刷新')),

  // ─── 运维：索引健康 ──────────────────────────────────────────────────────────
  http.get(`${API}/api/db-admin/index-health`, () => {
    return ok({
      unused: [
        { schema: 'public', table: 'operation_logs', index: 'idx_operation_logs_module', scans: 0, sizeBytes: 32768, sizeText: '32 kB', isUnique: false, isPrimary: false, columns: ['module'], definition: 'CREATE INDEX idx_operation_logs_module ON public.operation_logs USING btree (module)' },
        { schema: 'public', table: 'users', index: 'idx_users_nickname', scans: 0, sizeBytes: 16384, sizeText: '16 kB', isUnique: false, isPrimary: false, columns: ['nickname'], definition: 'CREATE INDEX idx_users_nickname ON public.users USING btree (nickname)' },
        { schema: 'public', table: 'menus', index: 'idx_menus_name', scans: 0, sizeBytes: 16384, sizeText: '16 kB', isUnique: true, isPrimary: false, columns: ['name'], definition: 'CREATE UNIQUE INDEX idx_menus_name ON public.menus USING btree (name)' },
      ],
      duplicate: [
        {
          schema: 'public', table: 'users', columns: ['email'],
          indexes: [
            { schema: 'public', table: 'users', index: 'users_email_key', scans: 1240, sizeBytes: 24576, sizeText: '24 kB', isUnique: true, isPrimary: false, columns: ['email'], definition: 'CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)' },
            { schema: 'public', table: 'users', index: 'idx_users_email', scans: 12, sizeBytes: 24576, sizeText: '24 kB', isUnique: false, isPrimary: false, columns: ['email'], definition: 'CREATE INDEX idx_users_email ON public.users USING btree (email)' },
          ],
        },
      ],
      totalIndexes: 38,
      totalIndexBytes: 1572864,
    });
  }),

  // ─── 对象浏览 ────────────────────────────────────────────────────────────────
  http.get(`${API}/api/db-admin/objects`, () => {
    return ok({
      sequences: [
        { schema: 'public', name: 'users_id_seq', dataType: 'bigint', startValue: '1', incrementBy: '1', lastValue: '42' },
        { schema: 'public', name: 'roles_id_seq', dataType: 'bigint', startValue: '1', incrementBy: '1', lastValue: '4' },
        { schema: 'public', name: 'menus_id_seq', dataType: 'bigint', startValue: '1', incrementBy: '1', lastValue: '18' },
      ],
      functions: [
        { schema: 'public', name: 'set_updated_at', kind: 'function', language: 'plpgsql', args: '', result: 'trigger', definition: 'CREATE OR REPLACE FUNCTION public.set_updated_at()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  NEW.updated_at = now();\n  RETURN NEW;\nEND;\n$function$\n' },
        { schema: 'public', name: 'user_full_name', kind: 'function', language: 'sql', args: 'u users', result: 'text', definition: null },
      ],
      triggers: [
        { schema: 'public', table: 'users', name: 'trg_users_updated_at', enabled: true, definition: 'CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_updated_at()' },
      ],
      enums: [
        { schema: 'public', name: 'status', values: ['enabled', 'disabled'] },
        { schema: 'public', name: 'menu_type', values: ['directory', 'menu', 'button'] },
        { schema: 'public', name: 'data_scope', values: ['all', 'custom', 'dept_only', 'dept', 'self'] },
      ],
      extensions: [
        { name: 'plpgsql', version: '1.0', schema: 'pg_catalog', comment: 'PL/pgSQL procedural language' },
        { name: 'pg_trgm', version: '1.6', schema: 'public', comment: 'text similarity measurement' },
      ],
    });
  }),

  // ─── Drizzle Schema 漂移对照 ──────────────────────────────────────────────────
  http.get(`${API}/api/db-admin/schema-drift`, () => {
    return ok({
      inSync: false,
      expectedTables: 109,
      actualTables: 110,
      drifts: [
        {
          schema: 'public', table: 'users', status: 'column_diff',
          columns: [
            { column: 'avatar_url', issue: 'missing_in_db', expected: 'varchar(255)', actual: null },
            { column: 'last_login_at', issue: 'type_mismatch', expected: 'timestamptz', actual: 'timestamp' },
            { column: 'legacy_flag', issue: 'extra_in_db', expected: null, actual: 'boolean' },
          ],
        },
        { schema: 'public', table: 'audit_archive', status: 'extra_in_db', columns: [] },
      ],
    });
  }),
];
