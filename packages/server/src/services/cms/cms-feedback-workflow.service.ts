import { and, desc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import { previewCmsFeedbackWorkflowSchema, submitCmsFeedbackWorkflowSchema } from '@zenith/shared/cms';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES, type WorkflowInstance } from '@zenith/shared/workflow';
import { db } from '../../db';
import { cmsFeedbackCases, workflowInstances, type CmsFeedbackCaseRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { startWorkflowForBiz, onWorkflowResult } from '../../lib/workflow-biz-bridge';
import { requireRow } from '../../lib/db-assert';
import { getBusinessWorkflowContext, previewBusinessWorkflow } from '../workflow/workflow-business-context.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { appendCmsFeedbackHistory, assertCmsFeedbackEditable, assertCmsFeedbackVersion, CMS_FEEDBACK_BIZ_TYPE, getCmsFeedbackDetail, requireCmsFeedbackCase, validateCmsFeedbackWorkflowDefinition } from './cms-feedback.service';

const variables = (row: CmsFeedbackCaseRow, siteName: string) => ({ feedbackTitle: row.title, formName: row.formName, siteName, ownerId: row.ownerId, feedbackVersion: row.workflowSubjectVersion, resolution: row.resolution });
export async function previewCmsFeedbackWorkflow(id: number, input: z.output<typeof previewCmsFeedbackWorkflowSchema>) {
  const row = await requireCmsFeedbackCase(db, id); await assertSiteAccess(row.siteId);
  if (!row.workflowDefinitionId) return { definition: null, nodes: [] };
  await validateCmsFeedbackWorkflowDefinition(row.workflowDefinitionId);
  const site = await ensureCmsSiteExists(row.siteId);
  return previewBusinessWorkflow(row.workflowDefinitionId, { ...variables(row, site.name), resolution: input.note ?? row.resolution, feedbackVersion: row.version + 1 });
}
export async function getCmsFeedbackWorkflowContext(id: number, instanceId?: number) {
  const row = await requireCmsFeedbackCase(db, id); await assertSiteAccess(row.siteId);
  const current = row.status === 'resolved' || WORKFLOW_ACTIVE_INSTANCE_STATUSES.some((status) => status === row.workflowStatus) ? row.workflowInstanceId ?? 'latest' : null;
  return getBusinessWorkflowContext(CMS_FEEDBACK_BIZ_TYPE, String(id), current, instanceId);
}
async function applyFeedbackWorkflowResult(instance: Pick<WorkflowInstance, 'id' | 'bizId' | 'formData' | 'status'>, status: 'created' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled') {
  const id = Number(instance.bizId);
  await db.transaction(async (tx) => {
    const row = await requireCmsFeedbackCase(tx, id, true);
    const instanceFeedbackVersion = (instance.formData as Record<string, unknown> | null | undefined)?.feedbackVersion;
    if (row.workflowSubjectVersion !== Number(instanceFeedbackVersion)) return;
    if (row.workflowInstanceId && row.workflowInstanceId !== instance.id) return;
    if (status === 'created' && row.workflowInstanceId === instance.id) return;
    if (status !== 'created' && row.workflowStatus === status && (status !== 'approved' || row.status === 'resolved')) return;
    const [updated] = await tx.update(cmsFeedbackCases).set({ workflowInstanceId: instance.id, workflowStatus: status === 'created' ? instance.status : status,
      ...(status === 'approved' || (status === 'created' && instance.status === 'approved') ? { status: 'resolved' as const } : status === 'rejected' || status === 'withdrawn' || status === 'cancelled' ? { status: 'processing' as const } : {}), version: row.version + 1,
    }).where(eq(cmsFeedbackCases.id, id)).returning();
    await appendCmsFeedbackHistory(tx, updated, `workflow:${status}`, null, { id: null, name: '工作流' });
  });
}
export async function submitCmsFeedbackWorkflow(id: number, input: z.output<typeof submitCmsFeedbackWorkflowSchema>) {
  const original = await requireCmsFeedbackCase(db, id); await assertSiteAccess(original.siteId);
  if (!original.workflowDefinitionId) throw new HTTPException(400, { message: '该来信未配置办理审批，可直接填写意见后完成处理' });
  await validateCmsFeedbackWorkflowDefinition(original.workflowDefinitionId);
  const site = await ensureCmsSiteExists(original.siteId);
  const claimed = await db.transaction(async (tx) => {
    const row = await requireCmsFeedbackCase(tx, id, true);
    assertCmsFeedbackVersion(row, input.expectedVersion); assertCmsFeedbackEditable(row);
    if (row.status !== 'processing') throw new HTTPException(400, { message: '请先将来信转为处理中，再提交办理结果' });
    const [updated] = await tx.update(cmsFeedbackCases).set({ workflowStatus: 'running', workflowInstanceId: null, resolution: input.note,
      workflowSubjectVersion: row.version + 1, version: row.version + 1,
    }).where(and(eq(cmsFeedbackCases.id, id), eq(cmsFeedbackCases.version, input.expectedVersion))).returning();
    await appendCmsFeedbackHistory(tx, requireRow(updated, '办理记录已变化', 409), 'workflow:submitted', input.note);
    return updated;
  });
  try {
    const [existing] = await db.select().from(workflowInstances).where(and(eq(workflowInstances.bizType, CMS_FEEDBACK_BIZ_TYPE), eq(workflowInstances.bizId, String(id)), inArray(workflowInstances.status, [...WORKFLOW_ACTIVE_INSTANCE_STATUSES]))).orderBy(desc(workflowInstances.id)).limit(1);
    if (existing && Number((existing.formData as Record<string, unknown> | null | undefined)?.feedbackVersion) !== claimed.workflowSubjectVersion) throw new HTTPException(409, { message: '来信已有未结束的审批轮次，请先处理原轮次' });
    const user = currentUser();
    const instance = await startWorkflowForBiz({ definitionId: claimed.workflowDefinitionId!, title: `来信办理 - ${claimed.title}`, bizType: CMS_FEEDBACK_BIZ_TYPE, bizId: id, variables: variables(claimed, site.name), caller: { userId: user.userId, username: user.username, tenantId: null, roles: user.roles } });
    await applyFeedbackWorkflowResult(instance, 'created');
  } catch (error) {
    await db.transaction(async (tx) => {
      const row = await requireCmsFeedbackCase(tx, id, true);
      if (row.workflowInstanceId || row.workflowSubjectVersion !== claimed.workflowSubjectVersion) return;
      const [instance] = await tx.select().from(workflowInstances).where(and(eq(workflowInstances.bizType, CMS_FEEDBACK_BIZ_TYPE), eq(workflowInstances.bizId, String(id)))).orderBy(desc(workflowInstances.id)).limit(1);
      if (instance && Number((instance.formData as Record<string, unknown> | null | undefined)?.feedbackVersion) === claimed.workflowSubjectVersion) {
        const [updated] = await tx.update(cmsFeedbackCases).set({ workflowInstanceId: instance.id, workflowStatus: instance.status, status: instance.status === 'approved' ? 'resolved' : 'processing', version: row.version + 1 }).where(eq(cmsFeedbackCases.id, id)).returning();
        await appendCmsFeedbackHistory(tx, updated, 'workflow:reconciled');
        return;
      }
      const [updated] = await tx.update(cmsFeedbackCases).set({ workflowStatus: null, workflowSubjectVersion: null, version: row.version + 1 }).where(eq(cmsFeedbackCases.id, id)).returning();
      await appendCmsFeedbackHistory(tx, updated, 'workflow:failed', '审批未能发起，可修正配置后重新提交');
    });
    throw error;
  }
  return getCmsFeedbackDetail(id);
}
export async function reconcileCmsFeedbackWorkflow(id: number) {
  const row = await requireCmsFeedbackCase(db, id);
  if (!row.workflowInstanceId) return;
  const [instance] = await db.select({ id: workflowInstances.id, bizId: workflowInstances.bizId, formData: workflowInstances.formData, status: workflowInstances.status }).from(workflowInstances)
    .where(and(eq(workflowInstances.id, row.workflowInstanceId), eq(workflowInstances.bizType, CMS_FEEDBACK_BIZ_TYPE), eq(workflowInstances.bizId, String(id)))).limit(1);
  if (instance && (instance.status === 'approved' || instance.status === 'rejected' || instance.status === 'withdrawn' || instance.status === 'cancelled')) await applyFeedbackWorkflowResult(instance, instance.status);
}
export function registerCmsFeedbackWorkflowSubscribers() {
  onWorkflowResult(CMS_FEEDBACK_BIZ_TYPE, { onCreated: (instance) => applyFeedbackWorkflowResult(instance, 'created'), onApproved: (instance) => applyFeedbackWorkflowResult(instance, 'approved'), onRejected: (instance) => applyFeedbackWorkflowResult(instance, 'rejected'), onWithdrawn: (instance) => applyFeedbackWorkflowResult(instance, 'withdrawn') });
}
