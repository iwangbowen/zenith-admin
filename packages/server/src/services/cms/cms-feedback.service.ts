import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import { stableStringify, type QueryOutputOf } from '@zenith/shared/core';
import { cmsFeedbackDetailSchema, cmsFeedbackHistorySchema, cmsFeedbackSchema, cmsFormHandlingPolicySchema, cmsOperationsContract, canTransitionCmsFeedback, saveCmsFormHandlingPolicySchema, updateCmsFeedbackSchema } from '@zenith/shared/cms';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared/workflow';
import { db } from '../../db';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { cmsFeedbackCases, cmsFeedbackHistory, cmsFormHandlingPolicies, cmsFormSubmissions, cmsForms, users, workflowDefinitions, type CmsFeedbackCaseRow, type CmsFormRow, type CmsFormSubmissionRow } from '../../db/schema';
import { currentUserOrNull } from '../../lib/context';
import { pickEntity } from '../../lib/entity-map';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { parseDateTimeInput } from '../../lib/datetime';
import { requireTenantUser } from '../../lib/user-nicknames';
import { assertSiteAccess } from './cms-sites.service';

export const CMS_FEEDBACK_BIZ_TYPE = 'cms_feedback';
export const CMS_FEEDBACK_VIEW_COMPONENT = 'cms/feedback/CmsFeedbackApprovalView';

export async function requireCmsFeedbackCase(executor: DbExecutor, id: number, lock = false) {
  const query = executor.select().from(cmsFeedbackCases).where(eq(cmsFeedbackCases.id, id)).limit(1);
  const [row] = await (lock ? query.for('update') : query);
  return requireRow(row, '反馈办理记录不存在');
}
export function assertCmsFeedbackVersion(row: CmsFeedbackCaseRow, expectedVersion: number) {
  if (row.version !== expectedVersion) throw new HTTPException(409, { message: '办理记录已被更新，请刷新后重试；本次输入未保存' });
}
export function assertCmsFeedbackEditable(row: CmsFeedbackCaseRow) {
  if (row.workflowStatus && WORKFLOW_ACTIVE_INSTANCE_STATUSES.some((status) => status === row.workflowStatus)) throw new HTTPException(409, { message: '办理结果正在审批，请先在工作流完成或撤回审批' });
}
export async function appendCmsFeedbackHistory(tx: DbTransaction, row: CmsFeedbackCaseRow, action: string, note?: string | null, actor?: { id: number | null; name: string | null }) {
  const [previous] = await tx.select({ hash: cmsFeedbackHistory.hash }).from(cmsFeedbackHistory).where(eq(cmsFeedbackHistory.feedbackId, row.id)).orderBy(desc(cmsFeedbackHistory.version)).limit(1);
  const user = currentUserOrNull();
  const snapshot = { status: row.status, ownerId: row.ownerId, dueAt: row.dueAt?.toISOString() ?? null, resolution: row.resolution, workflowDefinitionId: row.workflowDefinitionId, workflowInstanceId: row.workflowInstanceId, workflowStatus: row.workflowStatus };
  const event = { feedbackId: row.id, version: row.version, action, note: note ?? null, actorId: actor ? actor.id : user?.userId ?? null, actorName: actor ? actor.name : user?.username ?? null, snapshot, previousHash: previous?.hash ?? null };
  const hash = createHash('sha256').update(stableStringify(event)).digest('hex');
  await tx.insert(cmsFeedbackHistory).values({ ...event, hash });
}

/** Created in the same transaction as a validated public form submission. */
export async function createCmsFeedbackForSubmission(tx: DbTransaction, form: CmsFormRow, submission: CmsFormSubmissionRow) {
  const [policy] = await tx.select().from(cmsFormHandlingPolicies).where(eq(cmsFormHandlingPolicies.formId, form.id)).limit(1);
  const [owner] = policy?.defaultOwnerId ? await tx.select({ id: users.id }).from(users).where(and(eq(users.id, policy.defaultOwnerId), eq(users.status, 'enabled'), isNull(users.tenantId))).limit(1) : [];
  const titleField = form.fields.find((field) => /title|subject|message|content/i.test(field.name));
  const summary = titleField && typeof submission.data[titleField.name] === 'string' ? String(submission.data[titleField.name]).slice(0, 180) : '';
  const [row] = await tx.insert(cmsFeedbackCases).values({ siteId: form.siteId, formId: form.id, submissionId: submission.id, title: summary || `${form.name} #${submission.id}`, formName: form.name,
    fields: form.fields.map((field) => ({ name: field.name, label: field.label })), ownerId: owner?.id ?? null, workflowDefinitionId: policy?.workflowDefinitionId ?? null,
  }).returning();
  await appendCmsFeedbackHistory(tx, row, 'received', null, { id: null, name: '读者提交' });
  return row;
}
const mapCase = (row: CmsFeedbackCaseRow, ownerName: string | null) => pickEntity(cmsFeedbackSchema, row, { ownerName });
export async function listCmsFeedback(q: QueryOutputOf<typeof cmsOperationsContract.feedback>) {
  await assertSiteAccess(q.siteId);
  const where = buildWhere(eq(cmsFeedbackCases.siteId, q.siteId), q.formId ? eq(cmsFeedbackCases.formId, q.formId) : undefined, q.status ? eq(cmsFeedbackCases.status, q.status) : undefined,
    q.ownerId ? eq(cmsFeedbackCases.ownerId, q.ownerId) : undefined, keywordCondition(q.keyword, [cmsFeedbackCases.title]));
  return buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(cmsFeedbackCases, where),
    rows: () => withPagination(db.select({ item: cmsFeedbackCases, ownerName: users.nickname }).from(cmsFeedbackCases).leftJoin(users, eq(users.id, cmsFeedbackCases.ownerId)).where(where).orderBy(desc(cmsFeedbackCases.id)).$dynamic(), q.page, q.pageSize),
    map: ({ item, ownerName }) => mapCase(item, ownerName),
  });
}
export async function getCmsFeedbackDetail(id: number, options?: { approvalInstanceId?: number }) {
  const row = await requireCmsFeedbackCase(db, id);
  if (options?.approvalInstanceId) {
    const { requireBusinessApprovalInstance } = await import('../workflow/workflow-business-context.service');
    await requireBusinessApprovalInstance(options.approvalInstanceId, CMS_FEEDBACK_BIZ_TYPE, String(id));
  } else await assertSiteAccess(row.siteId);
  const [[submission], [owner], history] = await Promise.all([
    db.select({ data: cmsFormSubmissions.data }).from(cmsFormSubmissions).where(and(eq(cmsFormSubmissions.id, row.submissionId), eq(cmsFormSubmissions.formId, row.formId))).limit(1),
    row.ownerId ? db.select({ name: users.nickname }).from(users).where(eq(users.id, row.ownerId)).limit(1) : Promise.resolve([]),
    db.select().from(cmsFeedbackHistory).where(eq(cmsFeedbackHistory.feedbackId, id)).orderBy(desc(cmsFeedbackHistory.version)),
  ]);
  return pickEntity(cmsFeedbackDetailSchema, row, { ownerName: owner?.name ?? null, data: requireRow(submission, '原始来信不存在').data, fields: row.fields, history: history.map((event) => pickEntity(cmsFeedbackHistorySchema, event)) });
}
export async function handleCmsFeedback(id: number, input: z.output<typeof updateCmsFeedbackSchema>) {
  const original = await requireCmsFeedbackCase(db, id); await assertSiteAccess(original.siteId);
  if (input.ownerId) await requireTenantUser(input.ownerId, '办理负责人不存在或已停用', { enabledOnly: true });
  await db.transaction(async (tx) => {
    const row = await requireCmsFeedbackCase(tx, id, true); assertCmsFeedbackVersion(row, input.expectedVersion); assertCmsFeedbackEditable(row);
    const status = input.status ?? row.status;
    if (!canTransitionCmsFeedback(row.status, status)) throw new HTTPException(400, { message: '不支持此办理状态转换，请先转为处理中' });
    if (status !== row.status && !input.note?.trim()) throw new HTTPException(400, { message: '状态变化必须填写办理意见' });
    if (status === 'resolved' && row.workflowDefinitionId) throw new HTTPException(409, { message: '本表单已启用办理审批，请提交办理结果，经审批通过后完成' });
    const [updated] = await tx.update(cmsFeedbackCases).set({ status, version: row.version + 1,
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}), ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? parseDateTimeInput(input.dueAt) : null } : {}),
      ...(status === 'resolved' || status === 'closed' ? { resolution: input.note ?? row.resolution } : {}),
    }).where(and(eq(cmsFeedbackCases.id, id), eq(cmsFeedbackCases.version, input.expectedVersion))).returning();
    await appendCmsFeedbackHistory(tx, requireRow(updated, '办理记录已变化', 409), status !== row.status ? `status:${status}` : input.ownerId !== undefined ? 'assigned' : 'note', input.note);
  });
  return getCmsFeedbackDetail(id);
}
async function requireForm(id: number) { const [row] = await db.select().from(cmsForms).where(eq(cmsForms.id, id)).limit(1); const form = requireRow(row, '表单不存在'); await assertSiteAccess(form.siteId); return form; }
export async function getCmsFormHandlingPolicy(formId: number) {
  await requireForm(formId);
  const [row] = await db.select({ policy: cmsFormHandlingPolicies, workflowName: workflowDefinitions.name }).from(cmsFormHandlingPolicies).leftJoin(workflowDefinitions, eq(workflowDefinitions.id, cmsFormHandlingPolicies.workflowDefinitionId)).where(eq(cmsFormHandlingPolicies.formId, formId)).limit(1);
  return row ? pickEntity(cmsFormHandlingPolicySchema, row.policy, { workflowName: row.workflowName }) : { formId, version: 0, workflowDefinitionId: null, workflowName: null, defaultOwnerId: null };
}
export async function validateCmsFeedbackWorkflowDefinition(id: number, executor: DbExecutor = db) {
  const [definition] = await executor.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.status, 'published'), eq(workflowDefinitions.formType, 'external'), isNull(workflowDefinitions.tenantId))).limit(1);
  const customForm = definition?.customForm as { viewComponent?: string | null } | null | undefined;
  if (!definition || customForm?.viewComponent !== CMS_FEEDBACK_VIEW_COMPONENT) throw new HTTPException(400, { message: '请选择已发布的 CMS 来信办理业务流程（查看组件 cms/feedback/CmsFeedbackApprovalView）' });
  return definition;
}
export async function saveCmsFormHandlingPolicy(formId: number, input: z.output<typeof saveCmsFormHandlingPolicySchema>) {
  await requireForm(formId);
  if (input.defaultOwnerId) await requireTenantUser(input.defaultOwnerId, '默认负责人不存在或已停用', { enabledOnly: true });
  if (input.workflowDefinitionId) await validateCmsFeedbackWorkflowDefinition(input.workflowDefinitionId);
  await db.transaction(async (tx) => {
    await tx.select({ id: cmsForms.id }).from(cmsForms).where(eq(cmsForms.id, formId)).for('update');
    const [current] = await tx.select().from(cmsFormHandlingPolicies).where(eq(cmsFormHandlingPolicies.formId, formId)).limit(1);
    if ((current?.version ?? 0) !== input.expectedVersion) throw new HTTPException(409, { message: '办理配置已更新，请刷新后重试' });
    const values = { defaultOwnerId: input.defaultOwnerId, workflowDefinitionId: input.workflowDefinitionId, version: input.expectedVersion + 1 };
    if (current) await tx.update(cmsFormHandlingPolicies).set(values).where(eq(cmsFormHandlingPolicies.id, current.id));
    else await tx.insert(cmsFormHandlingPolicies).values({ ...values, formId });
  });
  return getCmsFormHandlingPolicy(formId);
}
export async function assertCmsSubmissionsDeletable(formId: number, submissionIds?: number[]) {
  const count = await db.$count(cmsFeedbackCases, buildWhere(eq(cmsFeedbackCases.formId, formId), submissionIds ? inArray(cmsFeedbackCases.submissionId, submissionIds) : undefined));
  if (count) throw new HTTPException(409, { message: '来信已经进入办理台账，不能删除办理证据；请在办理页面关闭记录' });
}
