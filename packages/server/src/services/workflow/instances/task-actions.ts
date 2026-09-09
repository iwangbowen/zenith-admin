import { workflowTransaction } from '../../../lib/workflow-jobs/lease';
// ─── 审批动作核心：同意/拒绝（含回调与动作按钮校验）（拆分自 workflow-instances.service.ts）───
import { eq, and, desc, or, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowTasks, users } from '../../../db/schema';
import { findReturnPrevTarget } from '../../../lib/workflow-engine';
import type { WorkflowEventActor, WorkflowActionButtonKey, WorkflowActionButtonConfig, WorkflowNodeConfig } from '@zenith/shared/workflow';
import { findNextApproverSelectNodes, resolveNodeFieldPermissions, sanitizeFormUpdatesByNodePerms } from '@zenith/shared/workflow';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { buildStarterContext, searchSelectableApprovers } from '../workflow-assignee-resolver.service';
import type { WorkflowSelectableNextApproverGroup, WorkflowSelectableNextApproversQueryInput } from '@zenith/shared/workflow';
import logger from '../../../lib/logger';
import { cancelJobs, WORKFLOW_ADVANCING_JOB_TYPES } from '../../../lib/workflow-jobs/engine';
import { enqueueSubprocessJoin } from './async-jobs';
import { assertSelectedNextApprovers } from './initiator-select';
import { mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize, checkNodeCompletion, filterCurrentActivation, killInstanceTokens } from './materialize';
import type { MaterializeTrigger } from './materialize';
import { emitInstanceEvent, emitNodeEvent, emitTaskEvent, emitTasksEnteredEvents, lockInstanceExpecting } from './shared';
import { hasUserHandledTask } from './transfers';
import { bridgeReportFillWorkflowOutcome } from '../../report/report-fill-workflow-bridge.service';
import { submitReportFillSyncForWorkflowInstance } from '../../report/report-fill-task.service';
import type { DbExecutor } from '../../../db/types';
import { requireRow } from '../../../lib/db-assert';

export type WorkflowTaskAttachment = { name: string; url: string; size?: number };

/** 委托人显示名（full 代批留痕用）：昵称优先，查不到退化为 user#id */
async function findUserDisplayName(userId: number): Promise<string> {
  const [row] = await db.select({ nickname: users.nickname, username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.nickname ?? row?.username ?? `user#${userId}`;
}

/** 读取节点「操作按钮设置」中指定按钮的配置 */
function resolveNodeActionButton(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
  key: WorkflowActionButtonKey,
): WorkflowActionButtonConfig | undefined {
  const flowData = inst.definitionSnapshot?.flowData;
  const nodeCfg = flowData?.nodes.find((n) => n.data.key === nodeKey)?.data;
  const buttons = nodeCfg?.actionButtons as Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | undefined;
  return buttons?.[key];
}

/** 各动作按钮的默认启用态（与前端 WorkflowApprovalDetailSheet 的 DEFAULT_BUTTONS 保持一致） */
const DEFAULT_BUTTON_ENABLED: Record<WorkflowActionButtonKey, boolean> = {
  approve: true,
  reject: true,
  transfer: false,
  delegate: false,
  addSign: false,
  reduceSign: false,
  return: false,
};

/**
 * 服务端强制「操作按钮设置」的启用态：未启用的动作即使绕过前端直接调 API 也一律拒绝。
 * 仅约束用户入口（approveTask/rejectTask/transferTask 等）；系统路径（超时自动通过、
 * 外部回调、管理员改派）走 Core/admin 函数不受限。
 */
export function assertActionButtonEnabled(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
  key: WorkflowActionButtonKey,
): void {
  const btn = resolveNodeActionButton(inst, nodeKey, key);
  const enabled = btn?.enabled ?? DEFAULT_BUTTON_ENABLED[key];
  if (!enabled) throw new HTTPException(403, { message: '当前节点未启用该操作' });
}

/** 校验「操作按钮设置」中某动作的附件必填要求（uploadMode === 'required'） */
export function assertActionUploadRequirement(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
  key: WorkflowActionButtonKey,
  attachments?: WorkflowTaskAttachment[],
) {
  const btn = resolveNodeActionButton(inst, nodeKey, key);
  if (btn?.uploadMode === 'required' && (!attachments || attachments.length === 0)) {
    throw new HTTPException(400, { message: '请上传附件后再提交' });
  }
}

export interface ApproveResult {
  instance: ReturnType<typeof mapInstance>;
  message: string;
}

/**
 * 列出「我作为当前审批人」时，紧邻的下一审批节点中需要我为其选人的 approverSelect 节点及候选人。
 * 候选人已按各节点 selectScope（成员/角色/部门/用户组）在服务端解析收窄；每组最多 `limit` 人，
 * 超出即标记 `truncated`，前端按组带 `nodeKey` + `keyword` 再来搜索；无下游 approverSelect 时返回空数组。
 */
export async function listTaskSelectableNextApprovers(
  taskId: number,
  query: WorkflowSelectableNextApproversQueryInput = { limit: 50 },
): Promise<WorkflowSelectableNextApproverGroup[]> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks)
    .where(eq(workflowTasks.id, taskId))
    .limit(1);
  requireRow(task, '任务不存在或无权操作');
  if (task.assigneeId !== user.userId) {
    // 任务已转办/委派给他人：曾经手的用户返回空组而非 404（审批面板关闭前的缓存刷新会重取本查询）
    const wasMine = task.originalAssigneeId === user.userId
      || task.delegatedFromId === user.userId
      || await hasUserHandledTask(task.id, user.userId);
    if (!wasMine) throw new HTTPException(404, { message: '任务不存在或无权操作' });
    return [];
  }
  // 已处理（同意/拒绝/退回等）的任务无需再选下一审批人：返回空组而非 404，
  // 避免审批成功后前端 invalidateQueries 立即重取本查询时误报「任务不存在或无权操作」
  if (task.status !== 'pending') return [];
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  requireRow(inst, '流程实例不存在');
  const flowData = inst.definitionSnapshot?.flowData;
  if (!flowData) return [];
  const nodes = findNextApproverSelectNodes(flowData, task.nodeKey)
    .filter((node) => !query.nodeKey || node.data.key === query.nodeKey);
  return Promise.all(nodes.map(async (node) => {
    const { items, truncated } = await searchSelectableApprovers(node.data, { keyword: query.keyword, limit: query.limit });
    return {
      nodeKey: node.data.key,
      label: node.data.label || node.data.key,
      selectableApprovers: items,
      truncated,
    };
  }));
}

export async function approveTask(taskId: number, comment?: string, attachments?: Array<{ name: string; url: string; size?: number }>, selectedNextApprovers?: Record<string, number[]>, signature?: string, formUpdates?: Record<string, unknown>): Promise<ApproveResult> {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  // 校验"操作按钮设置"：通过按钮须启用 + 附件必填（uploadMode === 'required'）
  const flowData = inst.definitionSnapshot?.flowData;
  const nodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  assertActionButtonEnabled(inst, task.nodeKey, 'approve');
  assertActionUploadRequirement(inst, task.nodeKey, 'approve', attachments);
  if (flowData) {
    await assertSelectedNextApprovers(flowData, task.nodeKey, selectedNextApprovers, db);
  }
  if (nodeCfg?.operations?.includes('opinionRequired') && !comment?.trim()) {
    throw new HTTPException(400, { message: '请填写审批意见后再提交' });
  }
  if (nodeCfg?.operations?.includes('signature') && !signature?.trim()) {
    throw new HTTPException(400, { message: '该节点要求手写签名，请先完成签名' });
  }
  // 委派任务：suggest（建议制）由代理人操作时生成回执给委托人确认；full（默认）代理人直接代批，comment 留痕
  if (task.delegatedFromId && task.delegatedFromId !== actor.userId) {
    if (task.delegationMode === 'suggest') {
      return processDelegatedReceipt(task, inst, 'approved', comment, actor, attachments, formUpdates);
    }
    const principalName = await findUserDisplayName(task.delegatedFromId);
    const decorated = `[代 ${principalName} 审批] ${comment ?? ''}`.trim();
    return approveTaskCore(task, inst, decorated, actor, { selectedNextApprovers, signature, attachments, formUpdates });
  }
  return approveTaskCore(task, inst, comment, actor, { selectedNextApprovers, signature, attachments, formUpdates });
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并审批通过 */
export async function approveTaskByCallback(callbackId: string, comment: string | undefined, approverName: string): Promise<ApproveResult> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  requireRow(task, '回调任务不存在');
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (task.status === 'approved') {
    return { instance: mapInstance(inst), message: '回调已处理' };
  }
  if (task.status !== 'waiting') throw new HTTPException(409, { message: '回调任务已处理' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: inst.status === 'suspended' ? '流程已挂起，暂不可处理' : '流程实例不在进行中' });
  try {
    return await approveTaskCore(task, inst, comment, { userId: 0, name: `external:${approverName}` });
  } catch (err) {
    if (err instanceof HTTPException && err.status === 409) {
      const [freshTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
      const [freshInst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
      if (freshTask?.status === 'approved' && freshInst) {
        return { instance: mapInstance(freshInst), message: '回调已处理' };
      }
    }
    throw err;
  }
}

// ─── 审批 / 驳回共享阶段函数（拆分自 approveTaskCore / rejectTaskCore，行为不变）───

type InstanceRow = typeof workflowInstances.$inferSelect;
type TaskRow = typeof workflowTasks.$inferSelect;
type FillBridgeResult = Awaited<ReturnType<typeof bridgeReportFillWorkflowOutcome>>;

/** 事务内落定实例终态：可选清理余下待办 / 终止 token，更新实例状态并触发报表填报桥接 */
async function settleInstanceInTx(
  tx: DbExecutor,
  instanceId: number,
  opts: {
    outcome: 'approved' | 'rejected';
    actorId: number;
    comment?: string | null;
    /** 清理实例余下 pending/waiting 任务（如并行其它分支待办），保证终态实例无残留待办 */
    skipRemaining?: boolean;
    /** 终止所有 active token（驳回终止场景） */
    killTokens?: boolean;
  },
): Promise<{ row: InstanceRow; fillBridge: FillBridgeResult }> {
  if (opts.skipRemaining) {
    await tx.update(workflowTasks)
      .set({ status: 'skipped', actionAt: new Date(), comment: opts.outcome === 'rejected' ? '[流程驳回] 流程已被驳回终止，本待办作废' : '[流程结束] 流程已结束，本待办作废' })
      .where(and(eq(workflowTasks.instanceId, instanceId), inArray(workflowTasks.status, ['pending', 'waiting'])));
  }
  if (opts.killTokens) await killInstanceTokens(tx, instanceId);
  // 终态清场：取消仍在途的推进类作业（延时唤醒/超时/触发器/外部派发/子流程），避免作业苏醒后推进已终结实例
  await cancelJobs({ instanceId, jobTypes: WORKFLOW_ADVANCING_JOB_TYPES }, tx);
  const [row] = await tx.update(workflowInstances)
    .set({ status: opts.outcome, currentNodeKey: null })
    .where(eq(workflowInstances.id, instanceId))
    .returning();
  const fillBridge = await bridgeReportFillWorkflowOutcome(tx, {
    workflowInstanceId: instanceId,
    outcome: opts.outcome,
    actorId: opts.actorId,
    comment: opts.comment ?? null,
  });
  return { row, fillBridge };
}


/** 子实例进入终态时唤醒父流程 join 作业 */
function notifySubprocessParent(row: InstanceRow): void {
  if (!row.parentTaskId) return;
  void enqueueSubprocessJoin(row).catch((err) => {
    logger.error('[subProcess] resume parent failed', { childId: row.id, err });
  });
}

/** 报表填报桥接确认通过后，异步补发同步任务 */
function scheduleReportFillSync(fillBridge: FillBridgeResult | null, instanceId: number): void {
  if (!fillBridge?.approved) return;
  void submitReportFillSyncForWorkflowInstance(instanceId).catch((error) => {
    logger.error('[report-fill] enqueue sync task failed', {
      workflowInstanceId: instanceId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function approveTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string | undefined,
  actor: WorkflowEventActor,
  options?: { selectedNextApprovers?: Record<string, number[]>; signature?: string; attachments?: Array<{ name: string; url: string; size?: number }>; formUpdates?: Record<string, unknown> },
): Promise<ApproveResult> {
  const taskId = task.id;
  const snapshot = inst.definitionSnapshot;
  const flowData = snapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });

  const updated = await workflowTransaction(async (tx) => {
    const res = await (async () => {
    // 实例行级锁：序列化同一实例上的并发审批，避免会签末位并发各自读不到对方已审批而都不推进（节点卡死）
    const [lockedInst] = await tx.select({ status: workflowInstances.status, formData: workflowInstances.formData })
      .from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!lockedInst || lockedInst.status !== 'running') {
      throw new HTTPException(409, { message: '流程实例状态已变化，请刷新后重试' });
    }
    // 乐观并发保护：仅当任务仍处于读取时的状态才能推进，防止并发重复审批导致流程重复前进
    const [approvedTask] = await tx.update(workflowTasks).set({
      status: 'approved',
      comment: comment ?? null,
      signature: options?.signature ?? null,
      attachments: options?.attachments ?? null,
      actionAt: new Date(),
    }).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.status, task.status))).returning();
    requireRow(approvedTask, '任务已被处理，请刷新后重试', 409);

    // 审批人「可编辑」字段写回：按节点 fieldPermissions 白名单过滤后合并进实例 formData，
    // 在会签早退（节点未推进）时同样持久化，后续推进与分支条件均使用合并后的数据
    const baseFormData = (lockedInst.formData ?? inst.formData ?? {}) as Record<string, unknown>;
    const sanitizedUpdates = sanitizeFormUpdatesByNodePerms(
      resolveNodeFieldPermissions(flowData, task.nodeKey),
      options?.formUpdates,
    );
    const hasFormUpdates = Object.keys(sanitizedUpdates).length > 0;
    const mergedFormData = hasFormUpdates ? { ...baseFormData, ...sanitizedUpdates } : baseFormData;
    if (hasFormUpdates) {
      await tx.update(workflowInstances).set({ formData: mergedFormData }).where(eq(workflowInstances.id, inst.id));
    }

    // 检查当前节点是否已足够推进（会签/或签/顺序会签）
    const { completed } = await checkNodeCompletion(tx, inst.id, task.nodeKey, flowData);
    if (!completed) {
      const [row] = await tx.update(workflowInstances)
        .set({ currentNodeKey: task.nodeKey })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, finished: false, rejected: false, advanced: false, approvedTask, newTasks: [] as typeof workflowTasks.$inferSelect[], fillBridge: null };
    }

    const formData = mergedFormData;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    // 退回模式 backToOrigin：被退回任务通过后，直接跳回发起退回的来源节点（而非继续后续路径）
    const originCfg = task.returnOriginNodeKey
      ? flowData.nodes.find((n) => n.data.key === task.returnOriginNodeKey)?.data
      : undefined;
    const advTrigger: MaterializeTrigger = (originCfg && (originCfg.type === 'approve' || originCfg.type === 'handler'))
      ? { kind: 'enterNode', nodeKey: originCfg.key, consumeNodeKey: task.nodeKey }
      : { kind: 'advanceNode', nodeKey: task.nodeKey };
    const materialized = await advanceAndMaterialize(advTrigger, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      selectedNextApprovers: options?.selectedNextApprovers,
      starter,
      tenantId: inst.tenantId,
    });

    if (materialized.rejected) {
      // 下游自动拒绝终止流程
      const settled = await settleInstanceInTx(tx, inst.id, {
        outcome: 'rejected', actorId: actor.userId, comment: '工作流自动拒绝', skipRemaining: true,
      });
      return { row: settled.row, finished: false, rejected: true, advanced: true, approvedTask, newTasks: materialized.createdTasks, fillBridge: settled.fillBridge };
    }

    if (materialized.finished) {
      const settled = await settleInstanceInTx(tx, inst.id, {
        outcome: 'approved', actorId: actor.userId, comment: comment ?? null,
      });
      return { row: settled.row, finished: true, rejected: false, advanced: true, approvedTask, newTasks: materialized.createdTasks, fillBridge: settled.fillBridge };
    }

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, finished: false, rejected: false, advanced: true, approvedTask, newTasks: materialized.createdTasks, fillBridge: null };
    })();

    // 事务性 outbox：审批事件与状态变更在同一事务内入队原子提交（提交后崩溃不丢事件）
    const meta = { definitionId: res.row.definitionId, tenantId: res.row.tenantId, actor };
    await emitTaskEvent('task.approved', mapTask(res.approvedTask), { ...meta, comment }, tx);
    if (res.advanced) {
      await emitNodeEvent('node.left', { instanceId: res.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType }, tx);
    }
    await emitTasksEnteredEvents(res.row.id, res.newTasks, meta, tx);
    if (res.finished) await emitInstanceEvent('instance.approved', mapInstance(res.row), actor, tx);
    if (res.rejected) await emitInstanceEvent('instance.rejected', mapInstance(res.row), actor, tx);
    return res;
  });

  scheduleReportFillSync(updated.fillBridge, updated.row.id);
  if (updated.finished || updated.rejected) notifySubprocessParent(updated.row);

  let message: string;
  if (updated.rejected) {
    message = '审批通过，后续自动拒绝节点已终止流程';
  } else if (updated.finished) {
    message = '审批通过，流程已完成';
  } else if (updated.advanced) {
    message = '审批通过，流程已推进';
  } else {
    message = '审批通过，等待其他审批人处理';
  }
  return {
    instance: mapInstance(updated.row),
    message,
  };
}

export async function rejectTask(taskId: number, comment: string, attachments?: WorkflowTaskAttachment[]): Promise<ApproveResult> {
  const { task, inst, actor } = await getOwnPendingTask(taskId);
  if (!comment.trim()) throw new HTTPException(400, { message: '请填写拒绝原因' });
  assertActionButtonEnabled(inst, task.nodeKey, 'reject');
  assertActionUploadRequirement(inst, task.nodeKey, 'reject', attachments);
  if (task.delegatedFromId && task.delegatedFromId !== actor.userId) {
    if (task.delegationMode === 'suggest') {
      return processDelegatedReceipt(task, inst, 'rejected', comment, actor, attachments);
    }
    const principalName = await findUserDisplayName(task.delegatedFromId);
    return rejectTaskCore(task, inst, `[代 ${principalName} 审批] ${comment}`, actor, attachments);
  }
  return rejectTaskCore(task, inst, comment, actor, attachments);
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并驳回 */
export async function rejectTaskByCallback(callbackId: string, comment: string, approverName: string) {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  requireRow(task, '回调任务不存在');
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (task.status === 'rejected') {
    return { instance: mapInstance(inst), message: '回调已处理' };
  }
  if (task.status !== 'waiting') throw new HTTPException(409, { message: '回调任务已处理' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: inst.status === 'suspended' ? '流程已挂起，暂不可处理' : '流程实例不在进行中' });
  try {
    return await rejectTaskCore(task, inst, comment, { userId: 0, name: `external:${approverName}` });
  } catch (err) {
    if (err instanceof HTTPException && err.status === 409) {
      const [freshTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
      const [freshInst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
      if (freshTask?.status === 'rejected' && freshInst) {
        return { instance: mapInstance(freshInst), message: '回调已处理' };
      }
    }
    throw err;
  }
}

type RejectRouteStrategy = 'terminate' | 'returnPrev' | 'returnStart' | 'returnToNode';

/**
 * 解析驳回路由：优先「操作按钮设置」中拒绝按钮的跳转配置，其次节点驳回策略；
 * returnPrev 按审批时间倒序在已通过的 approve/handler 节点中找最近上游祖先。
 */
async function resolveRejectRoute(
  task: TaskRow,
  inst: InstanceRow,
): Promise<{ strategy: RejectRouteStrategy; targetNodeKey: string | null; currentNodeCfg: WorkflowNodeConfig | undefined }> {
  const flowData = inst.definitionSnapshot?.flowData;
  const currentNodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  const actionRejectJump = (currentNodeCfg?.actionButtons as { reject?: { jumpToNodeKey?: string } } | undefined)?.reject?.jumpToNodeKey;
  let strategy: RejectRouteStrategy = currentNodeCfg?.rejectStrategy ?? 'terminate';
  let rejectToNodeKey: string | undefined = currentNodeCfg?.rejectToNodeKey;
  if (actionRejectJump) {
    strategy = 'returnToNode';
    rejectToNodeKey = actionRejectJump;
  }

  let targetNodeKey: string | null = null;
  if (strategy !== 'terminate' && flowData) {
    if (strategy === 'returnToNode') {
      if (rejectToNodeKey && flowData.nodes.some((n) => n.data.key === rejectToNodeKey)) {
        targetNodeKey = rejectToNodeKey;
      }
    } else if (strategy === 'returnPrev') {
      // 找已 approved 的 approve/handler 任务节点，按审批时间倒序
      const prevApproved = await db.select().from(workflowTasks)
        .where(and(
          eq(workflowTasks.instanceId, inst.id),
          eq(workflowTasks.status, 'approved'),
        ))
        .orderBy(desc(workflowTasks.actionAt), desc(workflowTasks.id));
      const approvedApproveKeys = prevApproved
        .filter((t) => {
          const cfg = flowData.nodes.find((n) => n.data.key === t.nodeKey)?.data;
          return cfg && (cfg.type === 'approve' || cfg.type === 'handler');
        })
        .map((t) => t.nodeKey);
      // 优先退回到当前节点的最近上游祖先，避免并行流程误选到另一分支上最近审批的节点
      targetNodeKey = findReturnPrevTarget(flowData, task.nodeKey, approvedApproveKeys);
    } else if (strategy === 'returnStart') {
      // 从头重新走流程（重新生成首批任务）
      targetNodeKey = '__start__';
    }
  }
  return { strategy, targetNodeKey, currentNodeCfg };
}

/**
 * 比例会签部分驳回判定：本任务驳回后若通过阈值仍可达成，节点保持活动。
 * 必须在实例行级锁内基于最新状态判定，避免并发驳回都不触发整节点驳回而使节点卡死。
 */
async function keepRatioNodeAliveAfterReject(
  tx: DbExecutor,
  instanceId: number,
  nodeKey: string,
): Promise<boolean> {
  const allRows = await tx.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeKey, nodeKey)));
  // 只统计当前激活轮，历史轮任务不参与阈值分母；前加签任务是前置关卡、excluded 是运行时排除留痕行，同样不参与（与 checkNodeCompletion 口径一致）
  const ratioSiblings = filterCurrentActivation(allRows).filter((t) => t.signType !== 'before' && t.signType !== 'excluded');
  const ratioPct = ratioSiblings.find((t) => t.approveRatio)?.approveRatio ?? 51;
  const required = Math.ceil(ratioSiblings.length * ratioPct / 100);
  const maxPossibleApproved = ratioSiblings
    .filter((t) => t.status === 'approved' || t.status === 'pending' || t.status === 'waiting')
    .length;
  return maxPossibleApproved >= required;
}

export async function rejectTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string,
  actor: WorkflowEventActor,
  attachments?: WorkflowTaskAttachment[],
): Promise<ApproveResult> {
  const taskId = task.id;
  const flowData = inst.definitionSnapshot?.flowData;
  const { strategy, targetNodeKey, currentNodeCfg } = await resolveRejectRoute(task, inst);

  const updated = await workflowTransaction(async (tx) => {
    const res = await (async () => {
    // 实例行级锁：序列化同一实例上的并发审批/驳回，避免与并发审批互相覆盖推进
    await lockInstanceExpecting(tx, inst.id, 'running', '流程实例状态已变化，请刷新后重试');
    // 当前任务 → rejected（乐观并发保护：状态变更则中止，防止并发重复驳回）
    const [rejectedTask] = await tx.update(workflowTasks)
      .set({ status: 'rejected', comment, attachments: attachments ?? null, actionAt: new Date() })
      .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.status, task.status)))
      .returning();
    requireRow(rejectedTask, '任务已被处理，请刷新后重试', 409);

    // 比例会签：本任务驳回后若阈值仍可达成，仅记录该任务驳回、节点保持活动。
    if (rejectedTask.approveMethod === 'ratio' && await keepRatioNodeAliveAfterReject(tx, inst.id, task.nodeKey)) {
      return {
        row: inst,
        terminated: false as const,
        finished: false as const,
        partial: true as const,
        rejectedTask,
        skippedTasks: [] as typeof workflowTasks.$inferSelect[],
        newTasks: [] as typeof workflowTasks.$inferSelect[],
        fillBridge: null,
      };
    }

    // 同节点其他 pending / waiting 任务跳过
    const skipped = await tx.update(workflowTasks)
      .set({ status: 'skipped', actionAt: new Date(), comment: '[同节点联动] 本节点已有审批人拒绝，其余待办作废' })
      .where(and(
        eq(workflowTasks.instanceId, inst.id),
        eq(workflowTasks.nodeKey, task.nodeKey),
        or(eq(workflowTasks.status, 'pending'), eq(workflowTasks.status, 'waiting')),
      ))
      .returning();

    // 终止：实例置为 rejected
    if (strategy === 'terminate' || !targetNodeKey || !flowData) {
      const settled = await settleInstanceInTx(tx, inst.id, {
        outcome: 'rejected', actorId: actor.userId, comment, killTokens: true,
      });
      return { row: settled.row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[], fillBridge: settled.fillBridge };
    }

    // 回退：在目标节点重新生成任务；returnStart 例外——实例交还发起人（returned），由发起人修改后重新提交
    if (strategy === 'returnStart') {
      // 退回发起人：清场**全实例**活动任务、token 与在途推进作业，实例进入 returned 状态等待发起人修改重提，
      // 不再从头重新物化任务（那会立即生成新一轮审批任务，发起人没有任何修改入口）。
      // 上方的同节点跳过覆盖不到并行分支等其它节点的待办——若不在此补齐，重提后新旧两轮任务并存，
      // 旧任务的 token 已被清理，再处理会抛「缺少执行 Token」且实例永久卡死
      const crossNodeSkipped = await tx.update(workflowTasks)
        .set({ status: 'skipped', actionAt: new Date(), comment: '[退回发起人] 流程退回修改，本待办作废' })
        .where(and(
          eq(workflowTasks.instanceId, inst.id),
          inArray(workflowTasks.status, ['pending', 'waiting']),
        ))
        .returning();
      await killInstanceTokens(tx, inst.id);
      await cancelJobs({ instanceId: inst.id, jobTypes: WORKFLOW_ADVANCING_JOB_TYPES }, tx);
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'returned', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: false, finished: false, returned: true, rejectedTask, skippedTasks: [...skipped, ...crossNodeSkipped], newTasks: [] as typeof workflowTasks.$inferSelect[], fillBridge: null };
    }

    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    let returnTrigger: MaterializeTrigger | null = null;
    const targetCfg = flowData.nodes.find((n) => n.data.key === targetNodeKey)?.data;
    if (targetCfg && (targetCfg.type === 'approve' || targetCfg.type === 'handler')) {
      returnTrigger = { kind: 'enterNode', nodeKey: targetCfg.key };
    }

    if (!returnTrigger) {
      const settled = await settleInstanceInTx(tx, inst.id, {
        outcome: 'rejected', actorId: actor.userId, comment, killTokens: true,
      });
      return { row: settled.row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[], fillBridge: settled.fillBridge };
    }

    // 回退前清场：终止所有 active token，避免旧并行分支残留 token 影响重建路径的汇聚判定
    await killInstanceTokens(tx, inst.id);
    const materialized = await advanceAndMaterialize(returnTrigger, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      flowData,
      formData,
      settings: flowData.settings,
      starter,
      tenantId: inst.tenantId,
    });

    // 退回模式 backToOrigin：给目标节点新任务打上来源节点标记，通过后直接跳回本节点
    if ((strategy === 'returnPrev' || strategy === 'returnToNode')
      && currentNodeCfg?.returnMode === 'backToOrigin' && targetNodeKey) {
      const ids = materialized.createdTasks.filter((t) => t.nodeKey === targetNodeKey).map((t) => t.id);
      if (ids.length > 0) {
        await tx.update(workflowTasks).set({ returnOriginNodeKey: task.nodeKey }).where(inArray(workflowTasks.id, ids));
      }
    }

    if (materialized.rejected) {
      // 下游自动拒绝终止流程
      const settled = await settleInstanceInTx(tx, inst.id, {
        outcome: 'rejected', actorId: actor.userId, comment, skipRemaining: true,
      });
      return { row: settled.row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks, fillBridge: settled.fillBridge };
    }

    if (materialized.finished) {
      const settled = await settleInstanceInTx(tx, inst.id, {
        outcome: 'approved', actorId: actor.userId, comment,
      });
      return { row: settled.row, terminated: false, finished: true, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks, fillBridge: settled.fillBridge };
    }

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, terminated: false, finished: false, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks, fillBridge: null };
    })();

    // 事务性 outbox：驳回事件与状态变更在同一事务内入队原子提交（提交后崩溃不丢事件）
    const meta = { definitionId: res.row.definitionId, tenantId: res.row.tenantId, actor };
    await emitTaskEvent('task.rejected', mapTask(res.rejectedTask), { ...meta, comment }, tx);
    // 比例会签部分驳回：节点仍活动，仅记录该任务驳回，不发节点离开 / 实例状态事件
    if (!(res as { partial?: boolean }).partial) {
      for (const t of res.skippedTasks) {
        await emitTaskEvent('task.skipped', mapTask(t), meta, tx);
      }
      await emitNodeEvent('node.left', { instanceId: res.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType }, tx);
      if (res.terminated) {
        await emitInstanceEvent('instance.rejected', mapInstance(res.row), actor, tx);
      } else if ((res as { returned?: boolean }).returned) {
        await emitInstanceEvent('instance.returned', mapInstance(res.row), actor, tx);
      } else {
        await emitTasksEnteredEvents(res.row.id, res.newTasks, meta, tx);
        if (res.finished) await emitInstanceEvent('instance.approved', mapInstance(res.row), actor, tx);
      }
    }
    return res;
  });

  scheduleReportFillSync(updated.fillBridge, updated.row.id);
  if ((updated as { partial?: boolean }).partial) {
    return { instance: mapInstance(updated.row), message: '已驳回' };
  }
  if (updated.terminated || updated.finished) {
    notifySubprocessParent(updated.row);
  }
  if ((updated as { returned?: boolean }).returned) {
    return { instance: mapInstance(updated.row), message: '已驳回，申请已退回发起人修改' };
  }

  return { instance: mapInstance(updated.row), message: '已驳回' };
}

/** 通用：获取当前用户名下的 pending 任务 + 实例（含校验） */
export async function getOwnPendingTask(taskId: number) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);
  requireRow(task, '任务不存在或无权操作');
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances)
    .where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: inst.status === 'suspended' ? '流程已挂起，暂不可处理' : '流程实例不在进行中' });
  return { task, inst, actor: { userId: user.userId, name: user.username } };
}

/** 委派回执：当委派人对任务做出反馈（同意/拒绝）时，原委派人接手并继续审批 */
async function processDelegatedReceipt(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  action: 'approved' | 'rejected',
  comment: string | undefined,
  actor: WorkflowEventActor,
  attachments?: Array<{ name: string; url: string; size?: number }>,
  formUpdates?: Record<string, unknown>,
): Promise<ApproveResult> {
  const delegatorId = task.delegatedFromId;
  if (!delegatorId) throw new HTTPException(500, { message: '委派回执缺失原始审批人' });
  const verb = action === 'approved' ? '同意' : '拒绝';
  const tail = comment ? `：${comment}` : '';
  const receiptComment = `[委派回执] ${actor.name ?? '系统'} 建议${verb}${tail}`;

  const result = await workflowTransaction(async (tx) => {
    const [closedTask] = await tx.update(workflowTasks).set({
      status: action,
      comment: receiptComment,
      attachments: attachments ?? null,
      actionAt: new Date(),
    }).where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, task.status))).returning();
    requireRow(closedTask, '任务已被处理，请刷新后重试', 409);
    // 委派人同样是节点合法处理人：其「可编辑」字段修改按同一白名单合并进实例表单
    const receiptFlow = inst.definitionSnapshot?.flowData;
    const sanitizedUpdates = sanitizeFormUpdatesByNodePerms(
      resolveNodeFieldPermissions(receiptFlow, task.nodeKey),
      formUpdates,
    );
    if (Object.keys(sanitizedUpdates).length > 0) {
      const [locked] = await tx.select({ formData: workflowInstances.formData })
        .from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
      const base = (locked?.formData ?? inst.formData ?? {}) as Record<string, unknown>;
      await tx.update(workflowInstances).set({ formData: { ...base, ...sanitizedUpdates } }).where(eq(workflowInstances.id, inst.id));
    }
    // 委派人已在本节点同轮持有其它活动任务（如同时被加签/会签同节点）时不再重建回执任务，
    // 其既有任务即可承接后续确认——重复建行会撞 wf_tasks_active_uniq 唯一索引
    const [delegatorActive] = await tx.select({ id: workflowTasks.id }).from(workflowTasks)
      .where(and(
        eq(workflowTasks.instanceId, task.instanceId),
        eq(workflowTasks.nodeKey, task.nodeKey),
        eq(workflowTasks.activationId, task.activationId),
        eq(workflowTasks.assigneeId, delegatorId),
        inArray(workflowTasks.status, ['pending', 'waiting']),
      )).limit(1);
    if (delegatorActive) {
      return { closedTask, newTask: null };
    }
    const [newTask] = await tx.insert(workflowTasks).values({
      instanceId: task.instanceId,
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType,
      assigneeId: delegatorId,
      status: 'pending',
      taskOrder: task.taskOrder,
      approveMethod: task.approveMethod,
      approveRatio: task.approveRatio,
      activationId: task.activationId,
      // 回执任务继承加签类型：before 加签任务被委派后，其回执确认仍参与「前加签全部完成」判定
      signType: task.signType,
      originalAssigneeId: delegatorId,
      delegatedFromId: null,
      comment: receiptComment,
    }).returning();
    return { closedTask, newTask };
  });

  const meta = { definitionId: inst.definitionId, tenantId: inst.tenantId, actor };
  if (action === 'approved') {
    emitTaskEvent('task.approved', mapTask(result.closedTask), { ...meta, comment });
  } else {
    emitTaskEvent('task.rejected', mapTask(result.closedTask), { ...meta, comment });
  }
  if (result.newTask) {
    emitTaskEvent('task.created', mapTask(result.newTask), meta);
    emitTaskEvent('task.assigned', mapTask(result.newTask), meta);
  }

  return {
    instance: mapInstance(inst),
    message: '已提交委派回执，等待原审批人确认',
  };
}
