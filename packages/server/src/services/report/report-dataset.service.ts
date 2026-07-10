/**
 * 报表数据集 Service
 * CRUD + 取数执行（preview 试跑 / data 取数）。
 * - sql：只读事务（READ ONLY + statement_timeout + 行上限）+ ${param} 绑定参数（防注入）。
 * - api：统一走 http-client 的 httpRequest（防 SSRF），按 itemsPath 提取数组，运行时参数注入。
 */
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import {
  reportAlertRules,
  reportDashboardEmbedTokens,
  reportDashboardShares,
  reportDashboardSubscriptions,
  reportDashboards,
  reportDatasetExecutionLogs,
  reportDatasets,
  reportDatasources,
  reportPrintTemplates,
  users,
} from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { httpRequest } from '../../lib/http-client';
import { currentUserOrNull } from '../../lib/context';
import { applyComputedFields } from '../../lib/report-formula';
import { runExternalQuery } from '../../lib/report-external-db';
import { normalizeReadonlyReportSql } from '../../lib/report-sql-safety';
import {
  ensureDatasourceEnabled,
  ensureDatasourceExists,
  markDatasourceExecutionHealth,
  resolveApiHeaders,
} from './report-datasource.service';
import {
  reportCreateTenantId,
  reportScopedWhere,
  reportTenantScope,
} from './report-access';
import { isSqlLikeType, isExternalDbType, REPORT_DATASOURCE_TYPES } from '@zenith/shared';
import type { ReportDatasetRow } from '../../db/schema';
import type {
  ReportDataset, ReportDataResult, ReportField, ReportFieldType, ReportDatasetContent, ReportDatasetParam,
  ReportDatasourceType, ReportDatasourceConfig, ReportComputedField, ReportExternalDbConfig,
  ReportApiDatasourceConfig, ReportApiDatasetContent, ReportSqlDatasetContent, ReportStaticDatasetContent, ReportDatasetMaterialize,
  ReportRowRule, ReportDatasetRefs, ReportWidget, ReportFilter, ReportDatasetQueryOptions, ReportResultField, ReportDatasetExecutionLog,
  CreateReportDatasetInput, UpdateReportDatasetInput, ReportDatasetPreviewInput, ReportSortOrder, ReportExecutionStats,
  ReportLookupOption, ReportRuntimeGovernance,
  ReportDashboardSnapshot,
} from '@zenith/shared';

const PREVIEW_LIMIT = 100;
const MAX_LIMIT = 5000;
const QUERY_TIMEOUT = '15s';
const CACHE_PREFIX = `${config.redis.keyPrefix}report:dataset:`;
const MATVIEW_PREFIX = `${config.redis.keyPrefix}report:matview:`;
/** 物化快照安全 TTL（秒）：即便无 cron 刷新，也不会永久冻结（默认 24h） */
const MATVIEW_TTL_SECONDS = 24 * 60 * 60;

type DatasetRowWithDs = ReportDatasetRow & { datasource?: { name: string } | null };
type DatasetQueryArg = number | ReportDatasetQueryOptions | undefined;

export interface DatasetExecutionContext {
  scene?: string;
  sourceRefId?: string | number | null;
}

export interface DatasetExecutionResult {
  data: ReportDataResult;
  durationMs: number;
  cacheHit: boolean;
}

interface NormalizedQueryOptions {
  limit?: number;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: ReportSortOrder;
}

export function getReportRuntimeGovernance(): ReportRuntimeGovernance {
  return {
    slowQueryMs: config.report.slowQueryMs,
    dashboardMaxConcurrent: config.report.dashboardMaxConcurrent,
    datasetMaxRows: config.report.datasetMaxRows,
    datasetMaxBytes: config.report.datasetMaxBytes,
  };
}

function estimateRowsBytes(rows: Record<string, unknown>[]): number {
  try {
    return Buffer.byteLength(JSON.stringify(rows), 'utf8');
  } catch {
    return 0;
  }
}

function applyDatasetGovernance(result: ReportDataResult): ReportDataResult {
  const governance = getReportRuntimeGovernance();
  const maxRows = Math.max(1, governance.datasetMaxRows);
  const maxBytes = Math.max(1024, governance.datasetMaxBytes);
  let rows = result.rows;
  let truncated = false;
  let truncatedReason: string | null = null;

  if (rows.length > maxRows) {
    rows = rows.slice(0, maxRows);
    truncated = true;
    truncatedReason = `结果行数超过上限（${maxRows} 行）`;
  }

  let bytes = estimateRowsBytes(rows);
  if (bytes > maxBytes) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const size = estimateRowsBytes(rows.slice(0, mid));
      if (size <= maxBytes) low = mid;
      else high = mid - 1;
    }
    rows = rows.slice(0, low);
    bytes = estimateRowsBytes(rows);
    truncated = true;
    truncatedReason = truncatedReason
      ? `${truncatedReason}，且结果体积超过上限（${maxBytes} bytes）`
      : `结果体积超过上限（${maxBytes} bytes）`;
  }

  return {
    ...result,
    rows,
    bytes,
    truncated,
    truncatedReason,
  };
}

function normalizeDatasetQueryOptions(query?: DatasetQueryArg): NormalizedQueryOptions {
  if (typeof query === 'number') {
    return { limit: Math.max(1, Math.min(query || PREVIEW_LIMIT, MAX_LIMIT)) };
  }
  const sortOrder = query?.sortOrder === 'asc' ? 'asc' : 'desc';
  const page = query?.page ? Math.max(1, Math.floor(query.page)) : undefined;
  const pageSize = query?.pageSize ? Math.max(1, Math.min(Math.floor(query.pageSize), 500)) : undefined;
  return {
    limit: query?.limit ? Math.max(1, Math.min(Math.floor(query.limit), MAX_LIMIT)) : undefined,
    page,
    pageSize,
    sortField: query?.sortField?.trim() || undefined,
    sortOrder,
  };
}

function normalizeIdentifier(name: string): string {
  return name.trim().toLowerCase();
}

function inferFieldType(value: unknown): ReportFieldType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(value)) return 'date';
  return 'string';
}

function buildResultFields(
  columns: string[],
  declaredFields: ReportField[] | undefined,
  computedFields: ReportComputedField[] | undefined,
  rows: Record<string, unknown>[],
): ReportResultField[] {
  const declared = new Map((declaredFields ?? []).map((field) => [normalizeIdentifier(field.name), field]));
  const computed = new Map((computedFields ?? []).map((field) => [normalizeIdentifier(field.name), field]));
  return columns.map((column) => {
    const declaredField = declared.get(normalizeIdentifier(column));
    if (declaredField) return { ...declaredField, source: 'declared' as const };
    const computedField = computed.get(normalizeIdentifier(column));
    if (computedField) {
      return {
        name: computedField.name,
        label: computedField.label,
        type: computedField.type ?? inferFieldType(rows[0]?.[column]),
        source: 'computed' as const,
      };
    }
    return {
      name: column,
      label: column,
      type: inferFieldType(rows[0]?.[column]),
      source: 'inferred' as const,
    };
  });
}

function withFieldMetadata(
  result: Omit<ReportDataResult, 'fields'> | ReportDataResult,
  declaredFields: ReportField[] | undefined,
  computedFields: ReportComputedField[] | undefined,
): ReportDataResult {
  return {
    columns: result.columns,
    fields: buildResultFields(result.columns, declaredFields, computedFields, result.rows),
    rows: result.rows,
    total: result.total,
  };
}

function quoteSortField(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    throw new HTTPException(400, { message: '排序字段不合法' });
  }
  return `"${field}"`;
}

export function mapDataset(row: DatasetRowWithDs): ReportDataset {
  return {
    id: row.id,
    name: row.name,
    datasourceId: row.datasourceId,
    datasourceName: row.datasource?.name ?? null,
    type: row.type,
    content: (row.content ?? {}) as ReportDatasetContent,
    fields: (row.fields ?? []) as ReportField[],
    params: (row.params ?? []) as ReportDatasetParam[],
    computedFields: (row.computedFields ?? []) as ReportComputedField[],
    cacheTtl: row.cacheTtl ?? 0,
    materialize: (row.materialize ?? {}) as ReportDatasetMaterialize,
    rowRules: (row.rowRules ?? []) as ReportRowRule[],
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 按 type 规整数据集查询内容 */
function normalizeDatasetContent(
  type: ReportDatasourceType,
  content: Record<string, unknown> | null | undefined,
): ReportDatasetContent {
  const c = (content ?? {}) as Record<string, unknown>;
  if (isSqlLikeType(type)) {
    return {
      sql: normalizeReadonlyReportSql(typeof c.sql === 'string' ? c.sql : ''),
      // 可视化建模模型（回显编辑用；SQL 为最终执行内容）
      ...(c.visual && typeof c.visual === 'object' ? { visual: c.visual as ReportSqlDatasetContent['visual'] } : {}),
    };
  }
  if (type === 'static') {
    const rawData = Array.isArray(c.data) ? (c.data as Record<string, unknown>[]) : [];
    if (rawData.length > MAX_LIMIT) {
      throw new HTTPException(400, { message: `静态数据集最多 ${MAX_LIMIT} 行，当前 ${rawData.length} 行，请精简后再保存` });
    }
    const columns = Array.isArray(c.columns) ? (c.columns as string[]) : undefined;
    return { data: rawData, ...(columns ? { columns } : {}) };
  }
  const itemsPath = typeof c.itemsPath === 'string' ? c.itemsPath : null;
  const params = c.params && typeof c.params === 'object' && !Array.isArray(c.params)
    ? (c.params as Record<string, string>)
    : null;
  return { itemsPath, params };
}

function navigatePath(json: unknown, path?: string | null): unknown {
  if (!path) return json;
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key.trim()] : undefined),
    json,
  );
}

function coerceParam(value: unknown, type: ReportFieldType): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'number') { const n = Number(value); return Number.isFinite(n) ? n : null; }
  if (type === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  return String(value);
}

/** 解析有效参数：数据集默认值 + 运行时传入，required 校验。`__` 前缀为系统变量保留命名空间，剥离客户端伪造值 */
export function resolveDatasetParams(defs: ReportDatasetParam[] | undefined, provided?: Record<string, unknown>): Record<string, unknown> {
  const safeProvided = Object.fromEntries(
    Object.entries(provided ?? {}).filter(([k]) => !k.startsWith('__')),
  );
  const defsList = defs ?? [];
  const allowed = new Set(defsList.map((item) => item.name));
  const extraKeys = Object.keys(safeProvided).filter((key) => !allowed.has(key));
  if (extraKeys.length) {
    throw new HTTPException(400, { message: `存在未声明的运行参数：${extraKeys.join('、')}` });
  }
  const out: Record<string, unknown> = {};
  for (const d of defsList) {
    if (d.name.startsWith('__')) continue;
    const raw = safeProvided[d.name];
    const val = (raw === undefined || raw === null || raw === '') ? (d.defaultValue ?? null) : coerceParam(raw, d.type);
    out[d.name] = val;
    if (d.required && (val === null || val === undefined)) {
      throw new HTTPException(400, { message: `缺少必填参数：${d.label || d.name}` });
    }
  }
  return out;
}

function validateDatasetDefinitions(
  fields: ReportField[] | undefined,
  params: ReportDatasetParam[] | undefined,
  computedFields: ReportComputedField[] | undefined,
): void {
  const identRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const fieldSet = new Set<string>();
  for (const field of fields ?? []) {
    if (!identRe.test(field.name) || field.name.startsWith('__')) {
      throw new HTTPException(400, { message: `字段名不合法：${field.name}` });
    }
    const key = normalizeIdentifier(field.name);
    if (fieldSet.has(key)) {
      throw new HTTPException(400, { message: `字段名重复：${field.name}` });
    }
    fieldSet.add(key);
  }
  const paramSet = new Set<string>();
  for (const param of params ?? []) {
    if (!identRe.test(param.name) || param.name.startsWith('__')) {
      throw new HTTPException(400, { message: `参数名不合法：${param.name}` });
    }
    const key = normalizeIdentifier(param.name);
    if (paramSet.has(key)) {
      throw new HTTPException(400, { message: `参数名重复：${param.name}` });
    }
    paramSet.add(key);
  }
  const computedSet = new Set<string>();
  const exprIdRe = /[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5.]*/g;
  const functions = new Set(['round', 'floor', 'ceil', 'abs', 'min', 'max', 'sqrt', 'pow', 'concat', 'upper', 'lower', 'trim', 'length', 'substr', 'number', 'string', 'coalesce', 'ifnull', 'if', 'now', 'true', 'false', 'null']);
  for (const item of computedFields ?? []) {
    if (!identRe.test(item.name) || item.name.startsWith('__')) {
      throw new HTTPException(400, { message: `计算字段名不合法：${item.name}` });
    }
    const key = normalizeIdentifier(item.name);
    if (fieldSet.has(key) || computedSet.has(key)) {
      throw new HTTPException(400, { message: `计算字段名重复：${item.name}` });
    }
    computedSet.add(key);
    for (const token of item.expression.match(exprIdRe) ?? []) {
      const lower = token.toLowerCase();
      if (functions.has(lower) || token.includes('.')) continue;
      if (!fieldSet.has(normalizeIdentifier(token)) && !computedSet.has(normalizeIdentifier(token))) {
        throw new HTTPException(400, { message: `计算字段 ${item.name} 引用了未声明字段：${token}` });
      }
    }
  }
}

/**
 * 数据权限系统变量（JEECG 风格）：以绑定参数注入当前登录用户上下文，
 * 供数据集 SQL 通过 ${__userId} / ${__deptId} 等做行级过滤。
 * 这些变量由服务端权威赋值，客户端无法伪造（始终覆盖同名入参）。
 *
 * 仅注入 SQL 文本**实际引用**的变量（按需注入）：
 * - 未引用任何系统变量的公共数据集，其结果与用户无关 —— 不注入可让结果缓存跨用户复用（大屏降压）；
 * - API / 静态数据集（sqlText 为空）不注入 —— 防止内部用户 ID/用户名/租户 ID 混入外发的第三方 HTTP 请求参数。
 */
async function buildSystemParams(sqlText: string): Promise<Record<string, unknown>> {
  const referenced = new Set<string>();
  for (const m of sqlText.matchAll(/\$\{\s*(__\w+)\s*\}/g)) referenced.add(m[1]);
  if (referenced.size === 0) return {};
  const user = currentUserOrNull();
  const out: Record<string, unknown> = {};
  if (referenced.has('__userId')) out.__userId = user?.userId ?? null;
  if (referenced.has('__username')) out.__username = user?.username ?? null;
  if (referenced.has('__tenantId')) out.__tenantId = user?.tenantId ?? null;
  if (referenced.has('__deptId')) {
    if (user) {
      const [row] = await db.select({ deptId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1);
      out.__deptId = row?.deptId ?? null;
    } else {
      out.__deptId = null;
    }
  }
  return out;
}

/** 把 ${name} 编译为绑定参数（防注入）；未提供的绑定 null */
function buildParamSql(text: string, params: Record<string, unknown>): SQL {
  const segments = text.split(/\$\{\s*(\w+)\s*\}/g);
  const chunks: SQL[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 0) {
      if (segments[i]) chunks.push(sql.raw(segments[i]));
    } else {
      const v = params[segments[i]];
      chunks.push(sql`${v === undefined ? null : v}`);
    }
  }
  return sql.join(chunks, sql.raw(''));
}

/** 外部库 ${name} → 占位符（pg=$N / mysql=? / sqlserver=@pN）+ values 数组（防注入）*/
export function buildExternalParamSql(
  text: string,
  params: Record<string, unknown>,
  dialect: 'mysql' | 'postgresql' | 'sqlserver',
): { text: string; values: unknown[] } {
  const segments = text.split(/\$\{\s*(\w+)\s*\}/g);
  let out = '';
  const values: unknown[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 0) { out += segments[i]; continue; }
    const v = params[segments[i]];
    values.push(v === undefined ? null : v);
    if (dialect === 'postgresql') out += `$${values.length}`;
    else if (dialect === 'sqlserver') out += `@p${values.length - 1}`;
    else out += '?';
  }
  return { text: out, values };
}

function buildSqlQueryParts(options: NormalizedQueryOptions): { limit: number; offset: number; orderBy: string } {
  const usePaging = options.page !== undefined && options.pageSize !== undefined;
  const limit = usePaging ? Math.max(1, Math.min(options.pageSize ?? PREVIEW_LIMIT, 500)) : Math.max(1, Math.min(options.limit ?? PREVIEW_LIMIT, MAX_LIMIT));
  const offset = usePaging ? pageOffset(options.page ?? 1, options.pageSize ?? limit) : 0;
  const orderBy = options.sortField ? ` ORDER BY ${quoteSortField(options.sortField)} ${(options.sortOrder === 'asc' ? 'ASC' : 'DESC')}` : '';
  return { limit, offset, orderBy };
}

function applyInMemoryQuery(
  rows: Record<string, unknown>[],
  columns: string[],
  options: NormalizedQueryOptions,
  totalOverride?: number | null,
): Omit<ReportDataResult, 'fields'> {
  const source = [...rows];
  if (options.sortField) {
    if (!columns.includes(options.sortField)) {
      throw new HTTPException(400, { message: `排序字段不存在：${options.sortField}` });
    }
    const direction = options.sortOrder === 'asc' ? 1 : -1;
    source.sort((left, right) => {
      const a = left[options.sortField!];
      const b = right[options.sortField!];
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
      return String(a).localeCompare(String(b), 'zh-CN', { numeric: true }) * direction;
    });
  }
  const total = totalOverride ?? source.length;
  if (options.page !== undefined && options.pageSize !== undefined) {
    return {
      columns,
      rows: source.slice(pageOffset(options.page, options.pageSize), pageOffset(options.page, options.pageSize) + options.pageSize),
      total,
    };
  }
  const limit = Math.max(1, Math.min(options.limit ?? PREVIEW_LIMIT, MAX_LIMIT));
  return { columns, rows: source.slice(0, limit), total };
}

/** 只读执行 SQL（READ ONLY 事务 + 超时 + 安全排序分页 + 参数绑定）*/
async function runReadonlySql(text: string, params: Record<string, unknown>, options: NormalizedQueryOptions): Promise<Omit<ReportDataResult, 'fields'>> {
  const trimmed = normalizeReadonlyReportSql(text);
  const queryParts = buildSqlQueryParts(options);
  const inner = buildParamSql(trimmed, params);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL TRANSACTION READ ONLY'));
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`));
      const countRows = await tx.execute<{ total: number }>(sql`SELECT COUNT(*)::int AS total FROM (${inner}) AS _count`);
      const suffix = `${queryParts.orderBy} LIMIT ${queryParts.limit}${queryParts.offset > 0 ? ` OFFSET ${queryParts.offset}` : ''}`;
      const dataRows = await tx.execute(sql`SELECT * FROM (${inner}) AS _sub ${sql.raw(suffix)}`);
      return { countRows, dataRows };
    });
    const arr = (result.dataRows as unknown as Record<string, unknown>[]) ?? [];
    const columns = arr.length ? Object.keys(arr[0]) : [];
    const total = Number((result.countRows as unknown as Array<{ total?: number }>)[0]?.total ?? arr.length);
    return { columns, rows: arr, total: Number.isFinite(total) ? total : arr.length };
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `SQL 执行失败：${msg}` });
  }
}

// ─── 行级权限（Row-Level Rules）────────────────────────────────────────────────

/**
 * 解析当前用户命中的行级规则：
 * - 规则未启用 / where 为空或含分号（防拼接多语句）→ 忽略；
 * - 无用户上下文 → 拒绝执行；未命中任何规则 → 注入恒假条件（失败关闭）；
 * - 超级管理员不受限；规则未配置 roles = 对所有登录用户生效。
 */
export function resolveEffectiveRowRules(rules: ReportRowRule[] | null | undefined): ReportRowRule[] {
  const list = (rules ?? []).filter((r) =>
    (r.enabled ?? true) && typeof r.where === 'string' && r.where.trim() && !r.where.includes(';'));
  if (!list.length) return [];
  const user = currentUserOrNull();
  if (!user) {
    throw new HTTPException(403, { message: '该数据集配置了行级权限，当前执行缺少用户身份' });
  }
  const roles = user.roles ?? [];
  if (roles.includes('super_admin')) return [];
  const matched = list.filter((r) => !r.roles?.length || r.roles.some((code) => roles.includes(code)));
  return matched.length ? matched : [{ where: '1 = 0', enabled: true, remark: '未命中任何行级权限规则，默认拒绝' }];
}

/** 把命中的行级规则以 OR 拼接为 WHERE，包裹原查询（子查询别名 _rls；PG/MySQL/SQL Server 通用） */
export function applyRowRulesToSql(sqlText: string, rules: ReportRowRule[]): string {
  if (!rules.length) return sqlText;
  const where = rules.map((r) => `(${r.where.trim()})`).join(' OR ');
  return `SELECT * FROM (\n${sqlText.trim().replace(/;\s*$/, '')}\n) AS _rls WHERE ${where}`;
}

export async function ensureDatasetExists(id: number): Promise<ReportDatasetRow> {
  const [row] = await db.select().from(reportDatasets)
    .where(reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  return row;
}

/**
 * 校验数据集可在「无用户上下文 / 全局」场景安全求值（如数据预警 Cron、定时推送）。
 * 拒绝使用数据权限系统变量(${__userId} 等) 或含必填参数的数据集——否则全局评估会
 * 因缺少用户上下文/必填参数而得到错误或空结果，导致漏报/误报。
 */
export async function assertDatasetEvaluableGlobally(datasetId: number): Promise<void> {
  const row = await ensureDatasetExists(datasetId);
  const sqlText = isSqlLikeType(row.type) ? (((row.content ?? {}) as ReportSqlDatasetContent).sql ?? '') : '';
  if (/\$\{\s*__\w+\s*\}/.test(sqlText)) {
    throw new HTTPException(400, { message: '该数据集使用了数据权限系统变量（${__userId} 等），无法用于全局评估（如预警/定时任务），请改用无数据权限变量的数据集' });
  }
  const params = (row.params ?? []) as ReportDatasetParam[];
  if (params.some((p) => p.required)) {
    throw new HTTPException(400, { message: '该数据集含必填参数，无法用于全局评估（预警/定时任务无运行时参数），请改用无必填参数的数据集' });
  }
  const rowRules = (row.rowRules ?? []) as ReportRowRule[];
  if (rowRules.some((rule) => rule.enabled ?? true)) {
    throw new HTTPException(400, { message: '该数据集配置了行级权限，不能用于匿名分享或无身份定时任务' });
  }
}

export async function getDataset(id: number): Promise<ReportDataset> {
  const row = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: { datasource: { columns: { name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  return mapDataset(row);
}

export async function listDatasets(query: {
  page?: number; pageSize?: number; keyword?: string; datasourceId?: number; type?: string; status?: string;
}) {
  const { page = 1, pageSize = 20, keyword, datasourceId, type, status } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasets);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDatasets.name, kw), ilike(reportDatasets.remark, kw)));
  }
  if (datasourceId) conds.push(eq(reportDatasets.datasourceId, datasourceId));
  if (type && (REPORT_DATASOURCE_TYPES as readonly string[]).includes(type)) {
    conds.push(eq(reportDatasets.type, type as ReportDatasourceType));
  }
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportDatasets.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDatasets, where),
    db.query.reportDatasets.findMany({
      where,
      with: { datasource: { columns: { name: true } } },
      orderBy: desc(reportDatasets.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapDataset), total, page, pageSize };
}

export async function listDatasetLookup(query: {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  limit?: number;
}): Promise<ReportLookupOption[]> {
  const { keyword, status, limit = 20 } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasets);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDatasets.name, kw), ilike(reportDatasets.remark, kw)));
  }
  if (status) conds.push(eq(reportDatasets.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select({
    id: reportDatasets.id,
    name: reportDatasets.name,
    status: reportDatasets.status,
    datasourceId: reportDatasets.datasourceId,
    datasourceName: reportDatasources.name,
    type: reportDatasets.type,
  }).from(reportDatasets)
    .leftJoin(reportDatasources, eq(reportDatasources.id, reportDatasets.datasourceId))
    .where(where)
    .orderBy(desc(reportDatasets.id))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    datasourceId: row.datasourceId,
    datasourceName: row.datasourceName ?? null,
    type: row.type,
  }));
}

function buildCopyName(baseName: string, existingNames: Set<string>): string {
  const normalized = new Set(Array.from(existingNames).map((name) => name.trim().toLowerCase()));
  const base = baseName.trim() || '未命名副本';
  const direct = `${base} 副本`;
  if (!normalized.has(direct.toLowerCase())) return direct;
  for (let index = 2; index <= 200; index += 1) {
    const candidate = `${base} 副本 ${index}`;
    if (!normalized.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} 副本 ${Date.now()}`;
}

export async function batchSetDatasetStatus(ids: number[], status: 'enabled' | 'disabled'): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.update(reportDatasets).set({ status }).where(reportScopedWhere(reportDatasets, inArray(reportDatasets.id, ids))).returning({ id: reportDatasets.id });
  return result.length;
}

export async function cloneDataset(id: number, input?: { name?: string | null }): Promise<ReportDataset> {
  const current = await ensureDatasetExists(id);
  const rows = await db.select({ name: reportDatasets.name }).from(reportDatasets).where(reportTenantScope(reportDatasets));
  const name = input?.name?.trim() || buildCopyName(current.name, new Set(rows.map((row) => row.name)));
  try {
    const [row] = await db.insert(reportDatasets).values({
      tenantId: current.tenantId ?? reportCreateTenantId(),
      name,
      datasourceId: current.datasourceId,
      type: current.type,
      content: (current.content ?? {}) as ReportDatasetContent,
      fields: (current.fields ?? []) as ReportField[],
      params: (current.params ?? []) as ReportDatasetParam[],
      computedFields: (current.computedFields ?? []) as ReportComputedField[],
      cacheTtl: current.cacheTtl ?? 0,
      materialize: { ...(current.materialize ?? {}), enabled: false, refreshedAt: null, refreshedAtMs: null } as ReportDatasetMaterialize,
      rowRules: (current.rowRules ?? []) as ReportRowRule[],
      status: current.status,
      remark: current.remark ?? null,
    }).returning();
    return mapDataset(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '复制后的数据集名称已存在，请修改后重试');
    throw err;
  }
}

/**
 * 物化前置校验：物化为「全局快照」，忽略运行时参数且不含用户上下文。
 * 因此禁止在 ① 使用数据权限系统变量(${__userId} 等) ② 声明了任何参数 ③ 配置了行级权限规则
 * 的数据集上启用，否则会出现跨用户数据串号 / 筛选被静默忽略。
 */
function assertMaterializable(
  materialize: ReportDatasetMaterialize | null | undefined,
  type: ReportDatasourceType,
  content: ReportDatasetContent,
  params: ReportDatasetParam[] | undefined,
  rowRules?: ReportRowRule[] | null,
): void {
  if (!materialize?.enabled) return;
  const sqlText = isSqlLikeType(type) ? ((content as ReportSqlDatasetContent).sql ?? '') : '';
  if (/\$\{\s*__\w+\s*\}/.test(sqlText)) {
    throw new HTTPException(400, { message: '该数据集使用了数据权限系统变量（${__userId} 等），启用物化会导致跨用户数据串号，请先关闭物化' });
  }
  if ((params ?? []).length > 0) {
    throw new HTTPException(400, { message: '含参数的数据集不支持物化：物化为全局快照会忽略运行时参数/筛选，请先移除参数或关闭物化' });
  }
  if ((rowRules ?? []).some((r) => r.enabled ?? true)) {
    throw new HTTPException(400, { message: '配置了行级权限规则的数据集不支持物化：物化快照对所有人一致，会绕过行级过滤' });
  }
}

export async function createDataset(input: CreateReportDatasetInput): Promise<ReportDataset> {
  const ds = await ensureDatasourceExists(input.datasourceId);
  const content = normalizeDatasetContent(ds.type, input.content);
  validateDatasetDefinitions(input.fields as ReportField[] | undefined, input.params as ReportDatasetParam[] | undefined, input.computedFields as ReportComputedField[] | undefined);
  assertMaterializable(input.materialize as ReportDatasetMaterialize | undefined, ds.type, content, input.params as ReportDatasetParam[] | undefined, input.rowRules as ReportRowRule[] | undefined);
  try {
    const [row] = await db.insert(reportDatasets).values({
      tenantId: reportCreateTenantId(),
      name: input.name,
      datasourceId: input.datasourceId,
      type: ds.type,
      content,
      fields: (input.fields ?? []) as ReportField[],
      params: (input.params ?? []) as ReportDatasetParam[],
      computedFields: (input.computedFields ?? []) as ReportComputedField[],
      cacheTtl: input.cacheTtl ?? 0,
      materialize: (input.materialize ?? {}) as ReportDatasetMaterialize,
      rowRules: (input.rowRules ?? []) as ReportRowRule[],
      status: input.status ?? 'enabled',
      remark: input.remark,
    }).returning();
    return mapDataset(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据集名称已存在');
    throw err;
  }
}

export async function updateDataset(id: number, input: UpdateReportDatasetInput): Promise<ReportDataset> {
  const current = await ensureDatasetExists(id);
  let type: ReportDatasourceType = current.type;
  if (input.datasourceId && input.datasourceId !== current.datasourceId) {
    const ds = await ensureDatasourceExists(input.datasourceId);
    type = ds.type;
  }
  const content = input.content !== undefined ? normalizeDatasetContent(type, input.content) : undefined;
  const typeChanged = input.datasourceId != null && input.datasourceId !== current.datasourceId;
  // 用合并后的最终态校验物化约束（部分更新时回退到现值）
  const effMaterialize = (input.materialize ?? current.materialize) as ReportDatasetMaterialize | undefined;
  const effContent = (content ?? current.content) as ReportDatasetContent;
  const effParams = (input.params ?? current.params) as ReportDatasetParam[] | undefined;
  const effFields = (input.fields ?? current.fields) as ReportField[] | undefined;
  const effComputed = (input.computedFields ?? current.computedFields) as ReportComputedField[] | undefined;
  const effRowRules = (input.rowRules ?? current.rowRules) as ReportRowRule[] | undefined;
  validateDatasetDefinitions(effFields, effParams, effComputed);
  assertMaterializable(effMaterialize, type, effContent, effParams, effRowRules);
  try {
    const [row] = await db.update(reportDatasets).set({
      name: input.name,
      datasourceId: input.datasourceId,
      type: typeChanged ? type : undefined,
      content,
      fields: input.fields as ReportField[] | undefined,
      params: input.params as ReportDatasetParam[] | undefined,
      computedFields: input.computedFields as ReportComputedField[] | undefined,
      cacheTtl: input.cacheTtl,
      materialize: input.materialize as ReportDatasetMaterialize | undefined,
      rowRules: input.rowRules as ReportRowRule[] | undefined,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportDatasets.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '数据集不存在' });
    await clearDatasetCache(id);
    return mapDataset(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据集名称已存在');
    throw err;
  }
}

// ─── 血缘（下游引用）────────────────────────────────────────────────────────────

/** 收集数据集的下游引用：仪表盘（组件绑定/筛选器动态选项）、打印模板、预警规则及间接分享链路 */
export async function collectDatasetRefs(id: number): Promise<ReportDatasetRefs> {
  const dataset = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: { datasource: { columns: { id: true, name: true } } },
  });
  if (!dataset) throw new HTTPException(404, { message: '数据集不存在' });
  const [dashRows, printRows, alertRows] = await Promise.all([
    db.select({
      id: reportDashboards.id,
      name: reportDashboards.name,
      widgets: reportDashboards.widgets,
      filters: reportDashboards.filters,
      publishedSnapshot: reportDashboards.publishedSnapshot,
      categoryId: reportDashboards.categoryId,
    })
      .from(reportDashboards).where(reportTenantScope(reportDashboards)),
    db.select({ id: reportPrintTemplates.id, name: reportPrintTemplates.name }).from(reportPrintTemplates)
      .where(reportScopedWhere(reportPrintTemplates, eq(reportPrintTemplates.datasetId, id))),
    db.select({ id: reportAlertRules.id, name: reportAlertRules.name }).from(reportAlertRules)
      .where(reportScopedWhere(reportAlertRules, eq(reportAlertRules.datasetId, id))),
  ]);
  const dashboards = dashRows
    .map((d) => {
      const draftWidgets = ((d.widgets ?? []) as ReportWidget[])
        .filter((w) => w.datasetId === id)
        .map((w) => w.title || w.i);
      const draftFilterIds = ((d.filters ?? []) as ReportFilter[])
        .filter((f) => f.optionSource?.kind === 'dataset' && f.optionSource.datasetId === id)
        .map((f) => f.label || f.id);
      const published = (d.publishedSnapshot ?? null) as ReportDashboardSnapshot | null;
      const publishedWidgets = (published?.widgets ?? [])
        .filter((w) => w.datasetId === id)
        .map((w) => `${w.title || w.i}（已发布）`);
      const publishedFilterIds = (published?.filters ?? [])
        .filter((f) => f.optionSource?.kind === 'dataset' && f.optionSource.datasetId === id)
        .map((f) => `${f.label || f.id}（已发布）`);
      const widgets = [...new Set([...draftWidgets, ...publishedWidgets])];
      const filterIds = [...new Set([...draftFilterIds, ...publishedFilterIds])];
      return { id: d.id, name: d.name, widgets, filterIds };
    })
    .filter((d) => d.widgets.length > 0 || d.filterIds.length > 0);
  const dashboardIds = dashboards.map((item) => item.id);
  const [subscriptionRows, shareRows, embedRows] = dashboardIds.length
    ? await Promise.all([
      db.select({ id: reportDashboardSubscriptions.id, dashboardId: reportDashboardSubscriptions.dashboardId, name: reportDashboards.name })
        .from(reportDashboardSubscriptions)
        .innerJoin(reportDashboards, eq(reportDashboards.id, reportDashboardSubscriptions.dashboardId))
        .where(reportScopedWhere(reportDashboardSubscriptions, inArray(reportDashboardSubscriptions.dashboardId, dashboardIds))),
      db.select({ id: reportDashboardShares.id, dashboardId: reportDashboardShares.dashboardId, name: reportDashboards.name })
        .from(reportDashboardShares)
        .innerJoin(reportDashboards, eq(reportDashboards.id, reportDashboardShares.dashboardId))
        .where(inArray(reportDashboardShares.dashboardId, dashboardIds)),
      db.select({ id: reportDashboardEmbedTokens.id, dashboardId: reportDashboardEmbedTokens.dashboardId, name: reportDashboards.name })
        .from(reportDashboardEmbedTokens)
        .innerJoin(reportDashboards, eq(reportDashboards.id, reportDashboardEmbedTokens.dashboardId))
        .where(inArray(reportDashboardEmbedTokens.dashboardId, dashboardIds)),
    ])
    : [[], [], []];

  const nodes: NonNullable<ReportDatasetRefs['nodes']> = [];
  const edges: NonNullable<ReportDatasetRefs['edges']> = [];
  const datasourceNodeId = `datasource:${dataset.datasourceId}`;
  const datasetNodeId = `dataset:${dataset.id}`;
  nodes.push({ id: datasourceNodeId, type: 'datasource', refId: dataset.datasourceId, label: dataset.datasource?.name ?? '数据源' });
  nodes.push({ id: datasetNodeId, type: 'dataset', refId: dataset.id, parentId: datasourceNodeId, label: dataset.name });
  edges.push({ id: `${datasourceNodeId}->${datasetNodeId}`, source: datasourceNodeId, target: datasetNodeId, label: '提供' });
  dashboards.forEach((dashboard) => {
    const dashboardNodeId = `dashboard:${dashboard.id}`;
    nodes.push({ id: dashboardNodeId, type: 'dashboard', refId: dashboard.id, parentId: datasetNodeId, label: dashboard.name });
    edges.push({ id: `${datasetNodeId}->${dashboardNodeId}`, source: datasetNodeId, target: dashboardNodeId, label: '驱动' });
    dashboard.widgets.forEach((widgetLabel, index) => {
      const widgetNodeId = `widget:${dashboard.id}:${index}`;
      nodes.push({ id: widgetNodeId, type: 'widget', parentId: dashboardNodeId, label: widgetLabel, meta: { dashboardId: dashboard.id } });
      edges.push({ id: `${dashboardNodeId}->${widgetNodeId}`, source: dashboardNodeId, target: widgetNodeId, label: '组件' });
    });
    dashboard.filterIds.forEach((filterLabel, index) => {
      const filterNodeId = `filter:${dashboard.id}:${index}`;
      nodes.push({ id: filterNodeId, type: 'filter', parentId: dashboardNodeId, label: filterLabel, meta: { dashboardId: dashboard.id } });
      edges.push({ id: `${dashboardNodeId}->${filterNodeId}`, source: dashboardNodeId, target: filterNodeId, label: '筛选器' });
    });
  });
  printRows.forEach((item) => {
    const nodeId = `print:${item.id}`;
    nodes.push({ id: nodeId, type: 'print', refId: item.id, parentId: datasetNodeId, label: item.name });
    edges.push({ id: `${datasetNodeId}->${nodeId}`, source: datasetNodeId, target: nodeId, label: '打印' });
  });
  alertRows.forEach((item) => {
    const nodeId = `alert:${item.id}`;
    nodes.push({ id: nodeId, type: 'alert', refId: item.id, parentId: datasetNodeId, label: item.name });
    edges.push({ id: `${datasetNodeId}->${nodeId}`, source: datasetNodeId, target: nodeId, label: '预警' });
  });
  subscriptionRows.forEach((item) => {
    const dashboardNodeId = `dashboard:${item.dashboardId}`;
    const nodeId = `subscription:${item.id}`;
    nodes.push({ id: nodeId, type: 'subscription', refId: item.id, parentId: dashboardNodeId, label: `${item.name} · 订阅` });
    edges.push({ id: `${dashboardNodeId}->${nodeId}`, source: dashboardNodeId, target: nodeId, label: '订阅' });
  });
  shareRows.forEach((item) => {
    const dashboardNodeId = `dashboard:${item.dashboardId}`;
    const nodeId = `share:${item.id}`;
    nodes.push({ id: nodeId, type: 'share', refId: item.id, parentId: dashboardNodeId, label: `${item.name} · 分享` });
    edges.push({ id: `${dashboardNodeId}->${nodeId}`, source: dashboardNodeId, target: nodeId, label: '分享' });
  });
  embedRows.forEach((item) => {
    const dashboardNodeId = `dashboard:${item.dashboardId}`;
    const nodeId = `embed:${item.id}`;
    nodes.push({ id: nodeId, type: 'embed', refId: item.id, parentId: dashboardNodeId, label: `${item.name} · 嵌入` });
    edges.push({ id: `${dashboardNodeId}->${nodeId}`, source: dashboardNodeId, target: nodeId, label: '嵌入' });
  });
  return {
    dashboards,
    printTemplates: printRows,
    alerts: alertRows,
    subscriptions: subscriptionRows,
    shares: shareRows,
    embedTokens: embedRows,
    nodes,
    edges,
  };
}

/** 删除数据集：存在下游引用时拒绝（防仪表盘悄悄失效 / 预警被级联误删） */
export async function deleteDataset(id: number): Promise<void> {
  await ensureDatasetExists(id);
  const refs = await collectDatasetRefs(id);
  const parts: string[] = [];
  if (refs.dashboards.length) parts.push(`仪表盘 ${refs.dashboards.map((d) => `《${d.name}》`).join('、')}`);
  if (refs.printTemplates.length) parts.push(`打印报表 ${refs.printTemplates.map((t) => `《${t.name}》`).join('、')}`);
  if (refs.alerts.length) parts.push(`预警规则 ${refs.alerts.map((a) => `《${a.name}》`).join('、')}`);
  if (refs.subscriptions?.length) parts.push(`订阅 ${refs.subscriptions.map((s) => `《${s.name}》`).join('、')}`);
  if (refs.shares?.length) parts.push(`分享 ${refs.shares.map((s) => `《${s.name}》`).join('、')}`);
  if (refs.embedTokens?.length) parts.push(`嵌入 ${refs.embedTokens.map((s) => `《${s.name}》`).join('、')}`);
  if (parts.length) {
    throw new HTTPException(400, { message: `该数据集正被引用，无法删除：${parts.join('；')}。请先在「血缘」中查看并解除引用` });
  }
  await db.delete(reportDatasets).where(eq(reportDatasets.id, id));
  await clearDatasetCache(id);
}

function mapDatasetExecutionLog(row: {
  id: number;
  datasetId: number | null;
  datasetName: string | null;
  datasourceId: number | null;
  datasourceName: string | null;
  userId: number | null;
  username: string | null;
  tenantId: number | null;
  scene: string;
  sourceRefId: string | null;
  durationMs: number;
  rowCount: number | null;
  bytes: number | null;
  truncated: boolean;
  slow: boolean;
  cacheHit: boolean;
  success: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  paramKeys: string[];
  executedAt: Date;
}): ReportDatasetExecutionLog {
  return {
    id: row.id,
    datasetId: row.datasetId,
    datasetName: row.datasetName,
    datasourceId: row.datasourceId,
    datasourceName: row.datasourceName,
    userId: row.userId,
    username: row.username,
    tenantId: row.tenantId,
    scene: row.scene,
    sourceRefId: row.sourceRefId,
    durationMs: row.durationMs,
    rowCount: row.rowCount,
    bytes: row.bytes,
    truncated: row.truncated,
    slow: row.slow,
    cacheHit: row.cacheHit,
    success: row.success,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    paramKeys: row.paramKeys ?? [],
    executedAt: formatDateTime(row.executedAt),
  };
}

export async function listDatasetExecutionLogs(query: {
  page?: number;
  pageSize?: number;
  datasetId?: number;
  datasourceId?: number;
  scene?: string;
  success?: boolean;
  dashboardId?: number;
  slow?: boolean;
  startAt?: Date;
  endAt?: Date;
}) {
  const { page = 1, pageSize = 20, datasetId, datasourceId, scene, success, dashboardId, slow, startAt, endAt } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasetExecutionLogs);
  if (tenantScope) conds.push(tenantScope);
  if (datasetId) conds.push(eq(reportDatasetExecutionLogs.datasetId, datasetId));
  if (datasourceId) conds.push(eq(reportDatasetExecutionLogs.datasourceId, datasourceId));
  if (scene) conds.push(eq(reportDatasetExecutionLogs.scene, scene));
  if (success !== undefined) conds.push(eq(reportDatasetExecutionLogs.success, success));
  if (dashboardId) conds.push(and(eq(reportDatasetExecutionLogs.scene, 'dashboard'), eq(reportDatasetExecutionLogs.sourceRefId, String(dashboardId))));
  if (slow !== undefined) conds.push(eq(reportDatasetExecutionLogs.slow, slow));
  if (startAt) conds.push(gte(reportDatasetExecutionLogs.executedAt, startAt));
  if (endAt) conds.push(lte(reportDatasetExecutionLogs.executedAt, endAt));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDatasetExecutionLogs, where),
    db.select({
      id: reportDatasetExecutionLogs.id,
      datasetId: reportDatasetExecutionLogs.datasetId,
      datasetName: reportDatasets.name,
      datasourceId: reportDatasetExecutionLogs.datasourceId,
      datasourceName: reportDatasources.name,
      userId: reportDatasetExecutionLogs.userId,
      username: users.username,
      tenantId: reportDatasetExecutionLogs.tenantId,
      scene: reportDatasetExecutionLogs.scene,
      sourceRefId: reportDatasetExecutionLogs.sourceRefId,
      durationMs: reportDatasetExecutionLogs.durationMs,
      rowCount: reportDatasetExecutionLogs.rowCount,
      bytes: reportDatasetExecutionLogs.bytes,
      truncated: reportDatasetExecutionLogs.truncated,
      slow: reportDatasetExecutionLogs.slow,
      cacheHit: reportDatasetExecutionLogs.cacheHit,
      success: reportDatasetExecutionLogs.success,
      errorCode: reportDatasetExecutionLogs.errorCode,
      errorMessage: reportDatasetExecutionLogs.errorMessage,
      paramKeys: reportDatasetExecutionLogs.paramKeys,
      executedAt: reportDatasetExecutionLogs.executedAt,
    })
      .from(reportDatasetExecutionLogs)
      .leftJoin(reportDatasets, eq(reportDatasets.id, reportDatasetExecutionLogs.datasetId))
      .leftJoin(reportDatasources, eq(reportDatasources.id, reportDatasetExecutionLogs.datasourceId))
      .leftJoin(users, eq(users.id, reportDatasetExecutionLogs.userId))
      .where(where)
      .orderBy(desc(reportDatasetExecutionLogs.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  const list = rows.map((row) => mapDatasetExecutionLog({
    ...row,
    datasourceName: row.datasourceName ?? null,
    paramKeys: (row.paramKeys ?? []) as string[],
  }));
  return { list, total, page, pageSize };
}

export async function getDatasetExecutionStats(query: {
  datasetId?: number;
  datasourceId?: number;
  dashboardId?: number;
  scene?: string;
  success?: boolean;
  startAt?: Date;
  endAt?: Date;
}): Promise<ReportExecutionStats> {
  const conds = [];
  const tenantScope = reportTenantScope(reportDatasetExecutionLogs);
  if (tenantScope) conds.push(tenantScope);
  if (query.datasetId) conds.push(eq(reportDatasetExecutionLogs.datasetId, query.datasetId));
  if (query.datasourceId) conds.push(eq(reportDatasetExecutionLogs.datasourceId, query.datasourceId));
  if (query.scene) conds.push(eq(reportDatasetExecutionLogs.scene, query.scene));
  if (query.success !== undefined) conds.push(eq(reportDatasetExecutionLogs.success, query.success));
  if (query.dashboardId) conds.push(and(eq(reportDatasetExecutionLogs.scene, 'dashboard'), eq(reportDatasetExecutionLogs.sourceRefId, String(query.dashboardId))));
  if (query.startAt) conds.push(gte(reportDatasetExecutionLogs.executedAt, query.startAt));
  if (query.endAt) conds.push(lte(reportDatasetExecutionLogs.executedAt, query.endAt));
  const where = conds.length ? and(...conds) : undefined;
  const [aggRows, slowRows] = await Promise.all([
   db.select({
     total: sql<number>`count(*)::int`,
     successCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.success} then 1 else 0 end)::int`,
     avgDurationMs: sql<number | null>`round(avg(${reportDatasetExecutionLogs.durationMs}))::int`,
     p95DurationMs: sql<number | null>`round(percentile_cont(0.95) within group (order by ${reportDatasetExecutionLogs.durationMs}))::int`,
     cacheHitCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.cacheHit} then 1 else 0 end)::int`,
     slowCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.slow} then 1 else 0 end)::int`,
     truncatedCount: sql<number>`sum(case when ${reportDatasetExecutionLogs.truncated} then 1 else 0 end)::int`,
   }).from(reportDatasetExecutionLogs).where(where),
   db.select({
     datasetId: reportDatasetExecutionLogs.datasetId,
     datasetName: reportDatasets.name,
     datasourceId: reportDatasetExecutionLogs.datasourceId,
     datasourceName: reportDatasources.name,
     scene: reportDatasetExecutionLogs.scene,
     count: sql<number>`count(*)::int`,
     avgDurationMs: sql<number>`round(avg(${reportDatasetExecutionLogs.durationMs}))::int`,
     maxDurationMs: sql<number>`max(${reportDatasetExecutionLogs.durationMs})::int`,
     lastExecutedAt: sql<Date | null>`max(${reportDatasetExecutionLogs.executedAt})`,
   }).from(reportDatasetExecutionLogs)
     .leftJoin(reportDatasets, eq(reportDatasets.id, reportDatasetExecutionLogs.datasetId))
     .leftJoin(reportDatasources, eq(reportDatasources.id, reportDatasetExecutionLogs.datasourceId))
     .where(where ? and(where, eq(reportDatasetExecutionLogs.slow, true)) : eq(reportDatasetExecutionLogs.slow, true))
     .groupBy(reportDatasetExecutionLogs.datasetId, reportDatasets.name, reportDatasetExecutionLogs.datasourceId, reportDatasources.name, reportDatasetExecutionLogs.scene)
     .orderBy(desc(sql`max(${reportDatasetExecutionLogs.durationMs})`))
     .limit(10),
  ]);
  const agg = aggRows[0] ?? {
   total: 0, successCount: 0, avgDurationMs: 0, p95DurationMs: 0, cacheHitCount: 0, slowCount: 0, truncatedCount: 0,
  };
  const total = Number(agg.total ?? 0);
  return {
   total,
   successCount: Number(agg.successCount ?? 0),
   successRate: total > 0 ? Math.round((Number(agg.successCount ?? 0) / total) * 10000) / 100 : 0,
   p95DurationMs: Number(agg.p95DurationMs ?? 0),
   avgDurationMs: Number(agg.avgDurationMs ?? 0),
   cacheHitRate: total > 0 ? Math.round((Number(agg.cacheHitCount ?? 0) / total) * 10000) / 100 : 0,
   slowCount: Number(agg.slowCount ?? 0),
   truncatedCount: Number(agg.truncatedCount ?? 0),
   governance: getReportRuntimeGovernance(),
   topSlowQueries: slowRows.map((row) => ({
     datasetId: row.datasetId ?? null,
     datasetName: row.datasetName ?? null,
     datasourceId: row.datasourceId ?? null,
     datasourceName: row.datasourceName ?? null,
     scene: row.scene,
     count: Number(row.count ?? 0),
     avgDurationMs: Number(row.avgDurationMs ?? 0),
     maxDurationMs: Number(row.maxDurationMs ?? 0),
     lastExecutedAt: row.lastExecutedAt ? formatDateTime(row.lastExecutedAt) : null,
   })),
  };
}

// ─── 取数核心 ────────────────────────────────────────────────────────────────

/** 按数据源类型执行取数；sql 走只读绑定执行器，mysql/postgresql 走外部库，api 走 http-client。最后应用计算字段 */
export async function runReportData(
  type: ReportDatasourceType,
  config: ReportDatasourceConfig,
  content: ReportDatasetContent,
  params: Record<string, unknown> = {},
  query: DatasetQueryArg = PREVIEW_LIMIT,
  fields?: ReportField[],
  computedFields?: ReportComputedField[],
): Promise<ReportDataResult> {
  const queryOptions = normalizeDatasetQueryOptions(query);

  if (type === 'sql') {
    const sqlText = ((content as ReportSqlDatasetContent).sql ?? '').trim();
    if (!sqlText) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
    return withFieldMetadata(applyComputedFields(await runReadonlySql(sqlText, params, queryOptions), computedFields), fields, computedFields);
  }

  if (isExternalDbType(type)) {
    const sqlText = ((content as ReportSqlDatasetContent).sql ?? '').trim();
    if (!sqlText) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
    const { text, values } = buildExternalParamSql(sqlText, params, type as 'mysql' | 'postgresql' | 'sqlserver');
    const result = await runExternalQuery(type, config as ReportExternalDbConfig, text, values, queryOptions);
    return withFieldMetadata(applyComputedFields(result, computedFields), fields, computedFields);
  }

  if (type === 'static') {
    const staticContent = (content ?? {}) as ReportStaticDatasetContent;
    const rows = Array.isArray(staticContent.data) ? staticContent.data : [];
    const columns = staticContent.columns?.length
      ? staticContent.columns
      : (rows.length ? Object.keys(rows[0]) : []);
    return withFieldMetadata(applyComputedFields(applyInMemoryQuery(rows, columns, queryOptions), computedFields), fields, computedFields);
  }

  // api
  const apiCfg = config as ReportApiDatasourceConfig;
  if (!apiCfg?.url) throw new HTTPException(400, { message: '数据源未配置 URL' });
  const apiContent = (content ?? {}) as ReportApiDatasetContent;
  const method = apiCfg.method === 'POST' ? 'POST' : 'GET';
  // 合并静态 content.params 与运行时 params（运行时优先），剔除空值
  const merged: Record<string, unknown> = { ...(apiContent.params ?? {}), ...params };
  const effective = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  let url = apiCfg.url;
  let body: Record<string, unknown> | undefined;
  if (Object.keys(effective).length > 0) {
    if (method === 'GET') {
      const u = new URL(apiCfg.url);
      for (const [k, v] of Object.entries(effective)) u.searchParams.set(k, String(v));
      url = u.toString();
    } else {
      body = { ...effective };
    }
  }

  let json: unknown;
  try {
    const res = await httpRequest(url, {
      method,
      headers: resolveApiHeaders(apiCfg.headers),
      body,
      timeout: 10_000,
      ssrfProtection: true,
      httpLog: { level: 'off' },
    });
    if (!res.ok) throw new HTTPException(502, { message: `数据源返回状态 ${res.status}` });
    json = await res.json();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(502, { message: '数据源请求失败，请检查 URL 与网络' });
  }

  const arr = navigatePath(json, apiContent.itemsPath);
  if (!Array.isArray(arr)) {
    throw new HTTPException(502, { message: '数据源返回结构不是数组，请检查「数组路径」配置' });
  }
  const sourceRows = arr as Record<string, unknown>[];
  const columns = sourceRows.length > 0 ? Object.keys(sourceRows[0] ?? {}) : [];
  return withFieldMetadata(applyComputedFields(applyInMemoryQuery(sourceRows, columns, queryOptions), computedFields), fields, computedFields);
}

/** 试跑预览（不落库）：用未保存的数据源 + content + 运行时参数取数（`__` 前缀由系统变量权威注入，剥离客户端伪造值） */
export async function previewDataset(input: ReportDatasetPreviewInput): Promise<ReportDataResult> {
  const ds = await ensureDatasourceExists(input.datasourceId);
  ensureDatasourceEnabled(ds);
  const content = normalizeDatasetContent(ds.type, input.content);
  const sqlText = isSqlLikeType(ds.type) ? ((content as ReportSqlDatasetContent).sql ?? '') : '';
  const provided = Object.fromEntries(
    Object.entries((input.params ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith('__')),
  );
  const params = { ...provided, ...await buildSystemParams(sqlText) };
  const computed = (input.computedFields ?? []) as ReportComputedField[];
  return runReportData(ds.type, (ds.config ?? {}) as ReportDatasourceConfig, content, params, input.limit ?? PREVIEW_LIMIT, [], computed);
}

function datasetVersionToken(row: { updatedAt: Date; datasource?: { updatedAt?: Date | null } | null }): string {
  return `${row.updatedAt.getTime()}:${row.datasource?.updatedAt?.getTime?.() ?? 0}`;
}

function datasetCacheKey(id: number, version: string, hash: string): string {
  return `${CACHE_PREFIX}${id}:${version}:${hash}`;
}

function materializedCacheKey(id: number, version: string): string {
  return `${MATVIEW_PREFIX}${id}:${version}`;
}

function toExecutionError(err: unknown): { code: number; message: string } {
  if (err instanceof HTTPException) {
    return { code: err.status, message: err.message };
  }
  if (err instanceof Error) {
    return { code: 500, message: err.message };
  }
  return { code: 500, message: String(err) };
}

async function recordDatasetExecutionLog(input: {
  row: ReportDatasetRow & { datasource?: { id: number; name: string | null } | null };
  resolvedParams?: Record<string, unknown>;
  durationMs: number;
  rowCount?: number | null;
  bytes?: number | null;
  truncated?: boolean;
  cacheHit: boolean;
  success: boolean;
  error?: { code: number; message: string } | null;
  runtime?: DatasetExecutionContext;
}) {
  const user = currentUserOrNull();
  const governance = getReportRuntimeGovernance();
  try {
    await db.insert(reportDatasetExecutionLogs).values({
      tenantId: rowTenantId(input.row),
      datasetId: input.row.id,
      datasourceId: input.row.datasourceId,
      userId: user?.userId ?? null,
      scene: input.runtime?.scene ?? 'dataset',
      sourceRefId: input.runtime?.sourceRefId == null ? null : String(input.runtime.sourceRefId),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      rowCount: input.rowCount ?? null,
      bytes: input.bytes ?? null,
      truncated: input.truncated ?? false,
      slow: input.durationMs >= governance.slowQueryMs,
      cacheHit: input.cacheHit,
      success: input.success,
      errorCode: input.error?.code ?? null,
      errorMessage: input.error?.message?.slice(0, 512) ?? null,
      paramKeys: Object.keys(input.resolvedParams ?? {}).filter((key) => !key.startsWith('__')).sort(),
    });
  } catch (err) {
    logger.warn('记录报表数据集执行日志失败', { datasetId: input.row.id, err: err instanceof Error ? err.message : String(err) });
  }
  if (input.row.datasourceId) {
    await markDatasourceExecutionHealth(input.row.datasourceId, {
      success: input.success,
      latencyMs: input.durationMs,
      error: input.error?.message ?? null,
    }).catch(() => undefined);
  }
}

function rowTenantId(row: { tenantId?: number | null }): number | null {
  return row.tenantId ?? currentUserOrNull()?.tenantId ?? null;
}

/** 清除某数据集的全部缓存（更新/删除时调用）：版本化缓存 + 物化快照 */
export async function clearDatasetCache(id: number): Promise<void> {
  try {
    const keys: string[] = [];
    for (const pattern of [`${CACHE_PREFIX}${id}:*`, `${MATVIEW_PREFIX}${id}:*`]) {
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');
    }
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    logger.warn('清理报表数据集缓存失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
  }
}

/** 取已保存数据集的数据（供仪表盘组件运行时调用，支持参数 + 行级权限 + Redis 缓存）*/
export async function getDatasetDataExecution(
  id: number,
  params?: Record<string, unknown>,
  query?: DatasetQueryArg,
  runtime?: DatasetExecutionContext,
): Promise<DatasetExecutionResult> {
  const startedAt = Date.now();
  const row = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: { datasource: { columns: { id: true, name: true, config: true, status: true, updatedAt: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  const config = (row.datasource?.config ?? {}) as ReportDatasourceConfig;
  const rawContent = (row.content ?? {}) as ReportDatasetContent;
  const isSqlLike = isSqlLikeType(row.type);
  const declaredFields = (row.fields ?? []) as ReportField[];
  const computed = (row.computedFields ?? []) as ReportComputedField[];
  const queryOptions = normalizeDatasetQueryOptions(query);
  const version = datasetVersionToken(row);
  let resolvedParams: Record<string, unknown> | undefined;
  let cacheHit = false;

  try {
    if (row.status !== 'enabled') throw new HTTPException(400, { message: '数据集已停用' });
    if (!row.datasource) throw new HTTPException(400, { message: '数据源不存在' });
    ensureDatasourceEnabled(row.datasource);
    // 物化快照优先：返回持久化全局快照（保存时已校验无参数/无系统变量/无行级规则，故与运行时参数/用户无关）
    const materialize = (row.materialize ?? {}) as ReportDatasetMaterialize;
    if (materialize.enabled) {
      const snapshotKey = materializedCacheKey(id, version);
      try {
        const snap = await redis.get(snapshotKey);
        if (snap) {
          cacheHit = true;
          const raw = JSON.parse(snap) as ReportDataResult;
          const snapshotTotal = raw.rows.length;
          const projected = applyDatasetGovernance(withFieldMetadata(
            applyInMemoryQuery(raw.rows, raw.columns, queryOptions, snapshotTotal),
            declaredFields,
            computed,
          ));
          await recordDatasetExecutionLog({
            row,
            durationMs: Date.now() - startedAt,
            rowCount: projected.rows.length,
            bytes: projected.bytes ?? null,
            truncated: projected.truncated ?? false,
            cacheHit,
            success: true,
            runtime,
          });
          return { data: projected, durationMs: Date.now() - startedAt, cacheHit };
        }
      } catch (err) {
        logger.warn('读取报表物化快照失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
      const live = await runReportData(row.type, config, rawContent, {}, MAX_LIMIT, declaredFields, computed);
      const snapshot = { ...live, total: live.rows.length };
      try {
        await redis.set(snapshotKey, JSON.stringify(snapshot), 'EX', MATVIEW_TTL_SECONDS);
      } catch (err) {
        logger.warn('写入报表物化快照失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
      const projected = applyDatasetGovernance(withFieldMetadata(
        applyInMemoryQuery(snapshot.rows, snapshot.columns, queryOptions, snapshot.rows.length),
        declaredFields,
        computed,
      ));
      await recordDatasetExecutionLog({
        row,
        durationMs: Date.now() - startedAt,
        rowCount: projected.rows.length,
        bytes: projected.bytes ?? null,
        truncated: projected.truncated ?? false,
        cacheHit: false,
        success: true,
        runtime,
      });
      return { data: projected, durationMs: Date.now() - startedAt, cacheHit: false };
    }

    // 行级权限：命中规则以 OR 包裹原查询；无上下文拒绝，未命中注入恒假条件，超管不受限
    const effectiveRules = isSqlLike ? resolveEffectiveRowRules(row.rowRules as ReportRowRule[] | null) : [];
    const rawSqlText = isSqlLike ? ((rawContent as ReportSqlDatasetContent).sql ?? '') : '';
    const sqlText = effectiveRules.length ? applyRowRulesToSql(rawSqlText, effectiveRules) : rawSqlText;
    const content: ReportDatasetContent = effectiveRules.length
      ? { ...(rawContent as ReportSqlDatasetContent), sql: sqlText }
      : rawContent;

    const sysParams = await buildSystemParams(sqlText);
    resolvedParams = { ...resolveDatasetParams((row.params ?? []) as ReportDatasetParam[], params), ...sysParams };
    const cacheTtl = row.cacheTtl ?? 0;

    let cacheKey = '';
    if (cacheTtl > 0) {
      const rls = effectiveRules.map((item) => item.where);
      const hash = createHash('md5').update(JSON.stringify({ resolvedParams, queryOptions, rls, version })).digest('hex');
      cacheKey = datasetCacheKey(id, version, hash);
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          cacheHit = true;
          const data = applyDatasetGovernance(withFieldMetadata(JSON.parse(cached) as ReportDataResult, declaredFields, computed));
          await recordDatasetExecutionLog({
            row,
            resolvedParams,
            durationMs: Date.now() - startedAt,
            rowCount: data.rows.length,
            bytes: data.bytes ?? null,
            truncated: data.truncated ?? false,
            cacheHit,
            success: true,
            runtime,
          });
          return { data, durationMs: Date.now() - startedAt, cacheHit };
        }
      } catch (err) {
        logger.warn('读取报表数据集缓存失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
    }

    const data = applyDatasetGovernance(await runReportData(row.type, config, content, resolvedParams, queryOptions, declaredFields, computed));
    if (cacheTtl > 0 && cacheKey) {
      try {
        await redis.set(cacheKey, JSON.stringify(data), 'EX', cacheTtl);
      } catch (err) {
        logger.warn('写入报表数据集缓存失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
      }
    }
    await recordDatasetExecutionLog({
      row,
      resolvedParams,
      durationMs: Date.now() - startedAt,
      rowCount: data.rows.length,
      bytes: data.bytes ?? null,
      truncated: data.truncated ?? false,
      cacheHit: false,
      success: true,
      runtime,
    });
    return { data, durationMs: Date.now() - startedAt, cacheHit: false };
  } catch (err) {
    await recordDatasetExecutionLog({
      row,
      resolvedParams,
      durationMs: Date.now() - startedAt,
      rowCount: null,
      cacheHit,
      success: false,
      error: toExecutionError(err),
      runtime,
    });
    throw err;
  }
}

export async function getDatasetData(
  id: number,
  params?: Record<string, unknown>,
  query?: DatasetQueryArg,
  runtime?: DatasetExecutionContext,
): Promise<ReportDataResult> {
  return (await getDatasetDataExecution(id, params, query, runtime)).data;
}

// ─── 物化快照（定时刷新 + 手动刷新）────────────────────────────────────────────

/** 强制刷新某数据集的物化快照（手动按钮 / 到期 Cron 调用）*/
export async function refreshMaterialization(
  id: number,
  options?: { isCancelRequested?: () => Promise<boolean> },
): Promise<{ rows: number; cancelled?: boolean }> {
  if (await options?.isCancelRequested?.()) return { rows: 0, cancelled: true };
  const startedAt = Date.now();
  const row = await db.query.reportDatasets.findFirst({
    where: reportScopedWhere(reportDatasets, eq(reportDatasets.id, id)),
    with: { datasource: { columns: { config: true, status: true, updatedAt: true, id: true, name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  if (!row.datasource) throw new HTTPException(400, { message: '数据源不存在' });
  ensureDatasourceEnabled(row.datasource);
  const config = (row.datasource?.config ?? {}) as ReportDatasourceConfig;
  const content = (row.content ?? {}) as ReportDatasetContent;
  // 物化为全局快照，无参数（保存时已校验），统一空参数 + MAX_LIMIT
  const declaredFields = (row.fields ?? []) as ReportField[];
  const computed = (row.computedFields ?? []) as ReportComputedField[];
  const result = await runReportData(row.type, config, content, {}, MAX_LIMIT, declaredFields, computed);
  if (await options?.isCancelRequested?.()) return { rows: result.rows.length, cancelled: true };
  const snapshot = { ...result, total: result.rows.length };
  const now = new Date();
  const materialize = (row.materialize ?? {}) as ReportDatasetMaterialize;
  const [updatedRow] = await db.update(reportDatasets)
    .set({ materialize: { ...materialize, enabled: materialize.enabled ?? true, refreshedAt: formatDateTime(now), refreshedAtMs: now.getTime() } })
    .where(eq(reportDatasets.id, id))
    .returning({ updatedAt: reportDatasets.updatedAt });
  try {
    await redis.set(materializedCacheKey(id, `${updatedRow?.updatedAt?.getTime?.() ?? row.updatedAt.getTime()}:${row.datasource.updatedAt?.getTime?.() ?? 0}`), JSON.stringify(snapshot), 'EX', MATVIEW_TTL_SECONDS);
  } catch (err) {
    logger.warn('写入报表物化快照失败', { datasetId: id, err: err instanceof Error ? err.message : String(err) });
  }
  await recordDatasetExecutionLog({
    row,
    durationMs: Date.now() - startedAt,
    rowCount: result.rows.length,
    bytes: result.bytes ?? null,
    truncated: result.truncated ?? false,
    cacheHit: false,
    success: true,
    runtime: { scene: 'materialize', sourceRefId: id },
  });
  return { rows: result.rows.length };
}

/** Cron 分发：扫描启用物化的数据集，按各自 cron 判断到期后刷新（pg-boss 每分钟调用）*/
export async function dispatchDueMaterializations(): Promise<{ checked: number; refreshed: number }> {
  const rows = await db.select({ id: reportDatasets.id, materialize: reportDatasets.materialize, status: reportDatasets.status }).from(reportDatasets);
  const now = new Date();
  let refreshed = 0;
  let checked = 0;
  for (const r of rows) {
    const m = (r.materialize ?? {}) as ReportDatasetMaterialize;
    if (r.status !== 'enabled' || !m.enabled || !m.cron) continue;
    checked++;
    try {
      const prev = CronExpressionParser.parse(m.cron, { currentDate: now }).prev().toDate();
      const last = m.refreshedAtMs ?? 0;
      if (prev.getTime() > last) {
        await refreshMaterialization(r.id);
        refreshed++;
      }
    } catch (e) {
      logger.warn('报表物化刷新失败', { id: r.id, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return { checked, refreshed };
}
