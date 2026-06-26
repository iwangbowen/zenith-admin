/**
 * 报表数据集 Service
 * CRUD + 取数执行（preview 试跑 / data 取数）。
 * - sql：复用 db-admin 的 executeReadonlyQuery（只读事务 + 超时 + 分页上限）。
 * - api：统一走 http-client 的 httpRequest（防 SSRF），按 itemsPath 提取数组。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { reportDatasets } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { httpRequest } from '../lib/http-client';
import { executeReadonlyQuery } from './db-admin.service';
import { ensureDatasourceExists } from './report-datasource.service';
import type { ReportDatasetRow } from '../db/schema';
import type {
  ReportDataset, ReportDataResult, ReportField, ReportDatasetContent,
  ReportDatasourceType, ReportDatasourceConfig,
  ReportApiDatasourceConfig, ReportApiDatasetContent, ReportSqlDatasetContent,
  CreateReportDatasetInput, UpdateReportDatasetInput, ReportDatasetPreviewInput,
} from '@zenith/shared';

const PREVIEW_LIMIT = 100;
const MAX_LIMIT = 5000;

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
  if (type === 'sql') {
    return { sql: typeof c.sql === 'string' ? c.sql : '' };
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

export async function ensureDatasetExists(id: number): Promise<ReportDatasetRow> {
  const [row] = await db.select().from(reportDatasets).where(eq(reportDatasets.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  return row;
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
  if (type === 'api' || type === 'sql') conds.push(eq(reportDatasets.type, type));
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

export async function createDataset(input: CreateReportDatasetInput): Promise<ReportDataset> {
  const ds = await ensureDatasourceExists(input.datasourceId);
  const content = normalizeDatasetContent(ds.type, input.content);
  try {
    const [row] = await db.insert(reportDatasets).values({
      name: input.name,
      datasourceId: input.datasourceId,
      type: ds.type,
      content,
      fields: (input.fields ?? []) as ReportField[],
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
  try {
    const [row] = await db.update(reportDatasets).set({
      name: input.name,
      datasourceId: input.datasourceId,
      type: typeChanged ? type : undefined,
      content,
      fields: input.fields as ReportField[] | undefined,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportDatasets.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '数据集不存在' });
    return mapDataset(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据集名称已存在');
    throw err;
  }
}

export async function deleteDataset(id: number): Promise<void> {
  await ensureDatasetExists(id);
  await db.delete(reportDatasets).where(eq(reportDatasets.id, id));
}

// ─── 取数核心 ────────────────────────────────────────────────────────────────

/** 按数据源类型执行取数；sql 走只读执行器，api 走 http-client */
export async function runReportData(
  type: ReportDatasourceType,
  config: ReportDatasourceConfig,
  content: ReportDatasetContent,
  limit = PREVIEW_LIMIT,
): Promise<ReportDataResult> {
  const cappedLimit = Math.max(1, Math.min(limit || PREVIEW_LIMIT, MAX_LIMIT));

  if (type === 'sql') {
    const sqlText = ((content as ReportSqlDatasetContent).sql ?? '').trim();
    if (!sqlText) throw new HTTPException(400, { message: '数据集 SQL 不能为空' });
    const res = await executeReadonlyQuery(sqlText, { page: 1, pageSize: cappedLimit });
    return {
      columns: res.columns.map((c) => c.name),
      rows: res.rows,
      total: res.total ?? res.rowCount,
    };
  }

  // api
  const apiCfg = config as ReportApiDatasourceConfig;
  if (!apiCfg?.url) throw new HTTPException(400, { message: '数据源未配置 URL' });
  const apiContent = (content ?? {}) as ReportApiDatasetContent;
  const method = apiCfg.method === 'POST' ? 'POST' : 'GET';
  let url = apiCfg.url;
  let body: Record<string, unknown> | undefined;
  const params = apiContent.params ?? undefined;
  if (params && Object.keys(params).length > 0) {
    if (method === 'GET') {
      const u = new URL(apiCfg.url);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      url = u.toString();
    } else {
      body = { ...params };
    }
  }

  let json: unknown;
  try {
    const res = await httpRequest(url, { method, headers: apiCfg.headers ?? undefined, body, timeout: 10_000 });
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
  return { columns, rows: sliced, total: arr.length };
}

/** 试跑预览（不落库）：用未保存的数据源 + content 直接取数 */
export async function previewDataset(input: ReportDatasetPreviewInput): Promise<ReportDataResult> {
  const ds = await ensureDatasourceExists(input.datasourceId);
  const content = normalizeDatasetContent(ds.type, input.content);
  return runReportData(ds.type, (ds.config ?? {}) as ReportDatasourceConfig, content, input.limit ?? PREVIEW_LIMIT);
}

/** 取已保存数据集的数据（供仪表盘组件运行时调用） */
export async function getDatasetData(id: number, limit?: number): Promise<ReportDataResult> {
  const row = await db.query.reportDatasets.findFirst({
    where: eq(reportDatasets.id, id),
    with: { datasource: { columns: { config: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '数据集不存在' });
  if (row.status !== 'enabled') throw new HTTPException(400, { message: '数据集已停用' });
  const config = (row.datasource?.config ?? {}) as ReportDatasourceConfig;
  return runReportData(row.type, config, (row.content ?? {}) as ReportDatasetContent, limit ?? PREVIEW_LIMIT);
}
