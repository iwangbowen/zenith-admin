import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { reportFillRecords, reportFillTemplates, workflowDefinitions } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { tenantCondition } from '../../lib/tenant';
import { keywordCondition } from '../../lib/where-helpers';
import type { CloneReportFillTemplateInput, CreateReportFillTemplateInput, ReportFillTemplate, ReportFillTemplateLifecycleActionInput, UpdateReportFillTemplateInput } from '@zenith/shared/report';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import {
  ensureReportResourceAccess,
  listAccessibleReportResourceIds,
} from './report-resource-acl.service';
import {
  defaultReportOwnerId,
  validateReportResourcePlacement,
} from './report-resource.service';
import { validateReportFillSchema } from './report-fill-validation';

type TemplateRow = typeof reportFillTemplates.$inferSelect;

export function mapReportFillTemplate(row: TemplateRow): ReportFillTemplate {
  return {
    ...row,
    publishedAt: row.publishedAt ? formatDateTime(row.publishedAt) : null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureReportFillTemplate(
  id: number,
  role: 'viewer' | 'editor' | 'owner' = 'viewer',
): Promise<TemplateRow> {
  await ensureReportResourceAccess('fill_template', id, role);
  const rowOrUndefined = await db.query.reportFillTemplates.findFirst({
    where: reportScopedWhere(reportFillTemplates, eq(reportFillTemplates.id, id)),
  });
  const row = requireRow(rowOrUndefined, '填报模板不存在');
  return row;
}

async function validateWorkflowDefinition(id: number | null | undefined, needReview: boolean) {
  if (!id) return;
  requireRow(needReview, '仅需要审核的模板可以绑定工作流定义', 400);
  const conditions = [eq(workflowDefinitions.id, id), eq(workflowDefinitions.status, 'published')];
  const scoped = tenantCondition(workflowDefinitions, currentUser());
  if (scoped) conditions.push(scoped);
  const [definitionOrUndefined] = await db.select({
    id: workflowDefinitions.id,
    formType: workflowDefinitions.formType,
    customForm: workflowDefinitions.customForm,
  }).from(workflowDefinitions)
    .where(and(...conditions)).limit(1);
  const definition = requireRow(definitionOrUndefined, '工作流定义不存在、未发布或不属于当前租户', 400);
  if (definition.formType !== 'external') {
    throw new HTTPException(400, { message: '填报审批必须绑定业务系统主导（external）工作流定义' });
  }
  const customForm = definition.customForm as { viewComponent?: string } | null;
  if (!customForm?.viewComponent?.trim()) {
    throw new HTTPException(400, { message: '填报审批工作流缺少审批查看组件配置' });
  }
}

async function validatePlacement(input: { ownerId?: number | null; folderId?: number | null }) {
  const tenantId = reportCreateTenantId();
  const ownerId = input.ownerId ?? defaultReportOwnerId();
  await validateReportResourcePlacement('fill_template', { tenantId, ownerId, folderId: input.folderId });
  return { tenantId, ownerId };
}

export async function listReportFillTemplates(query: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'draft' | 'published' | 'disabled';
  ownerId?: number;
  folderId?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const conditions = [reportTenantScope(reportFillTemplates)];
  const accessibleIds = await listAccessibleReportResourceIds('fill_template');
  if (accessibleIds && accessibleIds.length === 0) return { list: [], total: 0, page, pageSize };
  if (accessibleIds) conditions.push(inArray(reportFillTemplates.id, accessibleIds));
  conditions.push(keywordCondition(query.keyword, [reportFillTemplates.name, reportFillTemplates.code], 'ilike'));
  if (query.status) conditions.push(eq(reportFillTemplates.status, query.status));
  if (query.ownerId) conditions.push(eq(reportFillTemplates.ownerId, query.ownerId));
  if (query.folderId) conditions.push(eq(reportFillTemplates.folderId, query.folderId));
  const where = and(...conditions.filter((item): item is NonNullable<typeof item> => Boolean(item)));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(reportFillTemplates, where),
    rows: () => db.select().from(reportFillTemplates).where(where)
            .orderBy(desc(reportFillTemplates.updatedAt))
            .limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapReportFillTemplate,
  });
}

export async function listReportFillTemplateLookup() {
  const accessibleIds = await listAccessibleReportResourceIds('fill_template');
  if (accessibleIds && accessibleIds.length === 0) return [];
  const where = and(
    reportTenantScope(reportFillTemplates),
    eq(reportFillTemplates.status, 'published'),
    accessibleIds ? inArray(reportFillTemplates.id, accessibleIds) : undefined,
  );
  const rows = await db.select().from(reportFillTemplates).where(where).orderBy(reportFillTemplates.name);
  return rows.map(mapReportFillTemplate);
}

export async function getReportFillTemplate(id: number): Promise<ReportFillTemplate> {
  return mapReportFillTemplate(await ensureReportFillTemplate(id));
}

export async function createReportFillTemplate(
  input: CreateReportFillTemplateInput,
): Promise<ReportFillTemplate> {
  const formSchema = validateReportFillSchema(input.formSchema);
  const needReview = input.needReview ?? false;
  await validateWorkflowDefinition(input.workflowDefinitionId, needReview);
  const placement = await validatePlacement(input);
  try {
    const [row] = await db.insert(reportFillTemplates).values({
      tenantId: placement.tenantId,
      folderId: input.folderId ?? null,
      ownerId: placement.ownerId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      formSchema,
      workflowDefinitionId: needReview ? input.workflowDefinitionId : null,
      needReview,
      status: 'draft',
    }).returning();
    return mapReportFillTemplate(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '填报模板编码已存在');
    throw error;
  }
}

export async function updateReportFillTemplate(
  id: number,
  input: UpdateReportFillTemplateInput,
): Promise<ReportFillTemplate> {
  const existing = await ensureReportFillTemplate(id, 'editor');
  if (existing.status === 'published') throw new HTTPException(409, { message: '请先下线模板再编辑' });
  if (existing.revision !== input.expectedRevision) throw new HTTPException(409, { message: '模板已被其他人更新，请刷新后重试' });
  const formSchema = validateReportFillSchema(input.formSchema ?? existing.formSchema);
  const needReview = input.needReview ?? existing.needReview;
  const workflowDefinitionId = input.workflowDefinitionId === undefined
    ? existing.workflowDefinitionId
    : input.workflowDefinitionId;
  await validateWorkflowDefinition(workflowDefinitionId, needReview);
  await validatePlacement({
    ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
    folderId: input.folderId === undefined ? existing.folderId : input.folderId,
  });
  const [rowOrUndefined] = await db.update(reportFillTemplates).set({
    folderId: input.folderId,
    ownerId: input.ownerId,
    name: input.name,
    description: input.description,
    formSchema,
    workflowDefinitionId: needReview ? workflowDefinitionId : null,
    needReview,
    revision: sql`${reportFillTemplates.revision} + 1`,
  }).where(and(
    eq(reportFillTemplates.id, id),
    eq(reportFillTemplates.revision, input.expectedRevision),
  )).returning();
  const row = requireRow(rowOrUndefined, '模板已被其他人更新，请刷新后重试', 409);
  return mapReportFillTemplate(row);
}

export async function changeReportFillTemplateLifecycle(
  id: number,
  input: ReportFillTemplateLifecycleActionInput,
): Promise<ReportFillTemplate> {
  const existing = await ensureReportFillTemplate(id, 'editor');
  if (existing.revision !== input.expectedRevision) throw new HTTPException(409, { message: '模板已被其他人更新，请刷新后重试' });
  if (input.action === 'publish') {
    if (existing.status === 'published') return mapReportFillTemplate(existing);
    validateReportFillSchema(existing.formSchema);
    await validateWorkflowDefinition(existing.workflowDefinitionId, existing.needReview);
    const nextRevision = existing.revision + 1;
    const [rowOrUndefined] = await db.update(reportFillTemplates).set({
      status: 'published',
      publishedSchema: existing.formSchema,
      publishedRevision: nextRevision,
      publishedAt: new Date(),
      publishedBy: currentUser().userId,
      revision: nextRevision,
    }).where(and(
      eq(reportFillTemplates.id, id),
      eq(reportFillTemplates.revision, input.expectedRevision),
    )).returning();
    const row = requireRow(rowOrUndefined, '模板状态已变化，请刷新后重试', 409);
    return mapReportFillTemplate(row);
  }
  if (existing.status !== 'published') throw new HTTPException(409, { message: '仅已发布模板可以下线' });
  const [rowOrUndefined] = await db.update(reportFillTemplates).set({
    status: 'disabled',
    revision: sql`${reportFillTemplates.revision} + 1`,
  }).where(and(
    eq(reportFillTemplates.id, id),
    eq(reportFillTemplates.revision, input.expectedRevision),
    eq(reportFillTemplates.status, 'published'),
  )).returning();
  const row = requireRow(rowOrUndefined, '模板状态已变化，请刷新后重试', 409);
  return mapReportFillTemplate(row);
}

export async function cloneReportFillTemplate(
  id: number,
  input: CloneReportFillTemplateInput,
): Promise<ReportFillTemplate> {
  const source = await ensureReportFillTemplate(id);
  const placement = await validatePlacement({ folderId: input.folderId ?? source.folderId });
  try {
    const [row] = await db.insert(reportFillTemplates).values({
      tenantId: placement.tenantId,
      folderId: input.folderId ?? source.folderId,
      ownerId: placement.ownerId,
      code: input.code,
      name: input.name,
      description: source.description,
      formSchema: source.formSchema,
      workflowDefinitionId: source.workflowDefinitionId,
      needReview: source.needReview,
      status: 'draft',
    }).returning();
    return mapReportFillTemplate(row);
  } catch (error) {
    rethrowPgUniqueViolation(error, '填报模板编码已存在');
    throw error;
  }
}

export async function deleteReportFillTemplate(id: number): Promise<void> {
  const existing = await ensureReportFillTemplate(id, 'owner');
  if (existing.status === 'published') throw new HTTPException(409, { message: '请先下线模板再删除' });
  if (await db.$count(reportFillRecords, eq(reportFillRecords.templateId, id))) {
    throw new HTTPException(409, { message: '模板已有填报记录，不能删除' });
  }
  await db.delete(reportFillTemplates).where(eq(reportFillTemplates.id, id));
}
