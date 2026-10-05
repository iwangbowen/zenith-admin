import { eq } from 'drizzle-orm';
import type { WorkflowScheduleLaunchPayload } from '@zenith/shared/workflow';
import { db } from '../../../db';
import { users, workflowSchedules } from '../../../db/schema';
import { createInstance } from '../../../services/workflow/workflow-instances.service';
import { formatDateTime } from '../../datetime';
import { exactTenantCondition } from '../../tenant';
import { buildWhere } from '../../where-helpers';
import { registerJobHandler } from '../registry';
import { WorkflowJobPermanentError, WorkflowJobLeaseLostError, WorkflowJobDeadlineError } from '../errors';
import type { WorkflowJobContext, WorkflowJobResult } from '../types';
import { readWorkflowJobStepResult } from '../steps';
import { withWorkflowJobTransaction } from '../lease';

export function parseScheduleLaunchPayload(input: Record<string, unknown>): WorkflowScheduleLaunchPayload {
  const payload = input as Partial<WorkflowScheduleLaunchPayload>;
  if (![payload.scheduleId, payload.definitionId, payload.initiatorId].every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)
    || typeof payload.title !== 'string' || !payload.title.trim()
    || typeof payload.scheduledAt !== 'string' || Number.isNaN(Date.parse(payload.scheduledAt))
    || !['scheduled', 'manual'].includes(payload.trigger ?? '')
    || !payload.formData || typeof payload.formData !== 'object' || Array.isArray(payload.formData)) {
    throw new WorkflowJobPermanentError('定时发起作业参数缺失或非法');
  }
  return payload as WorkflowScheduleLaunchPayload;
}

/** Every attempt uses the same immutable occurrence; the ledger owns backoff, audit and replay. */
export async function handleScheduleLaunch(context: WorkflowJobContext): Promise<WorkflowJobResult> {
  const payload = parseScheduleLaunchPayload(context.payload);
  context.signal.throwIfAborted();
  try {
    const committed = await readWorkflowJobStepResult<{ instanceId: number }>('schedule-launch');
    let instanceId = committed?.instanceId;
    if (instanceId === undefined) {
      const [initiator] = await db.select({ username: users.username, status: users.status }).from(users)
        .where(buildWhere(eq(users.id, payload.initiatorId), exactTenantCondition(users.tenantId, context.job.tenantId))).limit(1);
      if (!initiator) throw new Error('发起人不存在');
      if (initiator.status !== 'enabled') throw new Error('发起人已停用，不能创建新的流程申请');
      const instance = await createInstance({ definitionId: payload.definitionId, title: payload.title, formData: payload.formData },
        { userId: payload.initiatorId, username: initiator.username, tenantId: context.job.tenantId, roles: [] }, [], 'schedule-launch');
      instanceId = instance.id;
    }
    await withWorkflowJobTransaction(context, (tx) => tx.update(workflowSchedules)
      .set({ lastRunAt: new Date(), lastRunStatus: 'success', lastRunMessage: `已发起：${payload.title}` })
      .where(buildWhere(eq(workflowSchedules.id, payload.scheduleId), exactTenantCondition(workflowSchedules.tenantId, context.job.tenantId))));
    return { result: { scheduleId: payload.scheduleId, scheduledAt: payload.scheduledAt, trigger: payload.trigger,
      instanceId, title: payload.title, message: `已发起：${payload.title}` } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A canceled/expired owner may not overwrite a newer rule summary.
    if (!context.signal.aborted && !(error instanceof WorkflowJobLeaseLostError) && !(error instanceof WorkflowJobDeadlineError)) {
      await withWorkflowJobTransaction(context, (tx) => tx.update(workflowSchedules)
        .set({ lastRunAt: new Date(), lastRunStatus: 'fail',
          lastRunMessage: `${formatDateTime(new Date(payload.scheduledAt))}：${message}`.slice(0, 512) })
        .where(buildWhere(eq(workflowSchedules.id, payload.scheduleId), exactTenantCondition(workflowSchedules.tenantId, context.job.tenantId))));
    }
    throw error;
  }
}

registerJobHandler('schedule_launch', handleScheduleLaunch);
