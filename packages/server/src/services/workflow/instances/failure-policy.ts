// ─── 节点失败策略、Saga 回滚与补偿恢复（拆分自 workflow-instances.service.ts）───
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowJobs, workflowInstances, workflowTasks, workflowTokens, workflowCompensations } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import type { WorkflowFlowData, WorkflowEventActor } from '@zenith/shared';
import { resolveFailurePolicy } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { buildStarterContext } from '../workflow-assignee-resolver.service';
import { recordCompensation, addCompensationLog } from '../workflow-compensations.service';
import type { DbExecutor } from '../../../db/types';
import { enqueueJob } from '../../../lib/workflow-jobs/engine';
import type { WorkflowNodeFailurePolicy } from '@zenith/shared';
import { resolveAdminAssigneeId } from './assignees';
import { findExceptionCatchNode, mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize, killInstanceTokens, loadLiveTokens } from './materialize';
import { emitInstanceEvent, emitNodeEvent, emitTaskEvent } from './shared';
import { bridgeReportFillWorkflowOutcome } from '../../report/report-fill-workflow-bridge.service';

/**
 * Saga 反序回滚：对该实例此前所有已成功副作用节点（trigger/external/webhook），
 * 按执行成功的**倒序**逐个入队其节点配置的 compensation 反向动作，并各生成一条补偿工单。
 * 仅回滚声明了 compensation 的节点；每节点幂等去重。返回入队条数。
 */
async function enqueueSagaRollback(tx: DbExecutor, args: { instanceId: number; failedNodeKey: string; flowData: WorkflowFlowData; tenantId: number | null }): Promise<number> {
  const succeeded = await tx.select({ nodeKey: workflowJobs.nodeKey, jobType: workflowJobs.jobType }).from(workflowJobs)
    .where(and(
      eq(workflowJobs.instanceId, args.instanceId),
      eq(workflowJobs.status, 'succeeded'),
      inArray(workflowJobs.jobType, ['trigger_dispatch', 'external_dispatch', 'webhook_delivery']),
    ))
    .orderBy(desc(workflowJobs.id));
  let count = 0;
  const seen = new Set<string>();
  for (const j of succeeded) {
    if (!j.nodeKey || j.nodeKey === args.failedNodeKey || seen.has(j.nodeKey)) continue;
    seen.add(j.nodeKey);
    const node = args.flowData.nodes.find((n) => n.data.key === j.nodeKey)?.data;
    const comp = resolveFailurePolicy(node)?.compensation;
    if (!comp?.type || comp.type === 'none') continue;
    const compId = await recordCompensation(tx, {
      instanceId: args.instanceId, nodeKey: j.nodeKey, nodeName: node?.label, errorMessage: 'Saga 反序回滚',
      action: 'compensate', status: 'pending', compensationActionStatus: 'pending', failedNodeKey: j.nodeKey, actionPayload: comp, tenantId: args.tenantId,
    });
    await enqueueJob({
      jobType: 'compensation_action',
      payload: { compensationId: compId, instanceId: args.instanceId, nodeKey: j.nodeKey, error: 'saga-rollback', action: comp },
      instanceId: args.instanceId, nodeKey: j.nodeKey, idempotencyKey: `saga:${args.instanceId}:${j.nodeKey}`,
      maxAttempts: (comp.maxRetries ?? 3) + 1, tenantId: args.tenantId,
    }, tx);
    count += 1;
  }
  return count;
}

/** 终局收尾：跳过存量待办（可带注释）→（可选）杀死 token → 实例置 rejected，返回更新后的实例行 */
async function markInstanceRejected(tx: DbExecutor, args: { instanceId: number; comment?: string; killTokens?: boolean; actorId?: number | null }) {
  await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date(), ...(args.comment ? { comment: args.comment } : {}) })
    .where(and(eq(workflowTasks.instanceId, args.instanceId), inArray(workflowTasks.status, ['pending', 'waiting'])));
  if (args.killTokens) await killInstanceTokens(tx, args.instanceId);
  const [row] = await tx.update(workflowInstances).set({ status: 'rejected', currentNodeKey: null })
    .where(eq(workflowInstances.id, args.instanceId)).returning();
  await bridgeReportFillWorkflowOutcome(tx, {
    workflowInstanceId: args.instanceId,
    outcome: 'rejected',
    actorId: args.actorId,
    comment: args.comment,
  });
  return row;
}

/** Token 一致性：消费失败节点 token，并在目标节点新建 frontier token（其余分支 token 保留） */
async function swapFailedTokenTo(tx: DbExecutor, args: { instanceId: number; failedNodeKey: string; targetNodeKey: string; tenantId: number | null }) {
  const liveToks = await loadLiveTokens(tx, args.instanceId);
  const failedTok = liveToks.find((t) => t.nodeKey === args.failedNodeKey);
  if (failedTok) {
    await tx.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() }).where(eq(workflowTokens.id, failedTok.id));
  }
  await tx.insert(workflowTokens).values({
    instanceId: args.instanceId, nodeKey: args.targetNodeKey, status: 'active', branchPath: [],
    parentTokenId: failedTok?.id ?? null, scopeKey: null, tenantId: args.tenantId,
  });
}

/**
 * 统一失败策略执行器（Saga / 补偿，Phase 1 结构 + Phase 2 反向动作）。
 *
 * 相较 legacy 的「异常边 → catchNode」，本函数按失败节点自身的 `failurePolicy` 分流，
 * 不依赖图中存在 catchNode：
 * - continue：忽略失败，越过该节点继续流转
 * - fallback：跳转备用节点（fallbackNodeKey）/ 执行备选动作（fallbackAction，Phase 2）
 * - compensate：执行反向动作（Phase 2）并挂起为待人工确认工单
 * - notify / retry(已耗尽) / 默认：挂起为「待人工修复」工单（指派管理员）
 * - terminate：终止实例
 */
async function applyNodeFailurePolicy(input: {
  instance: typeof workflowInstances.$inferSelect;
  task: typeof workflowTasks.$inferSelect | null;
  nodeKey: string;
  nodeName: string;
  errorMessage: string;
  actor: WorkflowEventActor;
  flowData: WorkflowFlowData;
  policy: WorkflowNodeFailurePolicy;
}): Promise<boolean> {
  const { policy, flowData } = input;
  const errorComment = `[节点异常] ${input.nodeName}：${input.errorMessage}`;

  const updated = await db.transaction(async (tx) => {
    const [lockedInst] = await tx.select().from(workflowInstances)
      .where(eq(workflowInstances.id, input.instance.id)).for('update').limit(1);
    if (!lockedInst || lockedInst.status !== 'running') return null;

    const affectedTasks = input.task
      ? await tx.update(workflowTasks).set({
        status: policy.action === 'terminate' ? 'rejected' : 'skipped',
        comment: errorComment,
        actionAt: new Date(),
      }).where(and(eq(workflowTasks.id, input.task.id), inArray(workflowTasks.status, ['pending', 'waiting']))).returning()
      : [];

    const starter = await buildStarterContext(lockedInst.initiatorId, tx);
    const formData = (lockedInst.formData ?? {}) as Record<string, unknown>;

    // Saga 反序回滚：本节点失败且开启 sagaRollback 时，先对此前已成功副作用倒序补偿
    if (policy.sagaRollback) {
      await enqueueSagaRollback(tx, { instanceId: lockedInst.id, failedNodeKey: input.nodeKey, flowData, tenantId: lockedInst.tenantId });
    }
    const advanceCtx = {
      instanceId: lockedInst.id,
      initiatorId: lockedInst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: lockedInst.tenantId,
    };

    // 将 materialize 结果落库为实例状态
    const settleFromMaterialized = async (
      materialized: Awaited<ReturnType<typeof advanceAndMaterialize>>,
    ) => {
      if (materialized.rejected || (!materialized.finished && materialized.currentNodeKeys.length === 0 && materialized.createdTasks.length === 0)) {
        const row = await markInstanceRejected(tx, { instanceId: lockedInst.id, comment: errorComment, actorId: input.actor.userId });
        return { row, newTasks: materialized.createdTasks, finished: false, rejected: true };
      }
      if (materialized.finished) {
        const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null })
          .where(eq(workflowInstances.id, lockedInst.id)).returning();
        await bridgeReportFillWorkflowOutcome(tx, {
          workflowInstanceId: lockedInst.id,
          outcome: 'approved',
          actorId: input.actor.userId,
          comment: errorComment,
        });
        return { row, newTasks: materialized.createdTasks, finished: true, rejected: false };
      }
      const [row] = await tx.update(workflowInstances).set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
        .where(eq(workflowInstances.id, lockedInst.id)).returning();
      return { row, newTasks: materialized.createdTasks, finished: false, rejected: false };
    };

    // 终止
    if (policy.action === 'terminate') {
      await recordCompensation(tx, { instanceId: lockedInst.id, nodeKey: input.nodeKey, nodeName: input.nodeName, errorMessage: input.errorMessage, action: 'terminate', status: 'terminated', tenantId: lockedInst.tenantId });
      const row = await markInstanceRejected(tx, { instanceId: lockedInst.id, comment: errorComment, killTokens: true, actorId: input.actor.userId });
      return { row, affectedTasks, newTasks: [] as typeof workflowTasks.$inferSelect[], repairTask: null, finished: false, rejected: true };
    }

    // 继续：越过失败节点推进
    if (policy.action === 'continue') {
      await recordCompensation(tx, { instanceId: lockedInst.id, nodeKey: input.nodeKey, nodeName: input.nodeName, errorMessage: input.errorMessage, action: 'continue', status: 'resolved', tenantId: lockedInst.tenantId });
      const materialized = await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: input.nodeKey }, advanceCtx);
      const settled = await settleFromMaterialized(materialized);
      return { ...settled, affectedTasks, repairTask: null };
    }

    // 跳转备用节点
    if (policy.action === 'fallback' && policy.fallbackNodeKey) {
      const target = flowData.nodes.find((n) => n.data.key === policy.fallbackNodeKey);
      if (target) {
        await recordCompensation(tx, { instanceId: lockedInst.id, nodeKey: input.nodeKey, nodeName: input.nodeName, errorMessage: input.errorMessage, action: 'fallback', status: 'resolved', tenantId: lockedInst.tenantId });
        const materialized = await advanceAndMaterialize({ kind: 'enterNode', nodeKey: policy.fallbackNodeKey, consumeNodeKey: input.nodeKey }, advanceCtx);
        const settled = await settleFromMaterialized(materialized);
        return { ...settled, affectedTasks, repairTask: null };
      }
      // 备用节点不存在 → 退化为挂起人工修复
    }

    // 兜底动作（fallback + fallbackAction）：执行备选动作（如通知失败改发短信）后继续流转
    if (policy.action === 'fallback' && policy.fallbackAction) {
      const compId = await recordCompensation(tx, { instanceId: lockedInst.id, nodeKey: input.nodeKey, nodeName: input.nodeName, errorMessage: input.errorMessage, action: 'fallback', status: 'resolved', compensationActionStatus: 'pending', failedNodeKey: input.nodeKey, actionPayload: policy.fallbackAction, tenantId: lockedInst.tenantId });
      await enqueueJob({ jobType: 'compensation_action', payload: { compensationId: compId, instanceId: lockedInst.id, nodeKey: input.nodeKey, error: input.errorMessage, action: policy.fallbackAction }, instanceId: lockedInst.id, nodeKey: input.nodeKey, idempotencyKey: `compaction:${compId}`, maxAttempts: (policy.fallbackAction.maxRetries ?? 3) + 1, tenantId: lockedInst.tenantId }, tx);
      const materialized = await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: input.nodeKey }, advanceCtx);
      const settled = await settleFromMaterialized(materialized);
      return { ...settled, affectedTasks, repairTask: null };
    }

    // notify / compensate / retry(耗尽) / 默认 → 挂起为待人工修复工单；compensate 额外入队反向动作 job
    const ticketAction = policy.action === 'compensate' ? 'compensate' : policy.action === 'fallback' ? 'fallback' : 'notify';
    const compensationCfg = policy.action === 'compensate' ? policy.compensation : undefined;
    const adminId = await resolveAdminAssigneeId(tx);
    if (!adminId) {
      await recordCompensation(tx, { instanceId: lockedInst.id, nodeKey: input.nodeKey, nodeName: input.nodeName, errorMessage: `${input.errorMessage}；未找到管理员`, action: ticketAction, status: 'terminated', tenantId: lockedInst.tenantId });
      const row = await markInstanceRejected(tx, { instanceId: lockedInst.id, comment: errorComment, killTokens: true, actorId: input.actor.userId });
      return { row, affectedTasks, newTasks: [] as typeof workflowTasks.$inferSelect[], repairTask: null, finished: false, rejected: true };
    }
    const compId = await recordCompensation(tx, {
      instanceId: lockedInst.id, nodeKey: input.nodeKey, nodeName: input.nodeName, errorMessage: input.errorMessage,
      action: ticketAction, status: 'pending',
      compensationActionStatus: compensationCfg ? 'pending' : 'none',
      failedNodeKey: input.nodeKey,
      actionPayload: compensationCfg ?? null,
      tenantId: lockedInst.tenantId,
    });
    if (compensationCfg) {
      await enqueueJob({ jobType: 'compensation_action', payload: { compensationId: compId, instanceId: lockedInst.id, nodeKey: input.nodeKey, error: input.errorMessage, action: compensationCfg }, instanceId: lockedInst.id, nodeKey: input.nodeKey, idempotencyKey: `compaction:${compId}`, maxAttempts: (compensationCfg.maxRetries ?? 3) + 1, tenantId: lockedInst.tenantId }, tx);
    }
    const [repairTask] = await tx.insert(workflowTasks).values({
      instanceId: lockedInst.id,
      nodeKey: input.nodeKey,
      nodeName: `${input.nodeName}（待修复）`,
      nodeType: 'catchNode',
      assigneeId: adminId,
      status: 'pending',
      comment: errorComment,
    }).returning();
    // Token 一致性：消费失败节点 token，在同一节点新建 frontier token（其余分支保留）
    await swapFailedTokenTo(tx, { instanceId: lockedInst.id, failedNodeKey: input.nodeKey, targetNodeKey: input.nodeKey, tenantId: lockedInst.tenantId });
    const [row] = await tx.update(workflowInstances).set({ currentNodeKey: input.nodeKey })
      .where(eq(workflowInstances.id, lockedInst.id)).returning();
    return { row, affectedTasks, newTasks: [repairTask], repairTask, finished: false, rejected: false };
  });

  if (!updated) return true;
  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor: input.actor };
  for (const task of updated.affectedTasks) {
    emitTaskEvent(task.status === 'rejected' ? 'task.rejected' : 'task.skipped', mapTask(task), { ...meta, comment: errorComment });
  }
  emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: input.nodeKey, nodeName: input.nodeName, nodeType: input.task?.nodeType ?? null });
  for (const task of updated.newTasks) {
    emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
    emitTaskEvent('task.created', mapTask(task), meta);
    if (task.assigneeId && task.status === 'pending') emitTaskEvent('task.assigned', mapTask(task), meta);
    if (task.status === 'approved') emitTaskEvent('task.approved', mapTask(task), meta);
    if (task.status === 'rejected') emitTaskEvent('task.rejected', mapTask(task), meta);
  }
  if (updated.finished) emitInstanceEvent('instance.approved', mapInstance(updated.row), input.actor);
  if (updated.rejected) emitInstanceEvent('instance.rejected', mapInstance(updated.row), input.actor);
  return true;
}

/**
 * 恢复后继续推进：补偿完成后，把挂起的实例从失败节点继续向下推进。
 * 关闭失败节点上的待修复待办 → 消费其 token 并越过该节点 materialize → 工单置 resolved + 记录 resume 日志。
 */
export async function resumeInstanceForCompensation(id: number): Promise<{ resumed: boolean }> {
  const tc = tenantCondition(workflowCompensations, currentUser());
  const conds = [eq(workflowCompensations.id, id)];
  if (tc) conds.push(tc);
  const [ticket] = await db.select().from(workflowCompensations).where(and(...conds)).limit(1);
  if (!ticket) throw new HTTPException(404, { message: '补偿工单不存在' });
  if (ticket.status !== 'pending') throw new HTTPException(400, { message: '工单已处理' });
  const failedNodeKey = ticket.failedNodeKey ?? ticket.nodeKey;
  const cu = currentUser();
  const actor: WorkflowEventActor = { userId: cu?.userId ?? 0, name: cu?.username ?? 'system:resume' };

  const updated = await db.transaction(async (tx) => {
    const [inst] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, ticket.instanceId)).for('update').limit(1);
    if (!inst || inst.status !== 'running') throw new HTTPException(400, { message: '实例不在运行中，无法恢复' });
    const flowData = inst.definitionSnapshot?.flowData;
    if (!flowData) throw new HTTPException(400, { message: '实例定义快照缺失，无法恢复' });

    await tx.update(workflowTasks).set({ status: 'approved', actionAt: new Date(), comment: '补偿完成，恢复推进' })
      .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, failedNodeKey), eq(workflowTasks.status, 'pending')));

    const starter = await buildStarterContext(inst.initiatorId, tx);
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const materialized = await advanceAndMaterialize({ kind: 'advanceNode', nodeKey: failedNodeKey }, {
      instanceId: inst.id, initiatorId: inst.initiatorId, executor: tx, flowData, formData, settings: flowData.settings, starter, tenantId: inst.tenantId,
    });

    let row: typeof workflowInstances.$inferSelect;
    if (materialized.rejected || (!materialized.finished && materialized.currentNodeKeys.length === 0 && materialized.createdTasks.length === 0)) {
      row = await markInstanceRejected(tx, { instanceId: inst.id });
    } else if (materialized.finished) {
      [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      await bridgeReportFillWorkflowOutcome(tx, {
        workflowInstanceId: inst.id,
        outcome: 'approved',
        actorId: currentUser().userId,
        comment: '补偿完成，恢复推进',
      });
    } else {
      [row] = await tx.update(workflowInstances).set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null }).where(eq(workflowInstances.id, inst.id)).returning();
    }

    await tx.update(workflowCompensations)
      .set({ status: 'resolved', resolution: '恢复并继续推进', resolvedBy: cu?.userId ?? null, resolvedAt: new Date() })
      .where(eq(workflowCompensations.id, id));
    await addCompensationLog(tx, { compensationId: id, action: 'resume', note: '恢复并继续推进', operatorId: cu?.userId ?? null, tenantId: ticket.tenantId });
    return { row, newTasks: materialized.createdTasks, finished: materialized.finished, rejected: materialized.rejected };
  });

  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor };
  for (const task of updated.newTasks) {
    emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
    emitTaskEvent('task.created', mapTask(task), meta);
    if (task.assigneeId && task.status === 'pending') emitTaskEvent('task.assigned', mapTask(task), meta);
  }
  if (updated.finished) emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
  if (updated.rejected) emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
  return { resumed: true };
}

export async function handleNodeExecutionError(input: {
  instance: typeof workflowInstances.$inferSelect;
  task?: typeof workflowTasks.$inferSelect | null;
  nodeKey: string;
  nodeName?: string | null;
  errorMessage: string;
  actor: WorkflowEventActor;
}): Promise<boolean> {
  const snapshot = input.instance.definitionSnapshot;
  const flowData = snapshot?.flowData;
  if (!flowData) return false;

  // 统一失败策略（Saga/补偿）优先：节点显式配置 failurePolicy（或 legacy trigger.onFailure 可映射）时走新分流；
  // 否则回退到既有「异常边 → catchNode」路径，保证旧流程完全兼容。
  const failingNode = flowData.nodes.find((n) => n.data.key === input.nodeKey)?.data ?? null;
  const policy = resolveFailurePolicy(failingNode);
  if (policy) {
    return applyNodeFailurePolicy({
      instance: input.instance,
      task: input.task ?? null,
      nodeKey: input.nodeKey,
      nodeName: input.nodeName ?? failingNode?.label ?? input.nodeKey,
      errorMessage: input.errorMessage,
      actor: input.actor,
      flowData,
      policy,
    });
  }

  const catchCfg = findExceptionCatchNode(flowData, input.nodeKey);
  if (!catchCfg) return false;

  const action = catchCfg.catchAction ?? 'notify';
  const errorComment = `[节点异常] ${input.nodeName ?? input.nodeKey}：${input.errorMessage}`;
  const updated = await db.transaction(async (tx) => {
    const [lockedInst] = await tx.select().from(workflowInstances)
      .where(eq(workflowInstances.id, input.instance.id))
      .for('update')
      .limit(1);
    if (!lockedInst || lockedInst.status !== 'running') return null;
    await recordCompensation(tx, { instanceId: lockedInst.id, nodeKey: catchCfg.key, nodeName: catchCfg.label, errorMessage: input.errorMessage, action, status: action === 'toAdmin' ? 'pending' : action === 'terminate' ? 'terminated' : 'resolved', tenantId: lockedInst.tenantId });

    const affectedTasks = input.task
      ? await tx.update(workflowTasks).set({
        status: action === 'terminate' ? 'rejected' : 'skipped',
        comment: errorComment,
        actionAt: new Date(),
      }).where(and(eq(workflowTasks.id, input.task.id), inArray(workflowTasks.status, ['pending', 'waiting']))).returning()
      : [];

    if (action === 'terminate') {
      const [catchTask] = await tx.insert(workflowTasks).values({
        instanceId: lockedInst.id,
        nodeKey: catchCfg.key,
        nodeName: catchCfg.label,
        nodeType: 'catchNode',
        assigneeId: null,
        status: 'rejected',
        comment: errorComment,
        actionAt: new Date(),
      }).returning();
      const row = await markInstanceRejected(tx, { instanceId: lockedInst.id, comment: errorComment, killTokens: true, actorId: input.actor.userId });
      return { row, affectedTasks, catchTask, newTasks: [] as typeof workflowTasks.$inferSelect[], finished: false, rejected: true };
    }

    if (action === 'toAdmin') {
      const adminId = await resolveAdminAssigneeId(tx);
      if (!adminId) {
        const [catchTask] = await tx.insert(workflowTasks).values({
          instanceId: lockedInst.id,
          nodeKey: catchCfg.key,
          nodeName: catchCfg.label,
          nodeType: 'catchNode',
          assigneeId: null,
          status: 'rejected',
          comment: `${errorComment}；未找到管理员`,
          actionAt: new Date(),
        }).returning();
        const row = await markInstanceRejected(tx, { instanceId: lockedInst.id, comment: errorComment, killTokens: true, actorId: input.actor.userId });
        return { row, affectedTasks, catchTask, newTasks: [] as typeof workflowTasks.$inferSelect[], finished: false, rejected: true };
      }
      const [catchTask] = await tx.insert(workflowTasks).values({
        instanceId: lockedInst.id,
        nodeKey: catchCfg.key,
        nodeName: catchCfg.label,
        nodeType: 'catchNode',
        assigneeId: adminId,
        status: 'pending',
        comment: errorComment,
      }).returning();
      // Token 一致性：消费失败节点 token，在 catch 节点新建 frontier token（其余分支 token 保留）
      await swapFailedTokenTo(tx, { instanceId: lockedInst.id, failedNodeKey: input.nodeKey, targetNodeKey: catchCfg.key, tenantId: lockedInst.tenantId });
      const [row] = await tx.update(workflowInstances)
        .set({ currentNodeKey: catchCfg.key })
        .where(eq(workflowInstances.id, lockedInst.id))
        .returning();
      return { row, affectedTasks, catchTask, newTasks: [catchTask], finished: false, rejected: false };
    }

    const [catchTask] = await tx.insert(workflowTasks).values({
      instanceId: lockedInst.id,
      nodeKey: catchCfg.key,
      nodeName: catchCfg.label,
      nodeType: 'catchNode',
      assigneeId: null,
      status: 'approved',
      comment: errorComment,
      actionAt: new Date(),
    }).returning();
    const formData = (lockedInst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(lockedInst.initiatorId, tx);
    const materialized = await advanceAndMaterialize(
      { kind: 'enterNode', nodeKey: catchCfg.key, consumeNodeKey: input.nodeKey },
      {
        instanceId: lockedInst.id,
        initiatorId: lockedInst.initiatorId,
        executor: tx,
        flowData,
        formData,
        settings: flowData.settings,
        starter,
        tenantId: lockedInst.tenantId,
      },
    );

    if (materialized.rejected || (!materialized.finished && materialized.currentNodeKeys.length === 0 && materialized.createdTasks.length === 0)) {
      const row = await markInstanceRejected(tx, { instanceId: lockedInst.id, comment: errorComment, actorId: input.actor.userId });
      return { row, affectedTasks, catchTask, newTasks: materialized.createdTasks, finished: false, rejected: true };
    }
    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'approved', currentNodeKey: null })
        .where(eq(workflowInstances.id, lockedInst.id))
        .returning();
      await bridgeReportFillWorkflowOutcome(tx, {
        workflowInstanceId: lockedInst.id,
        outcome: 'approved',
        actorId: input.actor.userId,
        comment: errorComment,
      });
      return { row, affectedTasks, catchTask, newTasks: materialized.createdTasks, finished: true, rejected: false };
    }
    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, lockedInst.id))
      .returning();
    return { row, affectedTasks, catchTask, newTasks: materialized.createdTasks, finished: false, rejected: false };
  });

  if (!updated) return true;
  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor: input.actor };
  for (const task of updated.affectedTasks) {
    emitTaskEvent(task.status === 'rejected' ? 'task.rejected' : 'task.skipped', mapTask(task), { ...meta, comment: errorComment });
  }
  emitNodeEvent('node.left', {
    instanceId: updated.row.id,
    ...meta,
    nodeKey: input.nodeKey,
    nodeName: input.nodeName ?? input.nodeKey,
    nodeType: input.task?.nodeType ?? null,
  });
  emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: updated.catchTask.nodeKey, nodeName: updated.catchTask.nodeName, nodeType: updated.catchTask.nodeType });
  emitTaskEvent('task.created', mapTask(updated.catchTask), meta);
  if (updated.catchTask.assigneeId && updated.catchTask.status === 'pending') emitTaskEvent('task.assigned', mapTask(updated.catchTask), meta);
  if (updated.catchTask.status === 'approved') emitTaskEvent('task.approved', mapTask(updated.catchTask), meta);
  if (updated.catchTask.status === 'rejected') emitTaskEvent('task.rejected', mapTask(updated.catchTask), meta);

  for (const task of updated.newTasks.filter((task) => task.id !== updated.catchTask.id)) {
    emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
    emitTaskEvent('task.created', mapTask(task), meta);
    if (task.assigneeId && task.status === 'pending') emitTaskEvent('task.assigned', mapTask(task), meta);
    if (task.status === 'approved') emitTaskEvent('task.approved', mapTask(task), meta);
    if (task.status === 'rejected') emitTaskEvent('task.rejected', mapTask(task), meta);
  }
  if (updated.finished) emitInstanceEvent('instance.approved', mapInstance(updated.row), input.actor);
  if (updated.rejected) emitInstanceEvent('instance.rejected', mapInstance(updated.row), input.actor);
  return true;
}
