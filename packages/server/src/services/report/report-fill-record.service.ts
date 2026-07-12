import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { reportFillRecords, reportFillTemplates } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { getUserPermissions, isSuperAdmin } from '../../lib/permissions';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import {
  type CancelReportFillRecordInput,
  type CreateReportFillRecordInput,
  type ReportFillRecord,
  type ReportFillRecordStatus,
  type ReviewReportFillRecordInput,
  type SubmitReportFillRecordInput,
  type UpdateReportFillRecordInput,
} from '@zenith/shared';
import { createInstance, withdrawInstance } from '../workflow/instances/lifecycle';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import {
  ensureReportResourceAccess,
  listAccessibleReportResourceIds,
} from './report-resource-acl.service';
import { ensureReportFillTemplate } from './report-fill-template.service';
import { validateReportFillValues } from './report-fill-validation';
import { bridgeReportFillWorkflowOutcome } from './report-fill-workflow-bridge.service';
import { submitReportFillSyncTask } from './report-fill-task.service';
import {
  assertReportFillRecordRevision,
  isReportFillRecordActionAllowed,
} from './report-fill-state';

type RecordRow = typeof reportFillRecords.$inferSelect;

export function mapReportFillRecord(row: RecordRow): ReportFillRecord {
  return {
    ...row,
    submittedAt: row.submittedAt ? formatDateTime(row.submittedAt) : null,
    reviewedAt: row.reviewedAt ? formatDateTime(row.reviewedAt) : null,
    syncedAt: row.syncedAt ? formatDateTime(row.syncedAt) : null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function canReviewFillRecords(): Promise<boolean> {
  const user = currentUser();
  if (isSuperAdmin(user)) return true;
  return (await getUserPermissions(user.userId)).includes('report:fill:record:review');
}

async function ensureRecordRow(id: number): Promise<RecordRow> {
  const row = await db.query.reportFillRecords.findFirst({
    where: reportScopedWhere(reportFillRecords, eq(reportFillRecords.id, id)),
  });
  if (!row) throw new HTTPException(404, { message: '填报记录不存在' });
  return row;
}

async function ensureOwnRecord(id: number): Promise<RecordRow> {
  const row = await ensureRecordRow(id);
  if (row.submitterId !== currentUser().userId) throw new HTTPException(404, { message: '填报记录不存在' });
  return row;
}

async function ensureVisibleRecord(id: number): Promise<RecordRow> {
  const row = await ensureRecordRow(id);
  if (row.submitterId === currentUser().userId) return row;
  if (!await canReviewFillRecords()) throw new HTTPException(404, { message: '填报记录不存在' });
  await ensureReportResourceAccess('fill_template', row.templateId, 'viewer');
  return row;
}

export async function listMyReportFillRecords(query: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: ReportFillRecordStatus;
  templateId?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const conditions = [
    reportTenantScope(reportFillRecords),
    eq(reportFillRecords.submitterId, currentUser().userId),
    query.status ? eq(reportFillRecords.status, query.status) : undefined,
    query.templateId ? eq(reportFillRecords.templateId, query.templateId) : undefined,
  ];
  let where = and(...conditions.filter((item): item is NonNullable<typeof item> => Boolean(item)));
  if (query.keyword) {
    const templateIds = db.select({ id: reportFillTemplates.id }).from(reportFillTemplates).where(and(
      reportTenantScope(reportFillTemplates),
      or(
        ilike(reportFillTemplates.name, `%${escapeLike(query.keyword)}%`),
        ilike(reportFillTemplates.code, `%${escapeLike(query.keyword)}%`),
      ),
    ));
    where = and(where, inArray(reportFillRecords.templateId, templateIds));
  }
  const [total, rows] = await Promise.all([
    db.$count(reportFillRecords, where),
    db.select().from(reportFillRecords).where(where)
      .orderBy(desc(reportFillRecords.updatedAt))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapReportFillRecord), total, page, pageSize };
}

export async function listAdminReportFillRecords(query: {
  page?: number;
  pageSize?: number;
  status?: ReportFillRecordStatus;
  templateId?: number;
  submitterId?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const accessibleTemplateIds = await listAccessibleReportResourceIds('fill_template');
  if (accessibleTemplateIds && accessibleTemplateIds.length === 0) return { list: [], total: 0, page, pageSize };
  const where = and(
    reportTenantScope(reportFillRecords),
    accessibleTemplateIds ? inArray(reportFillRecords.templateId, accessibleTemplateIds) : undefined,
    query.status ? eq(reportFillRecords.status, query.status) : undefined,
    query.templateId ? eq(reportFillRecords.templateId, query.templateId) : undefined,
    query.submitterId ? eq(reportFillRecords.submitterId, query.submitterId) : undefined,
  );
  const [total, rows] = await Promise.all([
    db.$count(reportFillRecords, where),
    db.select().from(reportFillRecords).where(where)
      .orderBy(desc(reportFillRecords.updatedAt))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapReportFillRecord), total, page, pageSize };
}

export async function getReportFillRecord(id: number): Promise<ReportFillRecord> {
  return mapReportFillRecord(await ensureVisibleRecord(id));
}

export async function createReportFillRecord(
  input: CreateReportFillRecordInput,
): Promise<ReportFillRecord> {
  const template = await ensureReportFillTemplate(input.templateId, 'viewer');
  if (template.status !== 'published' || !template.publishedSchema || !template.publishedRevision) {
    throw new HTTPException(409, { message: '填报模板未发布或发布快照无效' });
  }
  const data = input.data ?? {};
  validateReportFillValues(template.publishedSchema, data);
  const [row] = await db.insert(reportFillRecords).values({
    tenantId: reportCreateTenantId(),
    templateId: template.id,
    submitterId: currentUser().userId,
    status: 'draft',
    data,
    templateRevision: template.publishedRevision,
    templateSchemaSnapshot: template.publishedSchema,
    templateNeedReview: template.needReview,
    workflowDefinitionIdSnapshot: template.workflowDefinitionId,
  }).returning();
  return mapReportFillRecord(row);
}

export async function updateReportFillRecord(
  id: number,
  input: UpdateReportFillRecordInput,
): Promise<ReportFillRecord> {
  const existing = await ensureOwnRecord(id);
  if (!isReportFillRecordActionAllowed(existing.status, 'edit')) {
    throw new HTTPException(409, { message: '当前状态不允许编辑' });
  }
  assertReportFillRecordRevision(existing.revision, input.expectedRevision);
  validateReportFillValues(existing.templateSchemaSnapshot, input.data);
  const [row] = await db.update(reportFillRecords).set({
    data: input.data,
    revision: sql`${reportFillRecords.revision} + 1`,
  }).where(and(
    eq(reportFillRecords.id, id),
    eq(reportFillRecords.revision, input.expectedRevision),
    inArray(reportFillRecords.status, ['draft', 'rejected']),
  )).returning();
  if (!row) throw new HTTPException(409, { message: '记录已被其他操作更新，请刷新后重试' });
  return mapReportFillRecord(row);
}

async function completeWorkflowLink(record: RecordRow) {
  const template = await ensureReportFillTemplate(record.templateId, 'viewer');
  if (!record.workflowDefinitionIdSnapshot) return record;
  const instance = await createInstance({
    definitionId: record.workflowDefinitionIdSnapshot,
    title: `${template.name} #${record.id}`,
    formData: record.data,
    bizType: 'report_fill',
    bizId: String(record.id),
  });
  const [linked] = await db.update(reportFillRecords).set({
    workflowInstanceId: instance.id,
    status: instance.status === 'running' ? 'in_review' : record.status,
  }).where(and(
    eq(reportFillRecords.id, record.id),
    eq(reportFillRecords.status, 'submitted'),
    or(
      sql`${reportFillRecords.workflowInstanceId} is null`,
      eq(reportFillRecords.workflowInstanceId, instance.id),
    ),
  )).returning({ id: reportFillRecords.id });
  if (!linked) {
    const current = await ensureRecordRow(record.id);
    if (current.workflowInstanceId === instance.id) return current;
    if (instance.status === 'running') await withdrawInstance(instance.id);
    return current;
  }
  if (['approved', 'rejected', 'withdrawn', 'cancelled'].includes(instance.status)) {
    const bridge = await db.transaction((tx) => bridgeReportFillWorkflowOutcome(tx, {
      workflowInstanceId: instance.id,
      outcome: instance.status as 'approved' | 'rejected' | 'withdrawn' | 'cancelled',
      actorId: currentUser().userId,
    }));
    if (bridge.approved && bridge.recordId) await submitReportFillSyncTask(bridge.recordId);
  }

  return ensureRecordRow(record.id);
}

export async function resumeReportFillWorkflow(recordId: number): Promise<ReportFillRecord> {
  const record = await ensureOwnRecord(recordId);
  if (!['submitted', 'in_review'].includes(record.status) || record.workflowInstanceId) {
    return mapReportFillRecord(record);
  }
  return mapReportFillRecord(await completeWorkflowLink(record));
}

export async function submitReportFillRecord(
  id: number,
  input: SubmitReportFillRecordInput,
): Promise<ReportFillRecord> {
  let existing = await ensureOwnRecord(id);
  if (['approved', 'cancelled'].includes(existing.status)) return mapReportFillRecord(existing);
  if (['submitted', 'in_review'].includes(existing.status)) {
    if (!existing.workflowInstanceId) existing = await completeWorkflowLink(existing);
    return mapReportFillRecord(existing);
  }
  if (!isReportFillRecordActionAllowed(existing.status, 'submit')) {
    throw new HTTPException(409, { message: '当前状态不允许提交' });
  }
  assertReportFillRecordRevision(existing.revision, input.expectedRevision);
  validateReportFillValues(existing.templateSchemaSnapshot, existing.data);
  const nextStatus = existing.templateNeedReview ? 'submitted' : 'approved';
  const [updated] = await db.update(reportFillRecords).set({
    status: nextStatus,
    submittedAt: new Date(),
    submitComment: input.comment,
    reviewedAt: nextStatus === 'approved' ? new Date() : null,
    reviewedBy: nextStatus === 'approved' ? currentUser().userId : null,
    reviewComment: null,
    syncStatus: nextStatus === 'approved' ? 'pending' : existing.syncStatus,
    syncError: null,
    revision: sql`${reportFillRecords.revision} + 1`,
  }).where(and(
    eq(reportFillRecords.id, id),
    eq(reportFillRecords.revision, input.expectedRevision),
    inArray(reportFillRecords.status, ['draft', 'rejected']),
  )).returning();
  if (!updated) {
    existing = await ensureOwnRecord(id);
    if (['submitted', 'in_review'].includes(existing.status) && !existing.workflowInstanceId) {
      existing = await completeWorkflowLink(existing);
    }
    if (['submitted', 'in_review', 'approved'].includes(existing.status)) return mapReportFillRecord(existing);
    throw new HTTPException(409, { message: '记录已被其他操作更新，请刷新后重试' });
  }
  if (nextStatus === 'approved') {
    await submitReportFillSyncTask(updated.id);
    return mapReportFillRecord(await ensureRecordRow(updated.id));
  }
  const linked = updated.workflowDefinitionIdSnapshot ? await completeWorkflowLink(updated) : updated;
  return mapReportFillRecord(linked);
}

export async function cancelReportFillRecord(
  id: number,
  input: CancelReportFillRecordInput,
): Promise<ReportFillRecord> {
  const existing = await ensureOwnRecord(id);
  if (existing.status === 'cancelled') return mapReportFillRecord(existing);
  assertReportFillRecordRevision(existing.revision, input.expectedRevision);
  if (existing.workflowInstanceId && ['submitted', 'in_review'].includes(existing.status)) {
    await withdrawInstance(existing.workflowInstanceId);
    return mapReportFillRecord(await ensureRecordRow(id));
  }
  if (!isReportFillRecordActionAllowed(existing.status, 'cancel')) {
    throw new HTTPException(409, { message: '当前状态不允许取消或撤回' });
  }
  const [row] = await db.update(reportFillRecords).set({
    status: 'cancelled',
    reviewComment: input.reason,
    revision: sql`${reportFillRecords.revision} + 1`,
  }).where(and(
    eq(reportFillRecords.id, id),
    eq(reportFillRecords.revision, input.expectedRevision),
    inArray(reportFillRecords.status, ['draft', 'rejected', 'submitted']),
  )).returning();
  if (!row) throw new HTTPException(409, { message: '记录已被其他操作更新，请刷新后重试' });
  return mapReportFillRecord(row);
}

export async function reviewReportFillRecord(
  id: number,
  input: ReviewReportFillRecordInput,
): Promise<ReportFillRecord> {
  const existing = await ensureVisibleRecord(id);
  if (!isReportFillRecordActionAllowed(existing.status, 'review')) {
    throw new HTTPException(409, { message: '当前状态不允许审核' });
  }
  assertReportFillRecordRevision(existing.revision, input.expectedRevision);
  await ensureReportFillTemplate(existing.templateId, 'viewer');
  if (!existing.templateNeedReview || existing.workflowDefinitionIdSnapshot || existing.workflowInstanceId) {
    throw new HTTPException(409, { message: '该记录必须通过绑定的工作流审批，不能直接审核' });
  }
  const status = input.decision;
  const [row] = await db.update(reportFillRecords).set({
    status,
    reviewedAt: new Date(),
    reviewedBy: currentUser().userId,
    reviewComment: input.comment,
    syncStatus: status === 'approved' ? 'pending' : existing.syncStatus,
    syncError: status === 'approved' ? null : existing.syncError,
    revision: sql`${reportFillRecords.revision} + 1`,
  }).where(and(
    eq(reportFillRecords.id, id),
    eq(reportFillRecords.revision, input.expectedRevision),
    inArray(reportFillRecords.status, ['submitted', 'in_review']),
  )).returning();
  if (!row) throw new HTTPException(409, { message: '记录已被其他审核操作处理，请刷新后重试' });
  if (status === 'approved') await submitReportFillSyncTask(row.id);
  return mapReportFillRecord(await ensureRecordRow(row.id));
}
