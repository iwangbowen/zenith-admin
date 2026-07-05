// ─── 审批动作核心：同意/拒绝（含回调与动作按钮校验）（拆分自 workflow-instances.service.ts）───
import { eq, and, desc, or, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import { findReturnPrevTarget } from '../../../lib/workflow-engine';
import type { WorkflowFlowData, WorkflowEventActor, WorkflowActionButtonKey, WorkflowActionButtonConfig } from '@zenith/shared';
import { findNextApproverSelectNodes, resolveNodeFieldPermissions, sanitizeFormUpdatesByNodePerms } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { buildStarterContext, listSelectableApprovers } from '../workflow-assignee-resolver.service';
import type { WorkflowSelectableNextApproverGroup } from '@zenith/shared';
import logger from '../../../lib/logger';
import { enqueueSubprocessJoin } from './async-jobs';
import { assertSelectedNextApprovers } from './initiator-select';
import { mapInstance, mapTask } from './mapping';
import { advanceAndMaterialize, checkNodeCompletion, killInstanceTokens } from './materialize';
import type { MaterializeTrigger } from './materialize';
import { emitInstanceEvent, emitNodeEvent, emitTaskEvent } from './shared';

export type WorkflowTaskAttachment = { name: string; url: string; size?: number };

/** 读取节点「操作按钮设置」中指定按钮的配置 */
function resolveNodeActionButton(
  inst: typeof workflowInstances.$inferSelect,
  nodeKey: string,
  key: WorkflowActionButtonKey,
): WorkflowActionButtonConfig | undefined {
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  const nodeCfg = flowData?.nodes.find((n) => n.data.key === nodeKey)?.data;
  const buttons = nodeCfg?.actionButtons as Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | undefined;
  return buttons?.[key];
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
 * 候选人已按各节点 selectScope（成员/角色/部门/用户组）在服务端解析收窄；无下游 approverSelect 时返回空数组。
 */
export async function listTaskSelectableNextApprovers(taskId: number): Promise<WorkflowSelectableNextApproverGroup[]> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks)
    .where(eq(workflowTasks.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.assigneeId !== user.userId) {
    // 任务已转办/委派给他人：曾经手的用户返回空组而非 404（审批面板关闭前的缓存刷新会重取本查询）
    const chain: number[] = Array.isArray(task.transferChain) ? task.transferChain : [];
    const wasMine = chain.includes(user.userId) || task.originalAssigneeId === user.userId || task.delegatedFromId === user.userId;
    if (!wasMine) throw new HTTPException(404, { message: '任务不存在或无权操作' });
    return [];
  }
  // 已处理（同意/拒绝/退回等）的任务无需再选下一审批人：返回空组而非 404，
  // 避免审批成功后前端 invalidateQueries 立即重取本查询时误报「任务不存在或无权操作」
  if (task.status !== 'pending') return [];
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  if (!flowData) return [];
  const nodes = findNextApproverSelectNodes(flowData, task.nodeKey);
  return Promise.all(nodes.map(async (node) => ({
    nodeKey: node.data.key,
    label: node.data.label || node.data.key,
    selectableApprovers: await listSelectableApprovers(node.data),
  })));
}

export async function approveTask(taskId: number, comment?: string, attachments?: Array<{ name: string; url: string; size?: number }>, selectedNextApprovers?: Record<string, number[]>, signature?: string, formUpdates?: Record<string, unknown>): Promise<ApproveResult> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  // 校验"操作按钮设置"中通过按钮的附件必填（uploadMode === 'required'）
  const flowData = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  const nodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
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
  // 委派回执：若由委派人操作，不推进流程，仅生成回执任务给原委派人
  if (task.delegatedFromId && task.delegatedFromId !== user.userId) {
    return processDelegatedReceipt(task, inst, 'approved', comment, { userId: user.userId, name: user.username }, attachments, formUpdates);
  }
  return approveTaskCore(task, inst, comment, { userId: user.userId, name: user.username }, { selectedNextApprovers, signature, attachments, formUpdates });
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并审批通过 */
export async function approveTaskByCallback(callbackId: string, comment: string | undefined, approverName: string): Promise<ApproveResult> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (task.status === 'approved') {
    return { instance: mapInstance(inst), message: '回调已处理' };
  }
  if (task.status !== 'waiting') throw new HTTPException(409, { message: '回调任务已处理' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
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

export async function approveTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string | undefined,
  actor: WorkflowEventActor,
  options?: { selectedNextApprovers?: Record<string, number[]>; signature?: string; attachments?: Array<{ name: string; url: string; size?: number }>; formUpdates?: Record<string, unknown> },
): Promise<ApproveResult> {
  const taskId = task.id;
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData };
  const flowData = snapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });

  const updated = await db.transaction(async (tx) => {
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
    if (!approvedTask) throw new HTTPException(409, { message: '任务已被处理，请刷新后重试' });

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
      return { row, finished: false, rejected: false, advanced: false, approvedTask, newTasks: [] as typeof workflowTasks.$inferSelect[] };
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
      // 下游自动拒绝终止流程：清理实例其余未结束任务（如并行其它分支待办），保证 rejected 实例无残留待办
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
      const [row] = await tx.update(workflowInstances).set({ status: 'rejected', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { row, finished: false, rejected: true, advanced: true, approvedTask, newTasks: materialized.createdTasks };
    }

    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { row, finished: true, rejected: false, advanced: true, approvedTask, newTasks: materialized.createdTasks };
    }

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, finished: false, rejected: false, advanced: true, approvedTask, newTasks: materialized.createdTasks };
  });

  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor };
  emitTaskEvent('task.approved', mapTask(updated.approvedTask), { ...meta, comment });
  if (updated.advanced) {
    emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
  }
  for (const t of updated.newTasks) {
    emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId && t.status === 'pending') {
      emitTaskEvent('task.assigned', mapTask(t), meta);
    }
    if (t.status === 'approved') {
      emitTaskEvent('task.approved', mapTask(t), meta);
    }
    if (t.status === 'rejected') {
      emitTaskEvent('task.rejected', mapTask(t), meta);
    }
  }
  if (updated.finished) {
    emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void enqueueSubprocessJoin(updated.row).catch((err) => {
        logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
      });
    }
  }
  if (updated.rejected) {
    emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void enqueueSubprocessJoin(updated.row).catch((err) => {
        logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
      });
    }
  }

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
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  if (!comment.trim()) throw new HTTPException(400, { message: '请填写拒绝原因' });
  assertActionUploadRequirement(inst, task.nodeKey, 'reject', attachments);
  if (task.delegatedFromId && task.delegatedFromId !== user.userId) {
    return processDelegatedReceipt(task, inst, 'rejected', comment, { userId: user.userId, name: user.username }, attachments);
  }
  return rejectTaskCore(task, inst, comment, { userId: user.userId, name: user.username }, attachments);
}

/** 外部审批回调：根据 callbackId 找到 waiting 任务并驳回 */
export async function rejectTaskByCallback(callbackId: string, comment: string, approverName: string) {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (task.status === 'rejected') {
    return { instance: mapInstance(inst), message: '回调已处理' };
  }
  if (task.status !== 'waiting') throw new HTTPException(409, { message: '回调任务已处理' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
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

export async function rejectTaskCore(
  task: typeof workflowTasks.$inferSelect,
  inst: typeof workflowInstances.$inferSelect,
  comment: string,
  actor: WorkflowEventActor,
  attachments?: WorkflowTaskAttachment[],
): Promise<ApproveResult> {
  const taskId = task.id;
  // 读取节点驳回策略
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  const currentNodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  // 优先采用“操作按钮设置”中拒绝按钮的跳转配置
  const actionRejectJump = (currentNodeCfg?.actionButtons as { reject?: { jumpToNodeKey?: string } } | undefined)?.reject?.jumpToNodeKey;
  let strategy: 'terminate' | 'returnPrev' | 'returnStart' | 'returnToNode' = currentNodeCfg?.rejectStrategy ?? 'terminate';
  let rejectToNodeKey: string | undefined = currentNodeCfg?.rejectToNodeKey;
  if (actionRejectJump) {
    strategy = 'returnToNode';
    rejectToNodeKey = actionRejectJump;
  }

  // 解析目标节点（returnPrev / returnStart / returnToNode）
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

  const updated = await db.transaction(async (tx) => {
    // 实例行级锁：序列化同一实例上的并发审批/驳回，避免与并发审批互相覆盖推进
    const [lockedInst] = await tx.select({ status: workflowInstances.status })
      .from(workflowInstances).where(eq(workflowInstances.id, inst.id)).for('update').limit(1);
    if (!lockedInst || lockedInst.status !== 'running') {
      throw new HTTPException(409, { message: '流程实例状态已变化，请刷新后重试' });
    }
    // 当前任务 → rejected（乐观并发保护：状态变更则中止，防止并发重复驳回）
    const [rejectedTask] = await tx.update(workflowTasks)
      .set({ status: 'rejected', comment, attachments: attachments ?? null, actionAt: new Date() })
      .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.status, task.status)))
      .returning();
    if (!rejectedTask) throw new HTTPException(409, { message: '任务已被处理，请刷新后重试' });

    // 比例会签：本任务驳回后若阈值仍可达成，仅记录该任务驳回、节点保持活动。
    // 必须在实例行级锁内基于最新状态判定，避免并发驳回各自读到旧状态、都不触发整节点驳回而使节点卡死。
    if (rejectedTask.approveMethod === 'ratio') {
      const ratioSiblings = await tx.select().from(workflowTasks)
        .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey)));
      const ratioPct = ratioSiblings.find((t) => t.approveRatio)?.approveRatio ?? 51;
      const required = Math.ceil(ratioSiblings.length * ratioPct / 100);
      const maxPossibleApproved = ratioSiblings
        .filter((t) => t.status === 'approved' || t.status === 'pending' || t.status === 'waiting')
        .length;
      if (maxPossibleApproved >= required) {
        return {
          row: inst,
          terminated: false as const,
          finished: false as const,
          partial: true as const,
          rejectedTask,
          skippedTasks: [] as typeof workflowTasks.$inferSelect[],
          newTasks: [] as typeof workflowTasks.$inferSelect[],
        };
      }
    }

    // 同节点其他 pending / waiting 任务跳过
    const skipped = await tx.update(workflowTasks)
      .set({ status: 'skipped', actionAt: new Date() })
      .where(and(
        eq(workflowTasks.instanceId, inst.id),
        eq(workflowTasks.nodeKey, task.nodeKey),
        or(eq(workflowTasks.status, 'pending'), eq(workflowTasks.status, 'waiting')),
      ))
      .returning();

    // 终止：实例置为 rejected
    if (strategy === 'terminate' || !targetNodeKey || !flowData) {
      await killInstanceTokens(tx, inst.id);
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    // 回退：实例保持 running，在目标节点重新生成任务
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const starter = await buildStarterContext(inst.initiatorId, tx);
    let returnTrigger: MaterializeTrigger | null = null;

    if (strategy === 'returnStart') {
      returnTrigger = { kind: 'seed' };
    } else {
      const targetCfg = flowData.nodes.find((n) => n.data.key === targetNodeKey)?.data;
      if (targetCfg && (targetCfg.type === 'approve' || targetCfg.type === 'handler')) {
        returnTrigger = { kind: 'enterNode', nodeKey: targetCfg.key };
      }
    }

    if (!returnTrigger) {
      await killInstanceTokens(tx, inst.id);
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
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
      // 下游自动拒绝终止流程：清理实例其余未结束任务，保证 rejected 实例无残留待办
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(eq(workflowTasks.instanceId, inst.id), inArray(workflowTasks.status, ['pending', 'waiting'])));
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks };
    }

    if (materialized.finished) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'approved', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: false, finished: true, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks };
    }

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: materialized.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, terminated: false, finished: false, rejectedTask, skippedTasks: skipped, newTasks: materialized.createdTasks };
  });

  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor };
  emitTaskEvent('task.rejected', mapTask(updated.rejectedTask), { ...meta, comment });
  // 比例会签部分驳回：节点仍活动，仅记录该任务驳回，不发节点离开 / 实例状态事件
  if ((updated as { partial?: boolean }).partial) {
    return { instance: mapInstance(updated.row), message: '已驳回' };
  }
  for (const t of updated.skippedTasks) {
    emitTaskEvent('task.skipped', mapTask(t), meta);
  }
  emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
  if (updated.terminated) {
    emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
    if (updated.row.parentTaskId) {
      void enqueueSubprocessJoin(updated.row).catch((err) => {
        logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
      });
    }
  } else {
    for (const t of updated.newTasks) {
      emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
      emitTaskEvent('task.created', mapTask(t), meta);
      if (t.assigneeId && t.status === 'pending') emitTaskEvent('task.assigned', mapTask(t), meta);
      if (t.status === 'approved') emitTaskEvent('task.approved', mapTask(t), meta);
      if (t.status === 'rejected') emitTaskEvent('task.rejected', mapTask(t), meta);
    }
    if (updated.finished) {
      emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
      if (updated.row.parentTaskId) {
        void enqueueSubprocessJoin(updated.row).catch((err) => {
          logger.error('[subProcess] resume parent failed', { childId: updated.row.id, err });
        });
      }
    }
  }

  return { instance: mapInstance(updated.row), message: '已驳回' };
}

/** 通用：获取当前用户名下的 pending 任务 + 实例（含校验） */
export async function getOwnPendingTask(taskId: number) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances)
    .where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
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

  const result = await db.transaction(async (tx) => {
    const [closedTask] = await tx.update(workflowTasks).set({
      status: action,
      comment: receiptComment,
      attachments: attachments ?? null,
      actionAt: new Date(),
    }).where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, task.status))).returning();
    if (!closedTask) throw new HTTPException(409, { message: '任务已被处理，请刷新后重试' });
    // 委派人同样是节点合法处理人：其「可编辑」字段修改按同一白名单合并进实例表单
    const receiptFlow = (inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
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
      originalAssigneeId: delegatorId,
      transferChain: [],
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
  emitTaskEvent('task.created', mapTask(result.newTask), meta);
  emitTaskEvent('task.assigned', mapTask(result.newTask), meta);

  return {
    instance: mapInstance(inst),
    message: '已提交委派回执，等待原审批人确认',
  };
}
