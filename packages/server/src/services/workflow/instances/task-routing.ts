import { workflowTransaction } from '../../../lib/workflow-jobs/lease';
// ─── 任务流转：转办/委派/加签/减签/退回（拆分自 workflow-instances.service.ts）───
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import type { DbExecutor } from '../../../db/types';
import { workflowInstances, workflowTasks, users } from '../../../db/schema';
import { getAncestorNodeKeys } from '../../../lib/workflow-engine';
import { HTTPException } from 'hono/http-exception';
import { buildStarterContext } from '../workflow-assignee-resolver.service';
import { mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize, checkNodeCompletion } from './materialize';
import { emitInstanceEvent, emitNodeEvent, emitTaskEvent, lockInstanceExpecting } from './shared';
import { assertActionButtonEnabled, assertActionUploadRequirement, getOwnPendingTask, rejectTaskCore } from './task-actions';
import type { WorkflowTaskAttachment } from './task-actions';
import { WORKFLOW_RETURN_TO_INITIATOR_KEY } from '@zenith/shared/workflow';
import { loadTaskHandledUserIds, recordTaskTransfer, assertAssigneesNotActiveOnNode } from './transfers';
import logger from '../../../lib/logger';
import { bridgeReportFillWorkflowOutcome } from '../../report/report-fill-workflow-bridge.service';
import { submitReportFillSyncForWorkflowInstance } from '../../report/report-fill-task.service';
import { requireRow } from '../../../lib/db-assert';

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
  const [target] = await db.select({ id: users.id, nickname: users.nickname })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  requireRow(target, '转办人不存在', 400);
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
        attachments: attachments ?? null,
        originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
      })
      .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
      .returning();
    requireRow(row, '任务状态已变化，无法转办', 409);
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
  const [target] = await db.select({ id: users.id, nickname: users.nickname })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  requireRow(target, '委派人不存在', 400);
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
        attachments: attachments ?? null,
        originalAssigneeId: task.originalAssigneeId ?? task.assigneeId ?? null,
        delegatedFromId,
        // 手动委派保持建议制语义：受托人意见回执给原审批人确认（区别于规则委托的 full 直接代批）
        delegationMode: 'suggest',
      })
      .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')))
      .returning();
    requireRow(row, '任务状态已变化，无法委派', 409);
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

/** 加签：在当前节点新增若干同节点 pending 任务（与原任务一并参与节点完成判定） */
export async function addSignTask(
  taskId: number,
  targetUserIds: number[],
  position: 'before' | 'after' | 'parallel',
  comment?: string,
  signMode?: 'and' | 'or',
  attachments?: WorkflowTaskAttachment[],
) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionButtonEnabled(inst, task.nodeKey, 'addSign');
  assertActionUploadRequirement(inst, task.nodeKey, 'addSign', attachments);
  if (targetUserIds.length === 0) throw new HTTPException(400, { message: '请选择加签人' });
  // 与现有同节点任务共用 approveMethod（保证完成判定一致）
  const [sibling] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey)))
    .limit(1);
  // 并行加签可指定会签(and)/或签(or)模式，覆盖本节点完成判定；其余沿用同节点既有方式
  const overrideMethod = position === 'parallel' && signMode ? signMode : null;
  const approveMethod = overrideMethod ?? sibling?.approveMethod ?? 'and';
  const posLabelMap = { before: '前', after: '后', parallel: '并' } as const;
  const posLabel = posLabelMap[position];
  const modeLabel = overrideMethod ? (overrideMethod === 'or' ? '或签' : '会签') : '';
  const addSignSuffix = comment ? `：${comment}` : '';
  const addSignComment = `[加签-${posLabel}${modeLabel}] 由 ${actor.name ?? '系统'} 发起${addSignSuffix}`;

  const created = await workflowTransaction(async (tx) => {
    // 实例行级锁 + 锁内重校验：避免与并发审批（节点已完成/任务被跳过）竞态产生悬挂加签任务
    await lockInstanceExpecting(tx, inst.id, 'running', '流程状态已变化，无法加签');
    const [freshTask] = await tx.select({ status: workflowTasks.status })
      .from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
    if (!freshTask || freshTask.status !== 'pending') {
      throw new HTTPException(409, { message: '任务状态已变化，无法加签' });
    }
    // 加签人已在本节点同轮持有活动任务时给出友好 409（否则撞 wf_tasks_active_uniq 唯一索引）
    await assertAssigneesNotActiveOnNode(tx, {
      instanceId: inst.id, nodeKey: task.nodeKey, activationId: task.activationId,
      userIds: targetUserIds,
    });
    // before：原任务先转为 waiting，加签任务为 pending；待加签人审批通过后由完成回调推进
    // after / parallel：原任务保持 pending，加签任务以 pending 与之并行（共享 approveMethod 判定完成）
    if (position === 'before') {
      await tx.update(workflowTasks).set({ status: 'waiting' }).where(eq(workflowTasks.id, task.id));
    }
    // 并行加签指定会签/或签时，同步本节点全部未结束任务的 approveMethod，保证完成判定一致
    if (overrideMethod) {
      await tx.update(workflowTasks).set({ approveMethod: overrideMethod })
        .where(and(
          eq(workflowTasks.instanceId, inst.id),
          eq(workflowTasks.nodeKey, task.nodeKey),
          inArray(workflowTasks.status, ['pending', 'waiting']),
        ));
    }
    const newRows = await tx.insert(workflowTasks).values(
      targetUserIds.map((uid) => ({
        instanceId: inst.id,
        nodeKey: task.nodeKey,
        nodeName: task.nodeName,
        nodeType: task.nodeType,
        assigneeId: uid,
        status: 'pending' as const,
        comment: addSignComment,
        attachments: attachments ?? null,
        approveMethod,
        // 加签类型专用列：before 挂起原任务的恢复判定依赖它（comment 会被审批/委派回执覆盖，不能作为判定依据）
        signType: position,
        // 加签任务加入目标任务所在激活轮，参与同轮完成判定
        activationId: task.activationId,
      })),
    ).returning();
    return newRows;
  });

  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  for (const t of created) {
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId) emitTaskEvent('task.assigned', mapTask(t), meta);
    emitTaskEvent('task.addSigned', mapTask(t), { ...meta, comment: addSignComment });
  }
  return { created: created.map((t) => mapTask(t)), message: `已加签 ${created.length} 人` };
}

/** 减签：取消同节点上以加签方式创建的其他 pending 任务（仅限加签产生的任务，不能减去原始审批人） */
export async function reduceSignTask(taskId: number, targetTaskIds: number[], comment?: string) {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  assertActionButtonEnabled(inst, task.nodeKey, 'reduceSign');
  if (targetTaskIds.length === 0) throw new HTTPException(400, { message: '请选择要减签的任务' });
  if (targetTaskIds.includes(task.id)) throw new HTTPException(400, { message: '不能减去自己' });

  const targets = await db.select().from(workflowTasks).where(and(
    eq(workflowTasks.instanceId, inst.id),
    eq(workflowTasks.nodeKey, task.nodeKey),
    inArray(workflowTasks.id, targetTaskIds),
  ));
  if (targets.length !== targetTaskIds.length) throw new HTTPException(400, { message: '部分任务不存在或不同节点' });
  for (const t of targets) {
    if (t.status !== 'pending' && t.status !== 'waiting') {
      throw new HTTPException(400, { message: '仅可减签未处理的任务' });
    }
    if (!t.signType) {
      throw new HTTPException(400, { message: '仅可减去加签产生的任务，原始审批人不可移除' });
    }
  }

  const snapshot = inst.definitionSnapshot;
  const flowData = snapshot?.flowData ?? undefined;
  const suffix = comment ? `：${comment}` : '';
  const reduceComment = `[减签] 由 ${actor.name ?? '系统'} 发起${suffix}`;

  const result = await workflowTransaction(async (tx) => {
    // 实例行级锁：序列化与并发审批/驳回，确保减签后的节点完成判定与推进原子一致
    await lockInstanceExpecting(tx, inst.id, 'running', '流程状态已变化，无法减签');
    const updated = await tx.update(workflowTasks).set({
      status: 'skipped',
      actionAt: new Date(),
      comment: reduceComment,
    }).where(and(
      inArray(workflowTasks.id, targetTaskIds),
      eq(workflowTasks.instanceId, inst.id),
      eq(workflowTasks.nodeKey, task.nodeKey),
      inArray(workflowTasks.status, ['pending', 'waiting']),
    )).returning();
    if (updated.length !== targetTaskIds.length) {
      throw new HTTPException(409, { message: '部分任务状态已变化，无法减签' });
    }
    // 复核节点完成状态（例如 ratio 比例会签减签后阈值已达成，需跳过余下任务并推进流程）
    const { completed } = await checkNodeCompletion(tx, inst.id, task.nodeKey, flowData);
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
  });

  if (result.fillBridge?.approved) {
    void submitReportFillSyncForWorkflowInstance(result.row.id).catch((error) => {
      logger.error('[report-fill] enqueue sync task failed', {
        workflowInstanceId: result.row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const { removed, row: instRow } = result;
  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  for (const t of removed) {
    emitTaskEvent('task.skipped', mapTask(t), meta);
    emitTaskEvent('task.reduceSigned', mapTask(t), { ...meta, comment: reduceComment });
  }
  if (result.advanced) {
    emitNodeEvent('node.left', { instanceId: inst.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
    for (const t of result.newTasks) {
      emitNodeEvent('node.entered', { instanceId: inst.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
      emitTaskEvent('task.created', mapTask(t), meta);
      if (t.assigneeId && t.status === 'pending') emitTaskEvent('task.assigned', mapTask(t), meta);
    }
    if (result.finished) emitInstanceEvent('instance.approved', mapInstance(instRow), actor);
    if (result.rejected) emitInstanceEvent('instance.rejected', mapInstance(instRow), actor);
  }
  const advanceNote = result.finished ? '，流程已完成' : (result.advanced ? '，流程已推进' : '');
  return { removed: removed.map((t) => mapTask(t)), message: `已减签 ${removed.length} 人${advanceNote}` };
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
