/**
 * 类 Excel 打印报表模板 Service
 * CRUD + 取数渲染（复用数据集取数 + shared 填充引擎 renderPrintContent）。
 */
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { desc, eq, inArray } from 'drizzle-orm';
import { ReportPrintValidationError, renderPrintContent } from '@zenith/shared/report';
import { db } from '../../db';
import { reportDatasets, reportPrintTemplates } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { currentDateTime, formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserOrNull } from '../../lib/context';
import { buildReportCopyName } from './report-copy-name';
import { ensureDatasetExists, getDatasetData, resolveDatasetParams } from './report-dataset.service';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import {
  ensureReportResourceAccess,
  listAccessibleReportResourceIds,
} from './report-resource-acl.service';
import {
  defaultReportOwnerId,
  validateReportResourcePlacement,
} from './report-resource.service';
import type { ReportPrintTemplateRow } from '../../db/schema';
import type { ReportPrintTemplate, ReportPrintContent, ReportPrintPageConfig, ReportDatasetParam, ReportPrintDatasetBinding, ReportPrintDatasetRows, ReportPrintRenderResult, ReportPrintResolvedSubreport, ReportPrintSubreportCell, CreateReportPrintTemplateInput, UpdateReportPrintTemplateInput, ReportPrintRenderInput, ReportLookupOption } from '@zenith/shared/report';

type PrintRowExt = ReportPrintTemplateRow & {
  dataset?: { name: string } | null;
  folder?: { name: string } | null;
  owner?: { nickname: string | null; username: string } | null;
};

export function mapPrintTemplate(row: PrintRowExt): ReportPrintTemplate {
  return {
    id: row.id,
    ownerId: row.ownerId ?? null,
    ownerName: row.owner?.nickname || row.owner?.username || null,
    folderId: row.folderId ?? null,
    folderName: row.folder?.name ?? null,
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
  const [rowOrUndefined] = await db.select().from(reportPrintTemplates)
    .where(reportScopedWhere(reportPrintTemplates, eq(reportPrintTemplates.id, id)))
    .limit(1);
  const row = requireRow(rowOrUndefined, '打印报表不存在');
  if (currentUserOrNull()) await ensureReportResourceAccess('print_template', id, 'viewer');
  return row;
}

export async function getPrintTemplate(id: number): Promise<ReportPrintTemplate> {
  if (currentUserOrNull()) await ensureReportResourceAccess('print_template', id, 'viewer');
  const rowOrUndefined = await db.query.reportPrintTemplates.findFirst({
    where: reportScopedWhere(reportPrintTemplates, eq(reportPrintTemplates.id, id)),
    with: {
      dataset: { columns: { name: true } },
      folder: { columns: { name: true } },
      owner: { columns: { nickname: true, username: true } },
    },
  });
  const row = requireRow(rowOrUndefined, '打印报表不存在');
  return mapPrintTemplate(row);
}

export async function listPrintTemplates(query: {
  page?: number; pageSize?: number; keyword?: string; folderId?: number; ownerId?: number; status?: string;
}) {
  const { page = 1, pageSize = 20, keyword, folderId, ownerId, status } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportPrintTemplates);
  if (tenantScope) conds.push(tenantScope);
  const accessibleIds = await listAccessibleReportResourceIds('print_template');
  if (accessibleIds && accessibleIds.length === 0) return { list: [], total: 0, page, pageSize };
  if (accessibleIds) conds.push(inArray(reportPrintTemplates.id, accessibleIds));
  if (folderId) conds.push(eq(reportPrintTemplates.folderId, folderId));
  if (ownerId) conds.push(eq(reportPrintTemplates.ownerId, ownerId));
  conds.push(keywordCondition(keyword, [reportPrintTemplates.name, reportPrintTemplates.remark], 'ilike'));
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportPrintTemplates.status, status));
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportPrintTemplates, where),
    rows: () => db.query.reportPrintTemplates.findMany({
            where,
            with: {
              dataset: { columns: { name: true } },
              folder: { columns: { name: true } },
              owner: { columns: { nickname: true, username: true } },
            },
            orderBy: desc(reportPrintTemplates.id),
            limit: pageSize,
            offset: pageOffset(page, pageSize),
          }),
    map: mapPrintTemplate,
  });
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
  const accessibleIds = await listAccessibleReportResourceIds('print_template');
  if (accessibleIds && accessibleIds.length === 0) return [];
  if (accessibleIds) conds.push(inArray(reportPrintTemplates.id, accessibleIds));
  conds.push(keywordCondition(keyword, [reportPrintTemplates.name, reportPrintTemplates.remark], 'ilike'));
  if (status) conds.push(eq(reportPrintTemplates.status, status));
  const where = buildWhere(...conds);
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

export async function batchSetPrintTemplateStatus(ids: number[], status: 'enabled' | 'disabled'): Promise<number> {
  if (ids.length === 0) return 0;
  const accessible = await listAccessibleReportResourceIds('print_template', 'editor');
  const allowedIds = accessible ? ids.filter((id) => accessible.includes(id)) : ids;
  if (allowedIds.length === 0) return 0;
  const result = await db.update(reportPrintTemplates).set({ status }).where(reportScopedWhere(reportPrintTemplates, inArray(reportPrintTemplates.id, allowedIds))).returning({ id: reportPrintTemplates.id });
  return result.length;
}

export async function clonePrintTemplate(id: number, input?: { name?: string | null }): Promise<ReportPrintTemplate> {
  await ensureReportResourceAccess('print_template', id, 'editor');
  const current = await ensurePrintTemplateExists(id);
  const ownerId = defaultReportOwnerId();
  await validateReportResourcePlacement('print_template', {
    ownerId,
    folderId: current.folderId,
    tenantId: current.tenantId ?? reportCreateTenantId(),
  });
  const rows = await db.select({ name: reportPrintTemplates.name }).from(reportPrintTemplates).where(reportTenantScope(reportPrintTemplates));
  const name = input?.name?.trim() || buildReportCopyName(current.name, new Set(rows.map((row) => row.name)));
  try {
    const [row] = await db.insert(reportPrintTemplates).values({
      tenantId: current.tenantId ?? reportCreateTenantId(),
      ownerId,
      folderId: current.folderId ?? null,
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
  const tenantId = reportCreateTenantId();
  if (input.datasetId) {
    const dataset = await ensureDatasetExists(input.datasetId);
    if ((dataset.tenantId ?? null) !== tenantId) throw new HTTPException(400, { message: '打印报表与数据集不属于同一租户' });
  }
  const ownerId = input.ownerId ?? defaultReportOwnerId();
  await validateReportResourcePlacement('print_template', { ownerId, folderId: input.folderId, tenantId });
  try {
    const [row] = await db.insert(reportPrintTemplates).values({
      tenantId,
      ownerId,
      folderId: input.folderId ?? null,
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
  await ensureReportResourceAccess('print_template', id, 'editor');
  const current = await ensurePrintTemplateExists(id);
  if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    await ensureReportResourceAccess('print_template', id, 'owner');
  }
  if (input.datasetId) {
    const dataset = await ensureDatasetExists(input.datasetId);
    if ((dataset.tenantId ?? null) !== (current.tenantId ?? null)) {
      throw new HTTPException(400, { message: '打印报表与数据集不属于同一租户' });
    }
  }
  await validateReportResourcePlacement('print_template', {
    ownerId: input.ownerId,
    folderId: input.folderId,
    tenantId: current.tenantId ?? null,
  });
  try {
    const [rowOrUndefined] = await db.update(reportPrintTemplates).set({
      ownerId: input.ownerId,
      folderId: input.folderId,
      name: input.name,
      datasetId: input.datasetId,
      content: input.content as ReportPrintContent | undefined,
      params: input.params as ReportDatasetParam[] | undefined,
      pageConfig: input.pageConfig as ReportPrintPageConfig | undefined,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportPrintTemplates.id, id)).returning();
    const row = requireRow(rowOrUndefined, '打印报表不存在');
    return mapPrintTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '打印报表名称已存在');
    throw err;
  }
}

export async function deletePrintTemplate(id: number): Promise<void> {
  await ensureReportResourceAccess('print_template', id, 'owner');
  await ensurePrintTemplateExists(id);
  const candidates = await db.select({
    id: reportPrintTemplates.id,
    name: reportPrintTemplates.name,
    content: reportPrintTemplates.content,
  }).from(reportPrintTemplates).where(reportTenantScope(reportPrintTemplates));
  const referencedBy = candidates.filter((candidate) =>
    candidate.id !== id
    && printContentCells((candidate.content ?? {}) as ReportPrintContent)
      .some((cell) => cell.subreport?.templateId === id));
  if (referencedBy.length) {
    throw new HTTPException(400, {
      message: `该打印报表正被子报表引用，无法删除：${referencedBy.map((item) => `《${item.name}》`).join('、')}`,
    });
  }
  await db.delete(reportPrintTemplates).where(eq(reportPrintTemplates.id, id));
}

type PrintDataRow = Record<string, unknown>;

interface PrintBindingDatasetDescriptor {
  id: number;
  tenantId: number | null;
  params: ReportDatasetParam[];
}

interface PrintBindingResolverDependencies {
  loadDataset: (datasetId: number) => Promise<PrintBindingDatasetDescriptor>;
  fetchRows: (
    datasetId: number,
    params: Record<string, unknown>,
    limit: number,
    bindingKey: string,
  ) => Promise<PrintDataRow[]>;
}

interface PrintRenderExecutionContext {
  schedule: <T>(task: () => Promise<T>) => Promise<T>;
  datasetDescriptors: Map<number, Promise<PrintBindingDatasetDescriptor>>;
  datasetQueries: Map<string, Promise<PrintDataRow[]>>;
}

const PRINT_BINDING_CONCURRENCY = 3;
const PRINT_BINDING_RESERVED_KEYS = new Set(['main']);
const PRINT_SUBREPORT_MAX_DEPTH = 3;

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function createPrintConcurrencyLimiter(maxConcurrency = PRINT_BINDING_CONCURRENCY) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return async function schedule<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function validateBindingKeys(bindings: ReportPrintDatasetBinding[]): void {
  const keys = new Set<string>();
  for (const binding of bindings) {
    const key = binding.key.trim().toLowerCase();
    if (!key || PRINT_BINDING_RESERVED_KEYS.has(key) || key.startsWith('__')) {
      throw new HTTPException(400, { message: `数据集绑定键「${binding.key}」为保留名称` });
    }
    if (keys.has(key)) throw new HTTPException(400, { message: `数据集绑定键「${binding.key}」重复` });
    keys.add(key);
  }
}

function resolveBindingParams(
  binding: ReportPrintDatasetBinding,
  datasetParams: ReportDatasetParam[],
  templateParams: ReportDatasetParam[],
  resolvedTemplateParams: Record<string, unknown>,
): Record<string, unknown> {
  const targetNames = new Set(datasetParams.map((param) => param.name));
  const sourceNames = new Set(templateParams.map((param) => param.name));
  const staticParams = binding.params ?? {};
  for (const name of Object.keys(staticParams)) {
    if (!targetNames.has(name)) throw new HTTPException(400, { message: `绑定「${binding.key}」使用了数据集未声明参数：${name}` });
  }
  const mapped: Record<string, unknown> = {};
  for (const [targetName, sourceName] of Object.entries(binding.paramBindings ?? {})) {
    if (!targetNames.has(targetName)) {
      throw new HTTPException(400, { message: `绑定「${binding.key}」映射了数据集未声明参数：${targetName}` });
    }
    if (!sourceNames.has(sourceName)) {
      throw new HTTPException(400, { message: `绑定「${binding.key}」引用了模板未声明参数：${sourceName}` });
    }
    mapped[targetName] = resolvedTemplateParams[sourceName];
  }
  return resolveDatasetParams(datasetParams, { ...staticParams, ...mapped });
}

export function resolvePrintSubreportParams(
  subreport: ReportPrintSubreportCell,
  childParams: ReportDatasetParam[],
  parentParams: ReportDatasetParam[],
  resolvedParentParams: Record<string, unknown>,
): Record<string, unknown> {
  const childNames = new Set(childParams.map((param) => param.name));
  const parentNames = new Set(parentParams.map((param) => param.name));
  const mapped: Record<string, unknown> = {};
  for (const [targetName, sourceName] of Object.entries(subreport.paramBindings ?? {})) {
    if (!childNames.has(targetName)) throw new HTTPException(400, { message: `子报表参数未声明：${targetName}` });
    if (!parentNames.has(sourceName)) throw new HTTPException(400, { message: `父模板参数未声明：${sourceName}` });
    mapped[targetName] = resolvedParentParams[sourceName];
  }
  return mapped;
}

export async function resolvePrintDatasetBindings(
  bindings: ReportPrintDatasetBinding[],
  input: {
    templateParams: ReportDatasetParam[];
    resolvedTemplateParams: Record<string, unknown>;
    tenantId: number | null;
    limit: number;
  },
  dependencies: PrintBindingResolverDependencies,
  executionContext?: PrintRenderExecutionContext,
): Promise<ReportPrintDatasetRows> {
  validateBindingKeys(bindings);
  const schedule = executionContext?.schedule ?? createPrintConcurrencyLimiter();
  const descriptorCache = executionContext?.datasetDescriptors ?? new Map<number, Promise<PrintBindingDatasetDescriptor>>();
  const queryCache = executionContext?.datasetQueries ?? new Map<string, Promise<PrintDataRow[]>>();
  const resolvedRows: ReportPrintDatasetRows = {};

  await Promise.all(bindings.map(async (binding) => {
    let descriptorPromise = descriptorCache.get(binding.datasetId);
    if (!descriptorPromise) {
      descriptorPromise = schedule(() => dependencies.loadDataset(binding.datasetId));
      descriptorCache.set(binding.datasetId, descriptorPromise);
    }
    const descriptor = await descriptorPromise;
    if (descriptor.tenantId !== input.tenantId) {
      throw new HTTPException(400, { message: `绑定「${binding.key}」与打印报表不属于同一租户` });
    }
    const params = resolveBindingParams(
      binding,
      descriptor.params,
      input.templateParams,
      input.resolvedTemplateParams,
    );
    const limit = Math.min(input.limit, binding.rowLimit ?? input.limit);
    const queryKey = `${descriptor.id}:${limit}:${stableSerialize(params)}`;
    let rowsPromise = queryCache.get(queryKey);
    if (!rowsPromise) {
      rowsPromise = schedule(() => dependencies.fetchRows(descriptor.id, params, limit, binding.key));
      queryCache.set(queryKey, rowsPromise);
    }
    resolvedRows[binding.key.trim().toLowerCase()] = await rowsPromise;
  }));
  return resolvedRows;
}

function printContentCells(content: ReportPrintContent) {
  if (content.sheets?.length) return content.sheets.flatMap((sheet) => sheet.grid.cells);
  return content.grid?.cells ?? [];
}

function createPrintExecutionContext(): PrintRenderExecutionContext {
  return {
    schedule: createPrintConcurrencyLimiter(),
    datasetDescriptors: new Map(),
    datasetQueries: new Map(),
  };
}

async function renderPrintTemplateInternal(
  id: number,
  input: ReportPrintRenderInput | undefined,
  execution: PrintRenderExecutionContext,
  templatePath: number[],
  mainRowsOverride?: PrintDataRow[],
): Promise<ReportPrintRenderResult> {
  if (templatePath.includes(id)) {
    throw new HTTPException(400, { message: `子报表存在循环引用：${[...templatePath, id].join(' → ')}` });
  }
  if (templatePath.length >= PRINT_SUBREPORT_MAX_DEPTH) {
    throw new HTTPException(400, { message: `子报表嵌套不能超过 ${PRINT_SUBREPORT_MAX_DEPTH} 层` });
  }
  const tpl = await ensurePrintTemplateExists(id);
  const content = (tpl.content ?? {}) as ReportPrintContent;
  if (!content.grid && !content.sheets?.length) {
    throw new HTTPException(400, { message: '打印报表尚未设计网格，请先在设计器中保存' });
  }
  const templateParams = (tpl.params ?? []) as ReportDatasetParam[];
  const resolved = resolveDatasetParams(templateParams, input?.params);
  const limit = input?.limit ?? 5000;
  let rows: PrintDataRow[] = mainRowsOverride ?? [];
  if (!mainRowsOverride && tpl.datasetId) {
    const dataset = await ensureDatasetExists(tpl.datasetId);
    if ((dataset.tenantId ?? null) !== (tpl.tenantId ?? null)) {
      throw new HTTPException(400, { message: '打印报表与主数据集不属于同一租户' });
    }
    rows = await execution.schedule(async () => {
      const data = await getDatasetData(tpl.datasetId!, resolved, limit, { scene: 'print', sourceRefId: tpl.id });
      return data.rows;
    });
  }
  const bindings = content.datasetBindings ?? [];
  const datasets = await resolvePrintDatasetBindings(bindings, {
    templateParams,
    resolvedTemplateParams: resolved,
    tenantId: tpl.tenantId ?? null,
    limit,
  }, {
    loadDataset: async (datasetId) => {
      const dataset = await ensureDatasetExists(datasetId);
      return {
        id: dataset.id,
        tenantId: dataset.tenantId ?? null,
        params: (dataset.params ?? []) as ReportDatasetParam[],
      };
    },
    fetchRows: async (datasetId, params, rowLimit, bindingKey) => {
      const data = await getDatasetData(datasetId, params, rowLimit, {
        scene: 'print_binding',
        sourceRefId: `${tpl.id}:${bindingKey}`,
      });
      return data.rows;
    },
  }, execution);

  const subreports: ReportPrintResolvedSubreport[] = [];
  const nextPath = [...templatePath, id];
  for (const sheet of content.sheets ?? [{ id: 'sheet-01', grid: content.grid! }]) {
    for (const cell of sheet.grid.cells) {
      if (!cell.subreport) continue;
      const child = await ensurePrintTemplateExists(cell.subreport.templateId);
      if ((child.tenantId ?? null) !== (tpl.tenantId ?? null)) {
        throw new HTTPException(400, { message: '子报表与主报表不属于同一租户' });
      }
      const childParams = (child.params ?? []) as ReportDatasetParam[];
      const mapped = resolvePrintSubreportParams(cell.subreport, childParams, templateParams, resolved);
      const overrideRows = cell.subreport.datasetKey
        ? (cell.subreport.datasetKey.toLowerCase() === 'main' ? rows : datasets[cell.subreport.datasetKey.toLowerCase()])
        : undefined;
      if (cell.subreport.datasetKey && !overrideRows) {
        throw new HTTPException(400, { message: `子报表引用了不存在的数据集绑定：${cell.subreport.datasetKey}` });
      }
      const result = await renderPrintTemplateInternal(
        cell.subreport.templateId,
        { params: mapped, limit },
        execution,
        nextPath,
        overrideRows,
      );
      subreports.push({
        sheetId: sheet.id,
        row: cell.row,
        col: cell.col,
        templateId: cell.subreport.templateId,
        result,
      });
    }
  }
  try {
    return renderPrintContent(
      tpl.name,
      content,
      rows,
      resolved,
      (tpl.pageConfig ?? {}) as ReportPrintPageConfig,
      {
        datasets,
        bindings,
        subreports,
        renderedAt: currentDateTime(),
      },
    );
  } catch (error) {
    if (error instanceof ReportPrintValidationError) {
      throw new HTTPException(400, { message: error.message, cause: error });
    }
    throw error;
  }
}

/** 取数渲染：拉取数据集数据 → 填充模板网格 → 返回填充结果（供预览/打印/导出复用）*/
export async function renderPrintTemplate(id: number, input?: ReportPrintRenderInput): Promise<ReportPrintRenderResult> {
  return renderPrintTemplateInternal(id, input, createPrintExecutionContext(), []);
}
