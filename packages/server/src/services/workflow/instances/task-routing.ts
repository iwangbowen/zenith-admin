import { cancelJobs } from '../../../lib/workflow-jobs/engine';
import { bindWorkflowAttachments } from '../workflow-attachments.service';
import { workflowTransaction } from '../../../lib/workflow-jobs/lease';
import { enqueueSubprocessJoin } from './async-jobs';
// ─── 任务流转：转办/委派/加签/减签/退回（拆分自 workflow-instances.service.ts）───
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import type { DbExecutor } from '../../../db/types';
import { workflowInstances, workflowTasks, users, workflowApprovalSlots, workflowSignGroups, workflowNodeActivations } from '../../../db/schema';
import { getAncestorNodeKeys } from '../../../lib/workflow-engine';
import { HTTPException } from 'hono/http-exception';
import { buildStarterContext } from '../workflow-assignee-resolver.service';
import { mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize, checkNodeCompletion } from './materialize';
import { emitInstanceEvent, emitNodeEvent, emitTaskEvent, lockInstanceExpecting } from './shared';
import { assertActionButtonEnabled, assertActionUploadRequirement, getOwnPendingTask, rejectTaskCore } from './task-actions';
import type { WorkflowTaskAttachment } from './task-actions';
import { WORKFLOW_RETURN_TO_INITIATOR_KEY } from '@zenith/shared/workflow';
import { currentUser } from '../../../lib/context';
import { getUserPermissions, isSuperAdmin } from '../../../lib/permissions';
import { loadApprovalActivations, loadApprovalActivation, reconcileApprovalActivation } from './approval-state';
import { requireVisibleInstance, emitTasksEnteredEvents } from './shared';
import { getInstanceDetail } from './queries';
import { armTaskAsyncJobs } from './async-jobs';
import { loadTaskHandledUserIds, recordTaskTransfer, assertAssigneesNotActiveOnNode } from './transfers';
import logger from '../../../lib/logger';
import { bridgeReportFillWorkflowOutcome } from '../../report/report-fill-workflow-bridge.service';
import { submitReportFillSyncForWorkflowInstance } from '../../report/report-fill-task.service';
import { requireRow } from '../../../lib/db-assert';
import { requireTenantUser } from '../../../lib/user-nicknames';
import { tenantCondition } from '../../../lib/tenant';

/** 转办：将当前任务的处理人改为目标用户 */
export async function transferTask(taskId: number, targetUserId: number, comment?: string, attachments?: WorkflowTaskAttachment[]) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionButtonEnabled(inst, task.nodeKey, 'transfer');
  assertActionUploadRequirement(inst, task.nodeKey, 'transfer', attachments);
  if (targetUserId === task.assigneeId) {
    throw new HTTPException(400, { message: '转办人不能是当前处理人' });
  }
  const handled = await loadTaskHandledUserIds(task.id);
  const original = task.originalAssigneeId ?? task.assigneeId;
  // 禁止折返：转给经手过的人（含原始 assignee）
  if (handled.has(targetUserId) || targetUserId === original) {
    throw new HTTPException(400, { message: '禁止将任务转回曾经经手的处理人' });
  }
  const target = await requireTenantUser(targetUserId, '转办人不存在');
  const transferSuffix = comment ? `：${comment}` : '';
  const transferComment = `[转办] 由 ${actor.name ?? '系统'} 转办${transferSuffix}`;
  // 事务 + 实例行级锁：任务改派、转办留痕与事件 outbox 原子提交，并与同实例的审批/加减签等并发操作串行化
  const updated = await workflowTransaction(async (tx) => {
    await lockInstanceExpecting(tx, inst.id, 'running', '流程实例状态已变化，无法转办');
    // 目标人已在本节点同轮持有活动任务时给出友好 409（否则撞 wf_tasks_active_uniq 唯一索引）
    await assertAssigneesNotActiveOnNode(tx, {
      instanceId: inst.id, nodeKey: task.nodeKey, activationId: task.activationId,
      userIds: [targetUserId], excludeTaskId: task.id,
    });
    const [row] = await tx.update(workflowTasks)
      .set({
        assigneeId: targetUserId,
        comment: transferComment,
        attachments: await bindWorkflowAttachments(tx, inst, { source: 'task', taskId: task.id }, attachments, actor.userId ?? undefined),
        originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
      })
      .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
      .returning();
    requireRow(row, '任务状态已变化，无法转办', 409);
    if (task.slotId != null) await tx.update(workflowApprovalSlots).set({ currentAssigneeId: targetUserId }).where(eq(workflowApprovalSlots.id, task.slotId));
    await recordTaskTransfer(tx, {
      taskId: task.id, instanceId: inst.id, fromUserId: task.assigneeId, toUserId: targetUserId,
      action: 'transfer', reason: comment ?? null, operatorId: actor.userId, tenantId: inst.tenantId,
    });
    await emitTaskEvent('task.transferred', mapTask(row, target.nickname),
      { definitionId: inst.definitionId, tenantId: inst.tenantId, actor, comment: transferComment }, tx);
    return row;
  });
  return mapTask(updated, target.nickname);
}

/**
 * 系统级转交（超时升级专用）：将任务转交给上级，重置提醒计数并按超时配置重新计时。
 * 不做归属校验，由超时处理器以系统身份调用；上级解析失败时由调用方兜底。
 */
export async function systemTransferTaskToManager(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  managerId: number,
  newTimeoutAt: Date | null,
  comment: string,
): Promise<void> {
  // 事务：改派、留痕与事件 outbox 原子提交（超时升级由系统触发，实例状态由调用方保证）
  await workflowTransaction((tx) => systemTransferTaskToManagerInTransaction(
    tx, task, inst, managerId, newTimeoutAt, comment,
  ));
}

export async function systemTransferTaskToManagerInTransaction(
  tx: DbExecutor,
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  managerId: number,
  _newTimeoutAt: Date | null,
  comment: string,
): Promise<boolean> {
    const [target] = await tx.select({ nickname: users.nickname })
      .from(users).where(eq(users.id, managerId)).limit(1);
    const [row] = await tx.update(workflowTasks)
      .set({
        assigneeId: managerId,
        comment,
        originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
      })
      .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
      .returning();
    if (!row) return false;
    if (task.slotId != null) await tx.update(workflowApprovalSlots).set({ currentAssigneeId: managerId }).where(eq(workflowApprovalSlots.id, task.slotId));
    await recordTaskTransfer(tx, {
      taskId: task.id, instanceId: inst.id, fromUserId: task.assigneeId, toUserId: managerId,
      action: 'timeout', reason: comment, operatorId: null, tenantId: inst.tenantId,
    });
    await emitTaskEvent('task.transferred', mapTask(row, target?.nickname ?? null), {
      definitionId: inst.definitionId,
      tenantId: inst.tenantId,
      actor: { userId: 0, name: 'system:timeout' },
      comment,
    }, tx);
    return true;
}

/** 委派：与转办类似，但语义为"临时代办"，反馈后原 assignee 会接到回执确认任务 */
export async function delegateTask(taskId: number, targetUserId: number, comment?: string, attachments?: WorkflowTaskAttachment[]) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionButtonEnabled(inst, task.nodeKey, 'delegate');
  assertActionUploadRequirement(inst, task.nodeKey, 'delegate', attachments);
  if (targetUserId === task.assigneeId) {
    throw new HTTPException(400, { message: '委派人不能是当前处理人' });
  }
  const handled = await loadTaskHandledUserIds(task.id);
  const original = task.originalAssigneeId ?? task.assigneeId;
  if (handled.has(targetUserId) || targetUserId === original) {
    throw new HTTPException(400, { message: '禁止将任务委派给曾经经手的处理人' });
  }
  const target = await requireTenantUser(targetUserId, '委派人不存在');
  const delegateSuffix = comment ? `：${comment}` : '';
  const delegateComment = `[委派] 由 ${actor.name ?? '系统'} 委派${delegateSuffix}`;
  // delegatedFromId 仅在首次委派时设置（保留最原始的委派人，以便回执时返还）
  const delegatedFromId = task.delegatedFromId ?? task.assigneeId ?? null;
  // 事务 + 实例行级锁：与转办一致，保证改派、留痕与事件 outbox 原子提交
  const updated = await workflowTransaction(async (tx) => {
    await lockInstanceExpecting(tx, inst.id, 'running', '流程实例状态已变化，无法委派');
    // 委派人已在本节点同轮持有活动任务时给出友好 409（否则撞 wf_tasks_active_uniq 唯一索引）
    await assertAssigneesNotActiveOnNode(tx, {
      instanceId: inst.id, nodeKey: task.nodeKey, activationId: task.activationId,
      userIds: [targetUserId], excludeTaskId: task.id,
    });
    const [row] = await tx.update(workflowTasks)
      .set({
        assigneeId: targetUserId,
        comment: delegateComment,
        attachments: await bindWorkflowAttachments(tx, inst, { source: 'task', taskId: task.id }, attachments, actor.userId ?? undefined),
        originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
        delegatedFromId,
        // 手动委派保持建议制语义：受托人意见回执给原审批人确认（区别于规则委托的 full 直接代批）
        delegationMode: 'suggest', taskKind: 'suggestion',
      })
      .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
      .returning();
    requireRow(row, '任务状态已变化，无法委派', 409);
    if (task.slotId != null) await tx.update(workflowApprovalSlots).set({ currentAssigneeId: targetUserId }).where(eq(workflowApprovalSlots.id, task.slotId));
    await recordTaskTransfer(tx, {
      taskId: task.id, instanceId: inst.id, fromUserId: task.assigneeId, toUserId: targetUserId,
      action: 'delegate', reason: comment ?? null, operatorId: actor.userId, tenantId: inst.tenantId,
    });
    await emitTaskEvent('task.transferred', mapTask(row, target.nickname),
      { definitionId: inst.definitionId, tenantId: inst.tenantId, actor, comment: delegateComment }, tx);
    return row;
  });
  return mapTask(updated, target.nickname);
}

/** 基础席位创建独立必办加签组；禁止嵌套，基础策略不变。 */
export async function addSignTask(taskId: number, targetUserIds: number[], position: 'before' | 'after' | 'parallel', comment?: string, signMode: 'and' | 'or' = 'and', attachments?: WorkflowTaskAttachment[]) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionButtonEnabled(inst, task.nodeKey, 'addSign');
  assertActionUploadRequirement(inst, task.nodeKey, 'addSign', attachments);
  if (task.slotId == null || task.taskKind !== 'approval') throw new HTTPException(400, { message: '只有基础正式审批席位可加签' });
  if (targetUserIds.length === 0 || new Set(targetUserIds).size !== targetUserIds.length) throw new HTTPException(400, { message: '请选择不重复的加签人' });
  if (targetUserIds.includes(task.assigneeId!)) throw new HTTPException(400, { message: '不能给自己加签' });
  for (const userId of targetUserIds) await requireTenantUser(userId, '加签人不存在', { enabledOnly: true });
  const result = await workflowTransaction(async (tx) => {
    await lockInstanceExpecting(tx, inst.id, 'running', '流程状态已变化，无法加签');
    const [fresh] = await tx.select().from(workflowTasks).where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending'), eq(workflowTasks.assigneeId, actor.userId))).limit(1);
    requireRow(fresh, '任务状态已变化，无法加签', 409);
    const activation = await loadApprovalActivation(tx, inst.id, task.activationId);
    const anchor = activation.slots.find((slot) => slot.id === task.slotId);
    if (activation.status !== 'active' || anchor?.origin !== 'base' || anchor.currentTaskId !== task.id || anchor.status !== 'pending') throw new HTTPException(400, { message: '只有本轮待办基础席位可加签，加签席位不可再次加签' });
    await assertAssigneesNotActiveOnNode(tx, { instanceId: inst.id, nodeKey: task.nodeKey, activationId: task.activationId, userIds: targetUserIds });
    const [group] = await tx.insert(workflowSignGroups).values({ activationId: task.activationId, anchorSlotId: anchor.id, position, signMode, status: position === 'after' ? 'waiting' : 'active', tenantId: inst.tenantId }).returning();
    const created: typeof workflowTasks.$inferSelect[] = [];
    for (const assigneeId of targetUserIds) {
      const [slot] = await tx.insert(workflowApprovalSlots).values({ activationId: task.activationId, origin: 'addSign', groupId: group.id, originalAssigneeId: assigneeId, currentAssigneeId: assigneeId, tenantId: inst.tenantId }).returning();
      const [row] = await tx.insert(workflowTasks).values({ instanceId: inst.id, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType, activationId: task.activationId, slotId: slot.id, taskKind: 'approval', assigneeId, originalAssigneeId: assigneeId, status: position === 'after' ? 'waiting' : 'pending', waitReason: position === 'after' ? 'afterSign' : null, activatedAt: position === 'after' ? null : new Date(), comment: comment ?? null, attachments: [] }).returning();
      row.attachments = await bindWorkflowAttachments(tx, inst, { source: 'task', taskId: row.id }, attachments, actor.userId);
      if (row.attachments.length) await tx.update(workflowTasks).set({ attachments: row.attachments }).where(eq(workflowTasks.id, row.id));
      await tx.update(workflowApprovalSlots).set({ currentTaskId: row.id }).where(eq(workflowApprovalSlots.id, slot.id));
      if (row.status === 'pending') await armTaskAsyncJobs(row, { id: inst.id, flowData: inst.definitionSnapshot?.flowData ?? null, formData: inst.formData as Record<string, unknown> | null, tenantId: inst.tenantId }, tx);
      created.push(row);
    }
    await reconcileApprovalActivation(tx, inst, task.activationId, actor);
    const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
    await emitTasksEnteredEvents(inst.id, created, meta, tx);
    for (const row of created) await emitTaskEvent('task.addSigned', mapTask(row, undefined, undefined, undefined, undefined, undefined, position), { ...meta, comment }, tx);
    return { groupId: group.id, created };
  });
  const instance = await getInstanceDetail(inst.id);
  const group = instance.approvalActivations!.flatMap((activation) => activation.signGroups).find((entry) => entry.id === result.groupId)!;
  return { group, created: result.created.map((row) => mapTask(row, undefined, undefined, undefined, undefined, undefined, position)), instance, message: `已加签 ${result.created.length} 人` };
}

/** 组级减签不依赖锚定人的任务仍为 pending；等待前签或原人已办后签都可操作。 */
export async function reduceSignTask(groupId: number, targetSlotIds: number[], comment?: string) {
  const user = currentUser();
  const [groupRow] = await db.select({ group: workflowSignGroups, instanceId: workflowNodeActivations.instanceId }).from(workflowSignGroups).innerJoin(workflowNodeActivations, eq(workflowSignGroups.activationId, workflowNodeActivations.id)).where(and(eq(workflowSignGroups.id, groupId), tenantCondition(workflowSignGroups, user))).limit(1);
  requireRow(groupRow, '加签组不存在');
  const inst = await requireVisibleInstance(groupRow.instanceId);
  const actor = { userId: user.userId, name: user.username };
  const administrator = isSuperAdmin(user) || (await getUserPermissions(user.userId)).includes('workflow:instance:cancel');
  const activation = requireRow((await loadApprovalActivations(db, inst.id, user.userId, administrator)).find((entry) => entry.id === groupRow.group.activationId), '节点轮次不存在');
  const group = requireRow(activation.signGroups.find((entry) => entry.id === groupId), '加签组不存在');
  if (!group.canReduce) throw new HTTPException(403, { message: '无权减签或加签组已结束' });
  assertActionButtonEnabled(inst, activation.nodeKey, 'reduceSign');
  if (targetSlotIds.length === 0 || new Set(targetSlotIds).size !== targetSlotIds.length) throw new HTTPException(400, { message: '请选择不重复的加签席位' });
  const targets = group.slots.filter((slot) => targetSlotIds.includes(slot.id));
  if (targets.length !== targetSlotIds.length || targets.some((slot) => slot.status !== 'pending' || slot.currentTaskId == null)) throw new HTTPException(400, { message: '只能取消本组尚未形成正式意见的席位' });
  const task = requireRow((await db.select().from(workflowTasks).where(eq(workflowTasks.id, targets[0].currentTaskId!)).limit(1))[0], '加签任务不存在');
  const targetTaskIds = targets.map((slot) => slot.currentTaskId!);
  const snapshot = inst.definitionSnapshot;
  const flowData = snapshot?.flowData ?? undefined;
  const suffix = comment ? `：${comment}` : '';
  const reduceComment = `[减签] 由 ${actor.name ?? '系统'} 发起${suffix}`;

  const result = await workflowTransaction(async (tx) => {
    const outcome = await (async () => {
    // 实例行级锁：序列化与并发审批/驳回，确保减签后的节点完成判定与推进原子一致
    await lockInstanceExpecting(tx, inst.id, 'running', '流程状态已变化，无法减签');
    const current = await loadApprovalActivation(tx, inst.id, group.activationId);
    const currentGroup = current.signGroups.find((entry) => entry.id === groupId);
    if (!currentGroup || (currentGroup.status !== 'active' && currentGroup.status !== 'waiting') || current.status !== 'active') throw new HTTPException(409, { message: '加签组已结束' });
    const freshTargets = currentGroup.slots.filter((slot) => targetSlotIds.includes(slot.id));
    if (freshTargets.length !== targetSlotIds.length || freshTargets.some((slot) => slot.status !== 'pending' || !targetTaskIds.includes(slot.currentTaskId!))) throw new HTTPException(409, { message: '加签席位已变化' });
    await tx.update(workflowApprovalSlots).set({ status: 'cancelled' }).where(inArray(workflowApprovalSlots.id, targetSlotIds));
    const updated = await tx.update(workflowTasks).set({
      status: 'skipped', waitReason: null,
      actionAt: new Date(),
      comment: reduceComment,
    }).where(and(
      inArray(workflowTasks.id, targetTaskIds),
      eq(workflowTasks.instanceId, inst.id),
      eq(workflowTasks.nodeKey, task.nodeKey),
      inArray(workflowTasks.status, ['pending', 'waiting']),
    )).returning();
    for (const removedTask of updated) await cancelJobs({ taskId: removedTask.id, jobTypes: ['task_timeout'] }, tx);
    if (updated.length !== targetTaskIds.length) {
      throw new HTTPException(409, { message: '部分任务状态已变化，无法减签' });
    }
    // 复核节点完成状态（例如 ratio 比例会签减签后阈值已达成，需跳过余下任务并推进流程）
    const { completed } = await checkNodeCompletion(tx, inst, task.nodeKey, flowData, group.activationId);
    if (!completed || !flowData) {
      return { removed: updated, advanced: false, finished: false, rejected: false, row: inst, newTasks: [] as typeof workflowTasks.$inferSelect[], fillBridge: null };
    }
    // 减签触发节点完成：推进流程（checkNodeCompletion 已跳过本节点剩余 pending/waiting 任务）
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    const materialized = await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: task.nodeKey }, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });
    if (materialized.rejected) {
      // 下游自动拒绝终止流程：清理实例其余未结束任务，保证 rejected 实例无残留待办
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: '[自动拒绝] 流程被自动拒绝终止，本待办作废' })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
      const [row] = await tx.update(workflowInstances).set({ status: 'rejected', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      await enqueueSubprocessJoin(row, tx);
      const fillBridge = await bridgeReportFillWorkflowOutcome(tx, {
        workflowInstanceId: inst.id,
        outcome: 'rejected',
        actorId: actor.userId,
        comment: reduceComment,
      });
      return { removed: updated, advanced: true, finished: false, rejected: true, row, newTasks: materialized.createdTasks, fillBridge };
    }
    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      await enqueueSubprocessJoin(row, tx);
      const fillBridge = await bridgeReportFillWorkflowOutcome(tx, {
        workflowInstanceId: inst.id,
        outcome: 'approved',
        actorId: actor.userId,
        comment: reduceComment,
      });
      return { removed: updated, advanced: true, finished: true, rejected: false, row, newTasks: materialized.createdTasks, fillBridge };
    }
    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { removed: updated, advanced: true, finished: false, rejected: false, row, newTasks: materialized.createdTasks, fillBridge: null };
    })();
    const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
    for (const row of outcome.removed) {
      await emitTaskEvent('task.skipped', mapTask(row), meta, tx);
      await emitTaskEvent('task.reduceSigned', mapTask(row), { ...meta, comment: reduceComment }, tx);
    }
    if (outcome.advanced) await emitNodeEvent('node.left', { instanceId: inst.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType }, tx);
    await emitTasksEnteredEvents(inst.id, outcome.newTasks, meta, tx);
    if (outcome.finished) await emitInstanceEvent('instance.approved', mapInstance(outcome.row), actor, tx);
    if (outcome.rejected) await emitInstanceEvent('instance.rejected', mapInstance(outcome.row), actor, tx);
    return outcome;
  });

  if (result.fillBridge?.approved) {
    void submitReportFillSyncForWorkflowInstance(result.row.id).catch((error) => {
      logger.error('[report-fill] enqueue sync task failed', {
        workflowInstanceId: result.row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const { removed } = result;
  const advanceNote = result.finished ? '，流程已完成' : (result.advanced ? '，流程已推进' : '');
  const instance = await getInstanceDetail(inst.id);
  const updatedGroup = instance.approvalActivations!.flatMap((entry) => entry.signGroups).find((entry) => entry.id === groupId)!;
  return { group: updatedGroup, instance, removed: removed.map((t) => mapTask(t)), message: `已减签 ${removed.length} 人${advanceNote}` };
}

/** 退回：将当前任务驳回到一个或多个前序节点（多节点取流程定义中最早出现的节点作为执行目标） */
export async function returnTask(taskId: number, targetNodeKeys: string[], comment: string, attachments?: WorkflowTaskAttachment[]) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionButtonEnabled(inst, task.nodeKey, 'return');
  assertActionUploadRequirement(inst, task.nodeKey, 'return', attachments);
  const flowData = inst.definitionSnapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  if (!Array.isArray(targetNodeKeys) || targetNodeKeys.length === 0) {
    throw new HTTPException(400, { message: '请选择退回节点' });
  }
  // 退回发起人：走 returnStart 链路——实例转 returned，发起人修改后重新提交（任意节点可用，含首个审批节点）
  if (targetNodeKeys.includes(WORKFLOW_RETURN_TO_INITIATOR_KEY)) {
    const overriddenSnapshot = structuredClone(inst.definitionSnapshot);
    const currentNode = overriddenSnapshot.flowData?.nodes.find((n) => n.data.key === task.nodeKey);
    if (currentNode) {
      currentNode.data.rejectStrategy = 'returnStart';
      delete currentNode.data.rejectToNodeKey;
      // 拒绝按钮的跳转配置优先级高于节点策略，须一并清除，避免覆盖本次显式退回目标
      const rejectBtn = (currentNode.data.actionButtons as { reject?: { jumpToNodeKey?: string } } | undefined)?.reject;
      if (rejectBtn?.jumpToNodeKey) delete rejectBtn.jumpToNodeKey;
    }
    const instOverridden = { ...inst, definitionSnapshot: overriddenSnapshot };
    return rejectTaskCore(task, instOverridden, `[退回发起人] ${comment}`, actor, attachments);
  }
  const ancestorKeys = getAncestorNodeKeys(flowData, task.nodeKey);
  const approvedRows = await db.select({ nodeKey: workflowTasks.nodeKey }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, inst.id),
      inArray(workflowTasks.status, ['approved']),
    ));
  const approvedNodeKeys = new Set(approvedRows.map((row) => row.nodeKey));
  const uniqueKeys = Array.from(new Set(targetNodeKeys));
  const targets = uniqueKeys.map((k) => {
    const maybeN = flowData.nodes.find((nd) => nd.data.key === k);
    const n = requireRow(maybeN, `退回目标节点不存在：${k}`, 400);
    if (n.data.type !== 'approve' && n.data.type !== 'handler') {
      throw new HTTPException(400, { message: '只能退回到审批/办理节点' });
    }
    if (!ancestorKeys.has(k) || !approvedNodeKeys.has(k)) {
      throw new HTTPException(400, { message: '只能退回到当前节点之前已通过的审批/办理节点' });
    }
    return n;
  });
  // 多节点退回：选择 flowData.nodes 顺序中最早出现的节点作为实际目标（更贴近用户预期：回到最早分歧点）
  const earliest = targets.reduce((acc, cur) => {
    const accIdx = flowData.nodes.findIndex((n) => n.data.key === acc.data.key);
    const curIdx = flowData.nodes.findIndex((n) => n.data.key === cur.data.key);
    return curIdx < accIdx ? cur : acc;
  }, targets[0]);

  const overriddenSnapshot = structuredClone(inst.definitionSnapshot);
  const currentNode = overriddenSnapshot.flowData?.nodes.find((n) => n.data.key === task.nodeKey);
  if (currentNode) {
    currentNode.data.rejectStrategy = 'returnToNode';
    currentNode.data.rejectToNodeKey = earliest.data.key;
    // 拒绝按钮的跳转配置优先级高于节点策略，须一并清除，避免覆盖本次显式退回目标
    const rejectBtn = (currentNode.data.actionButtons as { reject?: { jumpToNodeKey?: string } } | undefined)?.reject;
    if (rejectBtn?.jumpToNodeKey) delete rejectBtn.jumpToNodeKey;
  }
  const instOverridden = { ...inst, definitionSnapshot: overriddenSnapshot };
  const mergedComment = targets.length > 1
    ? `[退回多节点: ${targets.map((t) => t.data.label ?? t.data.key).join('、')}] ${comment}`
    : comment;
  return rejectTaskCore(task, instOverridden, mergedComment, actor, attachments);
}
