/**
 * 类 Excel 打印报表模板 Service
 * CRUD + 取数渲染（复用数据集取数 + shared 填充引擎 fillPrintGrid）。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { fillPrintGrid } from '@zenith/shared';
import { db } from '../db';
import { reportPrintTemplates } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { getDatasetData, resolveDatasetParams } from './report-dataset.service';
import type { ReportPrintTemplateRow } from '../db/schema';
import type {
  ReportPrintTemplate, ReportPrintContent, ReportPrintPageConfig, ReportPrintGrid,
  ReportDatasetParam, ReportPrintRenderResult,
  CreateReportPrintTemplateInput, UpdateReportPrintTemplateInput, ReportPrintRenderInput,
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
  const [row] = await db.select().from(reportPrintTemplates).where(eq(reportPrintTemplates.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '打印报表不存在' });
  return row;
}

export async function getPrintTemplate(id: number): Promise<ReportPrintTemplate> {
  const row = await db.query.reportPrintTemplates.findFirst({
    where: eq(reportPrintTemplates.id, id),
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

export async function createPrintTemplate(input: CreateReportPrintTemplateInput): Promise<ReportPrintTemplate> {
  try {
    const [row] = await db.insert(reportPrintTemplates).values({
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
  const grid = (tpl.content as ReportPrintContent)?.grid;
  if (!grid) throw new HTTPException(400, { message: '打印报表尚未设计网格，请先在设计器中保存' });
  const resolved = resolveDatasetParams((tpl.params ?? []) as ReportDatasetParam[], input?.params);
  let rows: Record<string, unknown>[] = [];
  if (tpl.datasetId) {
    const data = await getDatasetData(tpl.datasetId, resolved, input?.limit ?? 5000);
    rows = data.rows;
  }
  const filled: ReportPrintGrid = fillPrintGrid(grid, rows, resolved);
  return { name: tpl.name, grid: filled, pageConfig: (tpl.pageConfig ?? {}) as ReportPrintPageConfig };
}
