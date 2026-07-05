/**
 * 报表数据集 Service
 * CRUD + 取数执行（preview 试跑 / data 取数）。
 * - sql：只读事务（READ ONLY + statement_timeout + 行上限）+ ${param} 绑定参数（防注入）。
 * - api：统一走 http-client 的 httpRequest（防 SSRF），按 itemsPath 提取数组，运行时参数注入。
 */
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { reportDatasets, reportDashboards, reportPrintTemplates, reportAlertRules, users } from '../../db/schema';
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
import { ensureDatasourceExists, resolveApiHeaders } from './report-datasource.service';
import { isSqlLikeType, isExternalDbType, REPORT_DATASOURCE_TYPES } from '@zenith/shared';
import type { ReportDatasetRow } from '../../db/schema';
import type {
  ReportDataset, ReportDataResult, ReportField, ReportFieldType, ReportDatasetContent, ReportDatasetParam,
  ReportDatasourceType, ReportDatasourceConfig, ReportComputedField, ReportExternalDbConfig,
  ReportApiDatasourceConfig, ReportApiDatasetContent, ReportSqlDatasetContent, ReportStaticDatasetContent, ReportDatasetMaterialize,
  ReportRowRule, ReportDatasetRefs, ReportWidget, ReportFilter,
  CreateReportDatasetInput, UpdateReportDatasetInput, ReportDatasetPreviewInput,
} from '@zenith/shared';

const PREVIEW_LIMIT = 100;
const MAX_LIMIT = 5000;
const QUERY_TIMEOUT = '15s';
const CACHE_PREFIX = `${config.redis.keyPrefix}report:dataset:`;
const MATVIEW_PREFIX = `${config.redis.keyPrefix}report:matview:`;
/** 物化快照安全 TTL（秒）：即便无 cron 刷新，也不会永久冻结（默认 24h） */
const MATVIEW_TTL_SECONDS = 24 * 60 * 60;

type DatasetRowWithDs = ReportDatasetRow & { datasource?: { name: string } | null };

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
      sql: typeof c.sql === 'string' ? c.sql : '',
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
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(provided ?? {}).filter(([k]) => !k.startsWith('__')),
  );
  for (const d of defs ?? []) {
    if (d.name.startsWith('__')) continue;
    const raw = provided?.[d.name];
    const val = (raw === undefined || raw === null || raw === '') ? (d.defaultValue ?? null) : coerceParam(raw, d.type);
    out[d.name] = val;
    if (d.required && (val === null || val === undefined)) {
      throw new HTTPException(400, { message: `缺少必填参数：${d.label || d.name}` });
    }
  }
  return out;
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

/** 只读执行 SQL（READ ONLY 事务 + 超时 + 行上限 + 参数绑定）*/
async function runReadonlySql(text: string, params: Record<string, unknown>, limit: number): Promise<ReportDataResult> {
  const trimmed = text.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
  const capped = Math.max(1, Math.min(limit || PREVIEW_LIMIT, MAX_LIMIT));
  const isSelect = !/;/.test(trimmed) && /^(select|with)\b/i.test(trimmed);
  const inner = buildParamSql(trimmed, params);
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL TRANSACTION READ ONLY'));
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`));
      if (isSelect) return await tx.execute(sql`SELECT * FROM (${inner}) AS _sub LIMIT ${capped}`);
      return await tx.execute(inner);
    });
    const arr = (rows as unknown as Record<string, unknown>[]) ?? [];
    const sliced = arr.slice(0, capped);
    const columns = sliced.length ? Object.keys(sliced[0]) : [];
    return { columns, rows: sliced, total: arr.length };
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
 * - 无用户上下文（Cron 评估 / 订阅推送 / 公开分享）→ 跳过行级过滤（创建者已过权限门槛且属主动公开）；
 * - 超级管理员不受限；规则未配置 roles = 对所有登录用户生效。
 */
function resolveEffectiveRowRules(rules: ReportRowRule[] | null | undefined): ReportRowRule[] {
  const list = (rules ?? []).filter((r) =>
    (r.enabled ?? true) && typeof r.where === 'string' && r.where.trim() && !r.where.includes(';'));
  if (!list.length) return [];
  const user = currentUserOrNull();
  if (!user) return [];
  const roles = user.roles ?? [];
  if (roles.includes('super_admin')) return [];
  return list.filter((r) => !r.roles?.length || r.roles.some((code) => roles.includes(code)));
}

/** 把命中的行级规则以 OR 拼接为 WHERE，包裹原查询（子查询别名 _rls；PG/MySQL/SQL Server 通用） */
export function applyRowRulesToSql(sqlText: string, rules: ReportRowRule[]): string {
  if (!rules.length) return sqlText;
  const where = rules.map((r) => `(${r.where.trim()})`).join(' OR ');
  return `SELECT * FROM (\n${sqlText.trim().replace(/;\s*$/, '')}\n) AS _rls WHERE ${where}`;
}

export async function ensureDatasetExists(id: number): Promise<ReportDatasetRow> {
  const [row] = await db.select().from(reportDatasets).where(eq(reportDatasets.id, id)).limit(1);
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
}

export async function getDataset(id: number): Promise<ReportDataset> {
  const row = await db.query.reportDatasets.findFirst({
    where: eq(reportDatasets.id, id),
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
  assertMaterializable(input.materialize as ReportDatasetMaterialize | undefined, ds.type, content, input.params as ReportDatasetParam[] | undefined, input.rowRules as ReportRowRule[] | undefined);
  try {
    const [row] = await db.insert(reportDatasets).values({
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
  const effRowRules = (input.rowRules ?? current.rowRules) as ReportRowRule[] | undefined;
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

/** 收集数据集的下游引用：仪表盘（组件绑定/筛选器动态选项）、打印模板、预警规则 */
export async function collectDatasetRefs(id: number): Promise<ReportDatasetRefs> {
  const [dashRows, printRows, alertRows] = await Promise.all([
    db.select({ id: reportDashboards.id, name: reportDashboards.name, widgets: reportDashboards.widgets, filters: reportDashboards.filters }).from(reportDashboards),
    db.select({ id: reportPrintTemplates.id, name: reportPrintTemplates.name }).from(reportPrintTemplates).where(eq(reportPrintTemplates.datasetId, id)),
    db.select({ id: reportAlertRules.id, name: reportAlertRules.name }).from(reportAlertRules).where(eq(reportAlertRules.datasetId, id)),
  ]);
  const dashboards = dashRows
    .map((d) => {
      const widgets = ((d.widgets ?? []) as ReportWidget[])
        .filter((w) => w.datasetId === id)
        .map((w) => w.title || w.i);
      const filterIds = ((d.filters ?? []) as ReportFilter[])
        .filter((f) => f.optionSource?.kind === 'dataset' && f.optionSource.datasetId === id)
        .map((f) => f.label || f.id);
      return { id: d.id, name: d.name, widgets, filterIds };
    })
    .filter((d) => d.widgets.length > 0 || d.filterIds.length > 0);
  return { dashboards, printTemplates: printRows, alerts: alertRows };
}

/** 删除数据集：存在下游引用时拒绝（防仪表盘悄悄失效 / 预警被级联误删） */
export async function deleteDataset(id: number): Promise<void> {
  await ensureDatasetExists(id);
  const refs = await collectDatasetRefs(id);
  const parts: string[] = [];
  if (refs.dashboards.length) parts.push(`仪表盘 ${refs.dashboards.map((d) => `《${d.name}》`).join('、')}`);
  if (refs.printTemplates.length) parts.push(`打印报表 ${refs.printTemplates.map((t) => `《${t.name}》`).join('、')}`);
  if (refs.alerts.length) parts.push(`预警规则 ${refs.alerts.map((a) => `《${a.name}》`).join('、')}`);
  if (parts.length) {
    throw new HTTPException(400, { message: `该数据集正被引用，无法删除：${parts.join('；')}。请先在「血缘」中查看并解除引用` });
  }
  await db.delete(reportDatasets).where(eq(reportDatasets.id, id));
  await clearDatasetCache(id);
}

// ─── 取数核心 ────────────────────────────────────────────────────────────────

/** 按数据源类型执行取数；sql 走只读绑定执行器，mysql/postgresql 走外部库，api 走 http-client。最后应用计算字段 */
export async function runReportData(
  type: ReportDatasourceType,
  config: ReportDatasourceConfig,
  content: ReportDatasetContent,
  params: Record<string, unknown> = {},
  limit = PREVIEW_LIMIT,
  computedFields?: ReportComputedField[],
): Promise<ReportDataResult> {
  const cappedLimit = Math.max(1, Math.min(limit || PREVIEW_LIMIT, MAX_LIMIT));

  if (type === 'sql') {
    const sqlText = ((content as ReportSqlDatasetContent).sql ?? '').trim();
    if (!sqlText) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
    return applyComputedFields(await runReadonlySql(sqlText, params, cappedLimit), computedFields);
  }

  if (isExternalDbType(type)) {
    const sqlText = ((content as ReportSqlDatasetContent).sql ?? '').trim();
    if (!sqlText) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
    const { text, values } = buildExternalParamSql(sqlText, params, type as 'mysql' | 'postgresql' | 'sqlserver');
    const result = await runExternalQuery(type, config as ReportExternalDbConfig, text, values, cappedLimit);
    return applyComputedFields(result, computedFields);
  }

  if (type === 'static') {
    const staticContent = (content ?? {}) as ReportStaticDatasetContent;
    const rows = Array.isArray(staticContent.data) ? staticContent.data : [];
    const sliced = rows.slice(0, cappedLimit);
    const columns = staticContent.columns?.length
      ? staticContent.columns
      : (sliced.length ? Object.keys(sliced[0]) : []);
    return applyComputedFields({ columns, rows: sliced, total: rows.length }, computedFields);
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
    const res = await httpRequest(url, { method, headers: resolveApiHeaders(apiCfg.headers), body, timeout: 10_000 });
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
  const sliced = arr.slice(0, cappedLimit) as Record<string, unknown>[];
  const columns = sliced.length > 0 ? Object.keys(sliced[0] ?? {}) : [];
  return applyComputedFields({ columns, rows: sliced, total: arr.length }, computedFields);
}

/** 试跑预览（不落库）：用未保存的数据源 + content + 运行时参数取数（`__` 前缀由系统变量权威注入，剥离客户端伪造值） */
export async function previewDataset(input: ReportDatasetPreviewInput): Promise<ReportDataResult> {
  const ds = await ensureDatasourceExists(input.datasourceId);
  const content = normalizeDatasetContent(ds.type, input.content);
  const sqlText = isSqlLikeType(ds.type) ? ((content as ReportSqlDatasetContent).sql ?? '') : '';
  const provided = Object.fromEntries(
    Object.entries((input.params ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith('__')),
  );
  const params = { ...provided, ...await buildSystemParams(sqlText) };
  const computed = (input.computedFields ?? []) as ReportComputedField[];
  return runReportData(ds.type, (ds.config ?? {}) as ReportDatasourceConfig, content, params, input.limit ?? PREVIEW_LIMIT, computed);
}

/** 清除某数据集的全部缓存（更新/删除时调用）：分页缓存 + 物化快照 */
export async function clearDatasetCache(id: number): Promise<void> {
  try {
    const pattern = `${CACHE_PREFIX}${id}:*`;
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    keys.push(`${MATVIEW_PREFIX}${id}`); // 物化快照前缀不同，需显式清除，避免改 SQL 后仍发旧快照
    if (keys.length) await redis.del(...keys);
  } catch { /* 缓存清理失败不阻断主流程 */ }
}

/** 取已保存数据集的数据（供仪表盘组件运行时调用，支持参数 + 行级权限 + Redis 缓存）*/
export async function getDatasetData(id: number, params?: Record<string, unknown>, limit?: number): Promise<ReportDataResult> {
  const row = await db.query.reportDatasets.findFirst({
    where: eq(reportDatasets.id, id),
    with: { datasource: { columns: { config: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  if (row.status !== 'enabled') throw new HTTPException(400, { message: '数据集已停用' });
  const config = (row.datasource?.config ?? {}) as ReportDatasourceConfig;
  const rawContent = (row.content ?? {}) as ReportDatasetContent;
  const isSqlLike = isSqlLikeType(row.type);
  const computed = (row.computedFields ?? []) as ReportComputedField[];
  const effLimit = limit ?? PREVIEW_LIMIT;

  // 物化快照优先：返回持久化全局快照（保存时已校验无参数/无系统变量/无行级规则，故与运行时参数/用户无关）
  const materialize = (row.materialize ?? {}) as ReportDatasetMaterialize;
  if (materialize.enabled) {
    try {
      const snap = await redis.get(`${MATVIEW_PREFIX}${id}`);
      if (snap) return JSON.parse(snap) as ReportDataResult;
    } catch { /* 快照读取失败回源 */ }
    // 首次填充：统一用 MAX_LIMIT 保证快照行数与 cron 刷新一致
    const live = await runReportData(row.type, config, rawContent, {}, MAX_LIMIT, computed);
    try { await redis.set(`${MATVIEW_PREFIX}${id}`, JSON.stringify(live), 'EX', MATVIEW_TTL_SECONDS); } catch { /* 落快照失败忽略 */ }
    return live;
  }

  // 行级权限：命中规则以 OR 包裹原查询（仅 SQL 型；无上下文/超管/未命中 = 不受限）
  const effectiveRules = isSqlLike ? resolveEffectiveRowRules(row.rowRules as ReportRowRule[] | null) : [];
  const rawSqlText = isSqlLike ? ((rawContent as ReportSqlDatasetContent).sql ?? '') : '';
  const sqlText = effectiveRules.length ? applyRowRulesToSql(rawSqlText, effectiveRules) : rawSqlText;
  const content: ReportDatasetContent = effectiveRules.length
    ? { ...(rawContent as ReportSqlDatasetContent), sql: sqlText }
    : rawContent;

  const sysParams = await buildSystemParams(sqlText);
  const resolved = { ...resolveDatasetParams((row.params ?? []) as ReportDatasetParam[], params), ...sysParams };
  const cacheTtl = row.cacheTtl ?? 0;

  // 命中缓存（key 纳入生效的行级规则，不同权限视角互不串扰）
  let cacheKey = '';
  if (cacheTtl > 0) {
    const rls = effectiveRules.map((r) => r.where);
    const hash = createHash('md5').update(JSON.stringify({ resolved, effLimit, rls })).digest('hex');
    cacheKey = `${CACHE_PREFIX}${id}:${hash}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as ReportDataResult;
    } catch { /* 缓存读取失败回源 */ }
  }

  const result = await runReportData(row.type, config, content, resolved, effLimit, computed);

  if (cacheTtl > 0 && cacheKey) {
    try { await redis.set(cacheKey, JSON.stringify(result), 'EX', cacheTtl); } catch { /* 缓存写入失败忽略 */ }
  }
  return result;
}

// ─── 物化快照（定时刷新 + 手动刷新）────────────────────────────────────────────

/** 强制刷新某数据集的物化快照（手动按钮 / 到期 Cron 调用）*/
export async function refreshMaterialization(id: number): Promise<{ rows: number }> {
  const row = await db.query.reportDatasets.findFirst({
    where: eq(reportDatasets.id, id),
    with: { datasource: { columns: { config: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  const config = (row.datasource?.config ?? {}) as ReportDatasourceConfig;
  const content = (row.content ?? {}) as ReportDatasetContent;
  // 物化为全局快照，无参数（保存时已校验），统一空参数 + MAX_LIMIT
  const computed = (row.computedFields ?? []) as ReportComputedField[];
  const result = await runReportData(row.type, config, content, {}, MAX_LIMIT, computed);
  const now = new Date();
  try { await redis.set(`${MATVIEW_PREFIX}${id}`, JSON.stringify(result), 'EX', MATVIEW_TTL_SECONDS); } catch { /* ignore */ }
  const materialize = (row.materialize ?? {}) as ReportDatasetMaterialize;
  await db.update(reportDatasets)
    .set({ materialize: { ...materialize, enabled: materialize.enabled ?? true, refreshedAt: formatDateTime(now), refreshedAtMs: now.getTime() } })
    .where(eq(reportDatasets.id, id));
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
