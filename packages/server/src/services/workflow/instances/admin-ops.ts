// ─── 管理员强制操作与令牌运维恢复（拆分自 workflow-instances.service.ts）───
import { eq, and, asc, lte, inArray, gt } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowJobs, workflowTasks, workflowTokens, workflowDefinitions, workflowDelegations, users } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import type { WorkflowFlowData, WorkflowHandoverPreview, WorkflowHandoverResult, WorkflowRecoveryBatchResult } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { buildStarterContext } from '../workflow-assignee-resolver.service';
import logger from '../../../lib/logger';
import { emitInstanceStartEvents } from './lifecycle';
import { mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize, killInstanceTokens } from './materialize';
import { getInstanceDetail } from './queries';
import { emitInstanceEvent, emitNodeEvent, emitTaskEvent } from './shared';

/** 强制跳转：终止当前活动任务，直接推进到指定审批/办理节点 */
export async function jumpInstance(id: number, targetNodeKey: string, comment?: string) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅审批中的流程可强制跳转' });
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程数据异常' });
  const targetNode = flowData.nodes.find((n) => n.data.key === targetNodeKey);
  if (!targetNode) throw new HTTPException(400, { message: '目标节点不存在' });
  if (targetNode.data.type !== 'approve' && targetNode.data.type !== 'handler') {
    throw new HTTPException(400, { message: '只能强制跳转到审批/办理节点' });
  }
  const formData = (inst.formData ?? {}) as Record<string, unknown>;
  const starter = await buildStarterContext(inst.initiatorId);
  const note = `[管理员强制跳转至「${targetNode.data.label}」]${comment ? ' ' + comment : ''}`;
  const instance = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, id)).for('update').limit(1);
    if (!locked || locked.status !== 'running') {
      throw new HTTPException(409, { message: '流程状态已变化，无法跳转' });
    }
    await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: note })
      .where(and(eq(workflowTasks.instanceId, id), inArray(workflowTasks.status, ['pending', 'waiting'])));
    await killInstanceTokens(tx, id);
    const materialized = await advanceAndMaterialize({ kind: 'enterNode', nodeKey: targetNode.data.key }, {
      instanceId: id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });
    const [updatedInstance] = await tx.update(workflowInstances).set({
      status: materialized.rejected ? 'rejected' : (materialized.finished ? 'approved' : 'running'),
      currentNodeKey: materialized.rejected || materialized.finished ? null : (materialized.currentNodeKeys[0] ?? targetNode.data.key),
    }).where(eq(workflowInstances.id, id)).returning();
    await emitInstanceStartEvents(mapInstance(updatedInstance), updatedInstance, materialized.createdTasks, { userId: user.userId, name: user.username }, tx);
    return updatedInstance;
  });
  return mapInstance(instance);
}

/** 挂起时冻结计时的作业类型（SLA 超时 / 延迟唤醒暂停计时，恢复后按剩余时长续跑） */const SUSPEND_FREEZE_JOB_TYPES = ['task_timeout', 'delay_wake'] as const;
/** 冻结哨兵时间：挂起期间计时作业 runAt 推至远期，杜绝被 Worker 领取 */
const SUSPEND_FREEZE_RUN_AT = new Date('2200-01-01T00:00:00Z');
/** payload 中记录剩余毫秒数的键（恢复时据此重排 runAt） */
const SUSPEND_REMAINING_KEY = 'suspendRemainingMs';

/** 挂起实例：冻结待办操作与计时作业，用于争议冻结/外部故障排查（仅 running 可挂起） */
export async function suspendInstance(id: number, reason: string) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅审批中的流程可挂起' });

  const instance = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, id)).for('update').limit(1);
    if (!locked || locked.status !== 'running') {
      throw new HTTPException(409, { message: '流程状态已变化，无法挂起' });
    }
    const now = new Date();
    // 冻结计时作业：payload 记录剩余时长，runAt 推远期（暂停计时而非恢复即超时）
    const jobs = await tx.select({ id: workflowJobs.id, runAt: workflowJobs.runAt, payload: workflowJobs.payload })
      .from(workflowJobs)
      .where(and(
        eq(workflowJobs.instanceId, id),
        eq(workflowJobs.status, 'pending'),
        inArray(workflowJobs.jobType, [...SUSPEND_FREEZE_JOB_TYPES]),
      ));
    for (const job of jobs) {
      const remainingMs = Math.max(0, job.runAt.getTime() - now.getTime());
      await tx.update(workflowJobs)
        .set({ runAt: SUSPEND_FREEZE_RUN_AT, payload: { ...(job.payload as Record<string, unknown>), [SUSPEND_REMAINING_KEY]: remainingMs } })
        .where(and(eq(workflowJobs.id, job.id), eq(workflowJobs.status, 'pending')));
    }
    const [updated] = await tx.update(workflowInstances)
      .set({ status: 'suspended', suspendedAt: now, suspendReason: reason })
      .where(eq(workflowInstances.id, id)).returning();
    return updated;
  });
  logger.info('workflow instance suspended', { instanceId: id, operator: user.userId, reason });
  return mapInstance(instance);
}

/** 恢复挂起实例：计时作业按挂起前剩余时长重排后继续流转 */
export async function resumeInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, id)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status !== 'suspended') throw new HTTPException(400, { message: '仅已挂起的流程可恢复' });

  const instance = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, id)).for('update').limit(1);
    if (!locked || locked.status !== 'suspended') {
      throw new HTTPException(409, { message: '流程状态已变化，无法恢复' });
    }
    const now = new Date();
    const jobs = await tx.select({ id: workflowJobs.id, payload: workflowJobs.payload })
      .from(workflowJobs)
      .where(and(
        eq(workflowJobs.instanceId, id),
        eq(workflowJobs.status, 'pending'),
        inArray(workflowJobs.jobType, [...SUSPEND_FREEZE_JOB_TYPES]),
      ));
    for (const job of jobs) {
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      const remaining = Number(payload[SUSPEND_REMAINING_KEY]);
      if (!Number.isFinite(remaining)) continue; // 非挂起冻结的作业不动
      const rest = { ...payload };
      delete rest[SUSPEND_REMAINING_KEY];
      await tx.update(workflowJobs)
        .set({ runAt: new Date(now.getTime() + Math.max(0, remaining)), payload: rest })
        .where(and(eq(workflowJobs.id, job.id), eq(workflowJobs.status, 'pending')));
    }
    const [updated] = await tx.update(workflowInstances)
      .set({ status: 'running', suspendedAt: null, suspendReason: null })
      .where(eq(workflowInstances.id, id)).returning();
    return updated;
  });
  logger.info('workflow instance resumed', { instanceId: id, operator: user.userId });
  return mapInstance(instance);
}

/** 管理员改派：将未处理任务的处理人替换为指定用户 */export async function reassignTask(taskId: number, targetUserId: number, comment?: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在' });
  if (task.status !== 'pending' && task.status !== 'waiting') {
    throw new HTTPException(400, { message: '仅未处理的任务可改派' });
  }
  const [tgt] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!tgt) throw new HTTPException(400, { message: '目标处理人不存在' });
  const tc = tenantCondition(workflowInstances, user);
  const instConditions = [eq(workflowInstances.id, task.instanceId)];
  if (tc) instConditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...instConditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  const chain = Array.isArray(task.transferChain) ? task.transferChain : [];
  const note = `[管理员改派]${comment ? ' ' + comment : ''}`;
  const [updated] = await db.update(workflowTasks).set({
    assigneeId: targetUserId,
    delegatedFromId: null,
    transferChain: [...new Set([...chain, task.assigneeId].filter((v): v is number => v != null))],
    comment: note,
  }).where(and(eq(workflowTasks.id, taskId), inArray(workflowTasks.status, ['pending', 'waiting']))).returning();
  if (!updated) throw new HTTPException(409, { message: '任务状态已变化，无法改派' });
  const actor = { userId: user.userId, name: user.username };
  emitTaskEvent('task.transferred', mapTask(updated), { definitionId: inst.definitionId, tenantId: inst.tenantId, actor });
  return mapTask(updated);
}

/** 审批人撤回刚做的通过/驳回：要求后续节点均未被处理，流程仍可回退 */
export async function recallTask(taskId: number, comment?: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在' });
  if (task.assigneeId !== user.userId) throw new HTTPException(403, { message: '只能撤回自己处理的任务' });
  if (task.status !== 'approved' && task.status !== 'rejected') {
    throw new HTTPException(400, { message: '只有已处理的任务可撤回' });
  }
  const tc = tenantCondition(workflowInstances, user);
  const instConditions = [eq(workflowInstances.id, task.instanceId)];
  if (tc) instConditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...instConditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (inst.status === 'withdrawn' || inst.status === 'cancelled' || inst.status === 'approved' || inst.status === 'rejected') {
    throw new HTTPException(400, { message: '流程已结束，无法撤回' });
  }
  // 本任务之后创建的任务：若已有被处理（approved/rejected）的，则不允许撤回
  const laterTasks = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, task.instanceId), gt(workflowTasks.id, task.id)));
  const actionedLater = laterTasks.filter((t) => t.status === 'approved' || t.status === 'rejected');
  if (actionedLater.length > 0) {
    throw new HTTPException(400, { message: '后续节点已被处理，无法撤回' });
  }

  const reopened = await db.transaction(async (tx) => {
    // 实例行级锁 + 锁内重校验：防止与并发审批/驳回竞态（撤回时后续任务正被处理）
    const [lockedInst] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).for('update').limit(1);
    if (!lockedInst || lockedInst.status === 'withdrawn' || lockedInst.status === 'cancelled' || lockedInst.status === 'approved' || lockedInst.status === 'rejected') {
      throw new HTTPException(400, { message: '流程已结束，无法撤回' });
    }
    const [freshTask] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
    if (!freshTask || (freshTask.status !== 'approved' && freshTask.status !== 'rejected')) {
      throw new HTTPException(409, { message: '任务状态已变化，无法撤回' });
    }
    const laterInTx = await tx.select().from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, task.instanceId), gt(workflowTasks.id, task.id)));
    if (laterInTx.some((t) => t.status === 'approved' || t.status === 'rejected')) {
      throw new HTTPException(400, { message: '后续节点已被处理，无法撤回' });
    }
    if (laterInTx.length > 0) {
      await tx.delete(workflowTasks).where(and(eq(workflowTasks.instanceId, task.instanceId), gt(workflowTasks.id, task.id)));
    }
    const [row] = await tx.update(workflowTasks).set({
      status: 'pending',
      comment: comment ? `[撤回重审] ${comment}` : null,
      signature: null,
      actionAt: null,
    }).where(eq(workflowTasks.id, task.id)).returning();
    await tx.update(workflowInstances).set({ status: 'running', currentNodeKey: task.nodeKey }).where(eq(workflowInstances.id, task.instanceId));
    // Token 一致性：撤回重审清场后，在被重开节点重建单一 active token（后续路径 token 已随删除/清场失效）
    await killInstanceTokens(tx, task.instanceId);
    await tx.insert(workflowTokens).values({
      instanceId: task.instanceId,
      nodeKey: task.nodeKey,
      status: 'active',
      branchPath: [],
      parentTokenId: null,
      tenantId: inst.tenantId,
    });
    return row;
  });

  const actor = { userId: user.userId, name: user.username };
  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  emitTaskEvent('task.created', mapTask(reopened), meta);
  if (reopened.assigneeId) emitTaskEvent('task.assigned', mapTask(reopened), meta);
  return getInstanceDetail(task.instanceId);
}

/** 加载指定 Token 及其所属实例（含租户校验），供运营恢复操作复用 */
async function loadTokenForOps(tokenId: number) {
  const user = currentUser();
  const [tok] = await db.select().from(workflowTokens).where(eq(workflowTokens.id, tokenId)).limit(1);
  if (!tok) throw new HTTPException(404, { message: '执行 Token 不存在' });
  const tc = tenantCondition(workflowInstances, user);
  const conds = [eq(workflowInstances.id, tok.instanceId)];
  if (tc) conds.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conds)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '实例不存在或无权操作' });
  return { user, tok, inst };
}

/**
 * 跳过卡死的执行 Token：消费该 Token、跳过其节点未结束任务，并从该节点推进流程。
 * 用于等待节点（trigger / subProcess / external）派发失败卡死等场景的外科式修复。
 */
export async function skipStuckToken(tokenId: number, reason?: string) {
  const { user, tok, inst } = await loadTokenForOps(tokenId);
  if (tok.status !== 'active') throw new HTTPException(400, { message: '仅活动 Token 可跳过' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅运行中实例可操作' });
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  const nodeCfg = flowData.nodes.find((n) => n.data.key === tok.nodeKey)?.data;
  const nodeName = nodeCfg?.label ?? tok.nodeKey;
  const note = `[运营·跳过卡死 Token #${tokenId}]${reason ? ' ' + reason : ''}`;

  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: workflowInstances.status }).from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!locked || locked.status !== 'running') throw new HTTPException(409, { message: '实例状态已变化，请刷新后重试' });
    await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), comment: note })
      .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, tok.nodeKey), inArray(workflowTasks.status, ['pending', 'waiting'])));
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    const materialized = await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: tok.nodeKey }, {
      instanceId: inst.id, initiatorId: inst.initiatorId, executor: tx, flowData, formData, settings: flowData.settings, starter, tenantId: inst.tenantId,
    });
    let status: 'running' | 'approved' | 'rejected' = 'running';
    if (materialized.rejected) {
      status = 'rejected';
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
    } else if (materialized.finished) {
      status = 'approved';
    }
    const [row] = await tx.update(workflowInstances).set({
      status, currentNodeKey: status === 'running' ? (materialized.currentNodeKeys[0] ?? null) : null,
    }).where(eq(workflowInstances.id, inst.id)).returning();
    return { row, newTasks: materialized.createdTasks, status };
  });

  const actor = { userId: user.userId, name: user.username };
  const meta = { definitionId: result.row.definitionId, tenantId: result.row.tenantId, actor };
  emitNodeEvent('node.left', { instanceId: result.row.id, ...meta, nodeKey: tok.nodeKey, nodeName, nodeType: nodeCfg?.type ?? null });
  for (const t of result.newTasks) {
    emitNodeEvent('node.entered', { instanceId: result.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId && t.status === 'pending') emitTaskEvent('task.assigned', mapTask(t), meta);
  }
  if (result.status === 'approved') emitInstanceEvent('instance.approved', mapInstance(result.row), actor);
  if (result.status === 'rejected') emitInstanceEvent('instance.rejected', mapInstance(result.row), actor);
  return getInstanceDetail(inst.id);
}

/**
 * 从指定 Token 的节点重放流程：清场全部活动 Token + 在该节点重建执行路径
 * （等价强制跳转到该 Token 所在节点，支持从历史/已消费 Token 处重跑；目标须为审批/办理节点）。
 */
export async function replayFromToken(tokenId: number, reason?: string) {
  const { tok, inst } = await loadTokenForOps(tokenId);
  if (inst.status !== 'running') throw new HTTPException(400, { message: '仅运行中实例可重放' });
  return jumpInstance(inst.id, tok.nodeKey, `[运营·从 Token #${tokenId} 重放]${reason ? ' ' + reason : ''}`);
}

const BATCH_RECOVERY_CAP = 200;

/**
 * 批量推进卡在指定节点的运行中实例：找出该流程定义下停在 nodeKey 的活动 Token，逐个 skipStuckToken 推进。
 * 用于某节点配置错误 / 外部派发失败导致多实例集体卡死时的批量外科恢复（按候选逐个隔离，单个失败不影响其它）。
 */
export async function batchSkipStuckTokens(input: { definitionId: number; nodeKey: string; olderThanMinutes?: number; reason?: string }): Promise<WorkflowRecoveryBatchResult> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conds = [
    eq(workflowTokens.status, 'active'),
    eq(workflowTokens.nodeKey, input.nodeKey),
    eq(workflowInstances.status, 'running'),
    eq(workflowInstances.definitionId, input.definitionId),
  ];
  if (tc) conds.push(tc);
  if (input.olderThanMinutes && input.olderThanMinutes > 0) {
    conds.push(lte(workflowTokens.createdAt, new Date(Date.now() - input.olderThanMinutes * 60_000)));
  }
  const rows = await db.select({ tokenId: workflowTokens.id })
    .from(workflowTokens)
    .innerJoin(workflowInstances, eq(workflowTokens.instanceId, workflowInstances.id))
    .where(and(...conds))
    .orderBy(asc(workflowTokens.id))
    .limit(BATCH_RECOVERY_CAP);
  let success = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await skipStuckToken(r.tokenId, input.reason ?? '批量推进卡死实例');
      success += 1;
    } catch (err) {
      failed += 1;
      logger.warn('[workflow-recovery] 批量跳过卡死 Token 失败', { tokenId: r.tokenId, err });
    }
  }
  return { total: rows.length, success, failed };
}

// ─── 离职交接：把某人名下未处理审批事务批量移交接手人 ─────────────────────────────

/** 离职交接影响范围预览（不落库） */
export async function previewHandover(fromUserId: number): Promise<WorkflowHandoverPreview> {
  const user = currentUser();
  const [from] = await db.select({ id: users.id, nickname: users.nickname, username: users.username })
    .from(users).where(eq(users.id, fromUserId)).limit(1);
  if (!from) throw new HTTPException(404, { message: '交接人不存在' });

  const tc = tenantCondition(workflowInstances, user);
  const taskConds = [
    eq(workflowTasks.assigneeId, fromUserId),
    inArray(workflowTasks.status, ['pending', 'waiting']),
    inArray(workflowInstances.status, ['running', 'suspended']),
  ];
  if (tc) taskConds.push(tc);
  const tasks = await db.select({ id: workflowTasks.id, status: workflowTasks.status })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(and(...taskConds));

  const delegations = await db.select({ id: workflowDelegations.id }).from(workflowDelegations)
    .where(and(eq(workflowDelegations.principalId, fromUserId), eq(workflowDelegations.enabled, true)));

  // 检测报告：已发布定义中把该用户写死为「指定成员」审批人的节点（仅提示，不自动改定义）
  const defTc = tenantCondition(workflowDefinitions, user);
  const defConds = [eq(workflowDefinitions.status, 'published')];
  if (defTc) defConds.push(defTc);
  const defs = await db.select({ id: workflowDefinitions.id, name: workflowDefinitions.name, flowData: workflowDefinitions.flowData })
    .from(workflowDefinitions).where(and(...defConds));
  const affectedDefinitions: WorkflowHandoverPreview['affectedDefinitions'] = [];
  for (const def of defs) {
    const flow = def.flowData as WorkflowFlowData | null;
    if (!flow?.nodes) continue;
    const nodes = flow.nodes.filter((n) => {
      const d = n.data;
      if (d.assigneeType !== 'user') return false;
      const ids = [d.assigneeId, ...(d.assigneeIds ?? []), ...(d.userIds ?? [])].filter((v): v is number => typeof v === 'number');
      return ids.includes(fromUserId);
    });
    if (nodes.length > 0) {
      affectedDefinitions.push({ id: def.id, name: def.name, nodeNames: nodes.map((n) => n.data.label || n.data.key) });
    }
  }

  return {
    fromUserName: from.nickname || from.username,
    pendingTaskCount: tasks.filter((t) => t.status === 'pending').length,
    waitingTaskCount: tasks.filter((t) => t.status === 'waiting').length,
    delegationCount: delegations.length,
    affectedDefinitions,
  };
}

/** 执行离职交接：逐条改派待办（互不阻断）+ 可选停用其审批代理规则 */
export async function handoverTasks(input: { fromUserId: number; toUserId: number; disableDelegations?: boolean; comment?: string }): Promise<WorkflowHandoverResult> {
  const user = currentUser();
  const { fromUserId, toUserId, disableDelegations = true, comment } = input;
  if (fromUserId === toUserId) throw new HTTPException(400, { message: '接手人不能与交接人相同' });
  const [tgt] = await db.select({ id: users.id }).from(users).where(eq(users.id, toUserId)).limit(1);
  if (!tgt) throw new HTTPException(400, { message: '接手人不存在' });

  const tc = tenantCondition(workflowInstances, user);
  const taskConds = [
    eq(workflowTasks.assigneeId, fromUserId),
    inArray(workflowTasks.status, ['pending', 'waiting']),
    inArray(workflowInstances.status, ['running', 'suspended']),
  ];
  if (tc) taskConds.push(tc);
  const tasks = await db.select({ id: workflowTasks.id, nodeName: workflowTasks.nodeName, title: workflowInstances.title })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(and(...taskConds))
    .orderBy(asc(workflowTasks.id));

  const note = `[离职交接]${comment ? ' ' + comment : ''}`;
  const results: WorkflowHandoverResult['results'] = [];
  let succeeded = 0;
  // 逐条小事务改派：单条失败不阻断其余，完整复用改派的转办链/事件/通知链路
  for (const t of tasks) {
    try {
      await reassignTask(t.id, toUserId, note);
      succeeded += 1;
      results.push({ taskId: t.id, title: t.title, nodeName: t.nodeName, success: true });
    } catch (err) {
      const message = err instanceof HTTPException ? err.message : '改派失败';
      results.push({ taskId: t.id, title: t.title, nodeName: t.nodeName, success: false, message });
      logger.warn('workflow handover reassign failed', { taskId: t.id, fromUserId, toUserId, err });
    }
  }

  let delegationsDisabled = 0;
  if (disableDelegations) {
    const disabled = await db.update(workflowDelegations).set({ enabled: false })
      .where(and(eq(workflowDelegations.principalId, fromUserId), eq(workflowDelegations.enabled, true)))
      .returning({ id: workflowDelegations.id });
    delegationsDisabled = disabled.length;
  }

  logger.info('workflow handover done', { fromUserId, toUserId, total: tasks.length, succeeded, delegationsDisabled, operator: user.userId });
  return { taskTotal: tasks.length, succeeded, failed: tasks.length - succeeded, delegationsDisabled, results };
}
