/**
 * 类 Excel 打印报表模板 Service
 * CRUD + 取数渲染（复用数据集取数 + shared 填充引擎 fillPrintGrid）。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { renderPrintContent } from '@zenith/shared';
import { db } from '../../db';
import { reportDatasets, reportPrintTemplates } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { ensureDatasetExists, getDatasetData, resolveDatasetParams } from './report-dataset.service';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import type { ReportPrintTemplateRow } from '../../db/schema';
import type {
  ReportPrintTemplate, ReportPrintContent, ReportPrintPageConfig,
  ReportDatasetParam, ReportPrintRenderResult,
  CreateReportPrintTemplateInput, UpdateReportPrintTemplateInput, ReportPrintRenderInput, ReportLookupOption,
} from '@zenith/shared';

type PrintRowExt = ReportPrintTemplateRow & { dataset?: { name: string } | null };

export function mapPrintTemplate(row: PrintRowExt): ReportPrintTemplate {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.datasetId ?? null,
    datasetName: row.dataset?.name ?? null,
    content: (row.content ?? {}) as ReportPrintContent,
    params: (row.params ?? []) as ReportDatasetParam[],
    pageConfig: (row.pageConfig ?? {}) as ReportPrintPageConfig,
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensurePrintTemplateExists(id: number): Promise<ReportPrintTemplateRow> {
  const [row] = await db.select().from(reportPrintTemplates)
    .where(reportScopedWhere(reportPrintTemplates, eq(reportPrintTemplates.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '打印报表不存在' });
  return row;
}

export async function getPrintTemplate(id: number): Promise<ReportPrintTemplate> {
  const row = await db.query.reportPrintTemplates.findFirst({
    where: reportScopedWhere(reportPrintTemplates, eq(reportPrintTemplates.id, id)),
    with: { dataset: { columns: { name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '打印报表不存在' });
  return mapPrintTemplate(row);
}

export async function listPrintTemplates(query: {
  page?: number; pageSize?: number; keyword?: string; status?: string;
}) {
  const { page = 1, pageSize = 20, keyword, status } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportPrintTemplates);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportPrintTemplates.name, kw), ilike(reportPrintTemplates.remark, kw)));
  }
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportPrintTemplates.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportPrintTemplates, where),
    db.query.reportPrintTemplates.findMany({
      where,
      with: { dataset: { columns: { name: true } } },
      orderBy: desc(reportPrintTemplates.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapPrintTemplate), total, page, pageSize };
}

export async function listPrintTemplateLookup(query: {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  limit?: number;
}): Promise<ReportLookupOption[]> {
  const { keyword, status, limit = 20 } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportPrintTemplates);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportPrintTemplates.name, kw), ilike(reportPrintTemplates.remark, kw)));
  }
  if (status) conds.push(eq(reportPrintTemplates.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select({
    id: reportPrintTemplates.id,
    name: reportPrintTemplates.name,
    status: reportPrintTemplates.status,
    datasetId: reportPrintTemplates.datasetId,
    datasourceName: reportDatasets.name,
  }).from(reportPrintTemplates)
    .leftJoin(reportDatasets, eq(reportDatasets.id, reportPrintTemplates.datasetId))
    .where(where)
    .orderBy(desc(reportPrintTemplates.id))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    datasourceId: row.datasetId ?? null,
    datasourceName: row.datasourceName ?? null,
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

export async function batchSetPrintTemplateStatus(ids: number[], status: 'enabled' | 'disabled'): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.update(reportPrintTemplates).set({ status }).where(reportScopedWhere(reportPrintTemplates, inArray(reportPrintTemplates.id, ids))).returning({ id: reportPrintTemplates.id });
  return result.length;
}

export async function clonePrintTemplate(id: number, input?: { name?: string | null }): Promise<ReportPrintTemplate> {
  const current = await ensurePrintTemplateExists(id);
  const rows = await db.select({ name: reportPrintTemplates.name }).from(reportPrintTemplates).where(reportTenantScope(reportPrintTemplates));
  const name = input?.name?.trim() || buildCopyName(current.name, new Set(rows.map((row) => row.name)));
  try {
    const [row] = await db.insert(reportPrintTemplates).values({
      tenantId: current.tenantId ?? reportCreateTenantId(),
      name,
      datasetId: current.datasetId ?? null,
      content: (current.content ?? {}) as ReportPrintContent,
      params: (current.params ?? []) as ReportDatasetParam[],
      pageConfig: (current.pageConfig ?? {}) as ReportPrintPageConfig,
      status: current.status,
      remark: current.remark ?? null,
    }).returning();
    return mapPrintTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '复制后的打印报表名称已存在，请修改后重试');
    throw err;
  }
}

export async function createPrintTemplate(input: CreateReportPrintTemplateInput): Promise<ReportPrintTemplate> {
  if (input.datasetId) await ensureDatasetExists(input.datasetId);
  try {
    const [row] = await db.insert(reportPrintTemplates).values({
      tenantId: reportCreateTenantId(),
      name: input.name,
      datasetId: input.datasetId ?? null,
      content: (input.content ?? {}) as ReportPrintContent,
      params: (input.params ?? []) as ReportDatasetParam[],
      pageConfig: (input.pageConfig ?? {}) as ReportPrintPageConfig,
      status: input.status ?? 'enabled',
      remark: input.remark,
    }).returning();
    return mapPrintTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '打印报表名称已存在');
    throw err;
  }
}

export async function updatePrintTemplate(id: number, input: UpdateReportPrintTemplateInput): Promise<ReportPrintTemplate> {
  await ensurePrintTemplateExists(id);
  if (input.datasetId) await ensureDatasetExists(input.datasetId);
  try {
    const [row] = await db.update(reportPrintTemplates).set({
      name: input.name,
      datasetId: input.datasetId,
      content: input.content as ReportPrintContent | undefined,
      params: input.params as ReportDatasetParam[] | undefined,
      pageConfig: input.pageConfig as ReportPrintPageConfig | undefined,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportPrintTemplates.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '打印报表不存在' });
    return mapPrintTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '打印报表名称已存在');
    throw err;
  }
}

export async function deletePrintTemplate(id: number): Promise<void> {
  await ensurePrintTemplateExists(id);
  await db.delete(reportPrintTemplates).where(eq(reportPrintTemplates.id, id));
}

/** 取数渲染：拉取数据集数据 → 填充模板网格 → 返回填充结果（供预览/打印/导出复用）*/
export async function renderPrintTemplate(id: number, input?: ReportPrintRenderInput): Promise<ReportPrintRenderResult> {
  const tpl = await ensurePrintTemplateExists(id);
  const content = (tpl.content ?? {}) as ReportPrintContent;
  if (!content.grid && !content.sheets?.length) {
    throw new HTTPException(400, { message: '打印报表尚未设计网格，请先在设计器中保存' });
  }
  const resolved = resolveDatasetParams((tpl.params ?? []) as ReportDatasetParam[], input?.params);
  let rows: Record<string, unknown>[] = [];
  if (tpl.datasetId) {
    const data = await getDatasetData(tpl.datasetId, resolved, input?.limit ?? 5000, { scene: 'print', sourceRefId: tpl.id });
    rows = data.rows;
  }
  return renderPrintContent(tpl.name, content, rows, resolved, (tpl.pageConfig ?? {}) as ReportPrintPageConfig);
}
