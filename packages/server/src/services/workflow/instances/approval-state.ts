import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { evaluateWorkflowApprovalActivation, workflowNodeActivationSchema, workflowApprovalSlotSchema, workflowSignGroupSchema, type WorkflowNodeActivation, type WorkflowEventActor, type WorkflowFlowData } from '@zenith/shared/workflow';
import { workflowNodeActivations, workflowApprovalSlots, workflowSignGroups, workflowTasks, workflowInstances } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';
import { requireRow } from '../../../lib/db-assert';
import { pickEntity } from '../../../lib/entity-map';
import { resolveUserNames } from '../../../lib/user-nicknames';
import { tenantScope } from '../../../lib/tenant';
import { cancelJobs } from '../../../lib/workflow-jobs/engine';
import { armTaskAsyncJobs } from './async-jobs';
import { emitTaskEvent } from './shared';
import { mapTask } from './mapping';

export async function loadApprovalActivations(executor: DbExecutor, instanceId: number, viewerId?: number, administrator = false): Promise<WorkflowNodeActivation[]> {
  const activations = await executor.select().from(workflowNodeActivations).where(eq(workflowNodeActivations.instanceId, instanceId)).orderBy(workflowNodeActivations.createdAt);
  if (activations.length === 0) return [];
  const [policyInstance] = viewerId != null || administrator
    ? await executor.select({ status: workflowInstances.status, snapshot: workflowInstances.definitionSnapshot }).from(workflowInstances).where(and(eq(workflowInstances.id, instanceId), tenantScope(workflowInstances))).limit(1)
    : [];
  const activationIds = activations.map((row) => row.id);
  const slots = await executor.select().from(workflowApprovalSlots).where(inArray(workflowApprovalSlots.activationId, activationIds));
  const groups = await executor.select().from(workflowSignGroups).where(inArray(workflowSignGroups.activationId, activationIds));
  const names = await resolveUserNames(slots.flatMap((slot) => slot.currentAssigneeId == null ? [] : [slot.currentAssigneeId]), executor);
  return activations.map((row) => {
    const members = slots.filter((slot) => slot.activationId === row.id).map((slot) => pickEntity(workflowApprovalSlotSchema, slot, { assigneeName: slot.currentAssigneeId == null ? null : names.get(slot.currentAssigneeId) ?? null }));
    const base = members.filter((slot) => slot.origin === 'base');
    return pickEntity(workflowNodeActivationSchema, row, {
      baseApproved: base.filter((slot) => slot.status === 'approved').length,
      baseRejected: base.filter((slot) => slot.status === 'rejected').length,
      baseSatisfied: base.filter((slot) => slot.status === 'approved').length >= row.baseRequired,
      slots: members,
      signGroups: groups.filter((group) => group.activationId === row.id).map((group) => {
        const anchor = members.find((slot) => slot.id === group.anchorSlotId);
        return pickEntity(workflowSignGroupSchema, group, {
          canReduce: policyInstance?.status === 'running'
            && policyInstance.snapshot.flowData?.nodes.find((node) => node.data.key === row.nodeKey)?.data.actionButtons?.reduceSign?.enabled === true
            && row.status === 'active' && (group.status === 'waiting' || group.status === 'active')
            && (administrator || (viewerId != null && (group.createdBy === viewerId || anchor?.currentAssigneeId === viewerId || anchor?.originalAssigneeId === viewerId))),
          slots: members.filter((slot) => slot.groupId === group.id),
        });
      }),
    });
  });
}

export async function loadApprovalActivation(executor: DbExecutor, instanceId: number, activationId: string): Promise<WorkflowNodeActivation> {
  return requireRow((await loadApprovalActivations(executor, instanceId)).find((activation) => activation.id === activationId), '缺少显式节点轮次，请重新发起流程', 409);
}

/** 正式意见只更新本任务承接的席位；委派建议不能调用。 */
export async function recordSlotOutcome(executor: DbExecutor, task: typeof workflowTasks.$inferSelect, outcome: 'approved' | 'rejected'): Promise<void> {
  if (task.taskKind === 'suggestion') throw new HTTPException(409, { message: '受托建议必须由原审批人正式确认' });
  if (task.slotId == null) return;
  if (task.activationId == null) throw new HTTPException(409, { message: '正式审批席位缺少节点轮次' });
  const [slot] = await executor.update(workflowApprovalSlots).set({ status: outcome })
    .where(and(eq(workflowApprovalSlots.id, task.slotId), eq(workflowApprovalSlots.activationId, task.activationId), eq(workflowApprovalSlots.currentTaskId, task.id), eq(workflowApprovalSlots.status, 'pending'))).returning();
  requireRow(slot, '审批席位状态已变化，请刷新', 409);
}

/** 在实例锁内应用唯一评估器的结果，激活/清场与事件、超时作业原子提交。 */
export async function reconcileApprovalActivation(
  executor: DbExecutor, inst: typeof workflowInstances.$inferSelect, activationId: string, actor: WorkflowEventActor,
  flowData?: WorkflowFlowData,
): Promise<{ completed: boolean; failed: boolean; method: WorkflowNodeActivation['approveMethod'] }> {
  const previous = await loadApprovalActivation(executor, inst.id, activationId);
  if (previous.status !== 'active') throw new HTTPException(409, { message: '节点轮次已结束，无法继续处理' });
  const result = evaluateWorkflowApprovalActivation(previous);
  for (const group of result.activation.signGroups) {
    if (group.status !== previous.signGroups.find((entry) => entry.id === group.id)?.status) await executor.update(workflowSignGroups).set({ status: group.status }).where(eq(workflowSignGroups.id, group.id));
  }
  for (const slot of result.activation.slots) {
    const old = previous.slots.find((entry) => entry.id === slot.id)!;
    if (old.status !== slot.status || old.mandatory !== slot.mandatory) await executor.update(workflowApprovalSlots).set({ status: slot.status, mandatory: slot.mandatory }).where(eq(workflowApprovalSlots.id, slot.id));
    if (slot.currentTaskId == null) continue;
    const [task] = await executor.select().from(workflowTasks).where(eq(workflowTasks.id, slot.currentTaskId)).limit(1);
    if (!task || (task.status !== 'pending' && task.status !== 'waiting')) continue;
    const reason = result.waitReasons[slot.id];
    const desired = slot.status === 'cancelled' ? 'skipped' : reason ? 'waiting' : 'pending';
    // 外部等待由回调/异步执行接管，不得被人工阶段评估改为 pending。
    if (task.externalCallbackId) continue;
    if (desired === task.status && reason === task.waitReason) continue;
    await cancelJobs({ taskId: task.id, jobTypes: ['task_timeout'] }, executor);
    const [changed] = await executor.update(workflowTasks).set({ status: desired, waitReason: desired === 'waiting' ? reason : null,
      ...(desired === 'pending' && task.status !== 'pending' ? { activatedAt: new Date() } : {}),
      ...(desired === 'skipped' ? { actionAt: new Date(), comment: '[审批汇总] 本席位已取消' } : {}),
    }).where(eq(workflowTasks.id, task.id)).returning();
    const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
    if (desired === 'pending' && task.status !== 'pending') {
      await armTaskAsyncJobs(changed, { id: inst.id, flowData: flowData ?? inst.definitionSnapshot?.flowData ?? null, formData: inst.formData as Record<string, unknown> | null, tenantId: inst.tenantId }, executor);
      if (changed.assigneeId) await emitTaskEvent('task.assigned', mapTask(changed), meta, executor);
    } else if (desired === 'skipped') await emitTaskEvent('task.skipped', mapTask(changed), meta, executor);
  }
  // 成功轮次由推进函数与 token 消费同时落定；失败由拒绝路由统一收口。
  return { completed: result.completed, failed: result.failed, method: previous.approveMethod };
}

/** 终止/跳转/撤回时关闭明确的轮次与未形成意见的席位，不触碰历史已办。 */
export async function cancelApprovalActivations(executor: DbExecutor, instanceId: number, activationId?: string): Promise<void> {
  const rows = await executor.select({ id: workflowNodeActivations.id }).from(workflowNodeActivations)
    .where(and(eq(workflowNodeActivations.instanceId, instanceId), eq(workflowNodeActivations.status, 'active')));
  const ids = rows.filter((row) => activationId == null || row.id === activationId).map((row) => row.id);
  if (ids.length === 0) return;
  await executor.update(workflowNodeActivations).set({ status: 'cancelled', settledAt: new Date() }).where(inArray(workflowNodeActivations.id, ids));
  await executor.update(workflowApprovalSlots).set({ status: 'cancelled' }).where(and(inArray(workflowApprovalSlots.activationId, ids), eq(workflowApprovalSlots.status, 'pending')));
  await executor.update(workflowSignGroups).set({ status: 'cancelled' }).where(and(inArray(workflowSignGroups.activationId, ids), inArray(workflowSignGroups.status, ['active', 'waiting'])));
}

/** 无基础票的独立抄送/异常办理也有显式进入身份，不伪装成某次审批轮。 */
export async function createStandaloneActivation(executor: DbExecutor, args: { instanceId: number; nodeKey: string; nodeName: string; tenantId: number | null; tokenId?: number | null; status: 'active' | 'approved' }): Promise<string> {
 const id = randomUUID();
 await executor.insert(workflowNodeActivations).values({ ...args, id, tokenId: args.tokenId ?? null, baseTotal: 0, baseRequired: 0 });
 return id;
}
