// ─── 审批人运行时策略（去重/同发起人替换/管理员兜底）（拆分自 workflow-instances.service.ts）───
import { eq, ne, and, desc } from 'drizzle-orm';
import { workflowTasks } from '../../../db/schema';
import { type TaskAction } from '../../../lib/workflow-engine';
import type { WorkflowFlowData, WorkflowApproverDedupMode, WorkflowDeduplicateStrategy } from '@zenith/shared/workflow';
import { resolveApproverDedupMode } from '@zenith/shared/workflow';
import { resolveAssigneeIds } from '../workflow-assignee-resolver.service';
import type { DbExecutor } from '../../../db/types';

async function resolveSameInitiatorReplacement(
  task: TaskAction,
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings'] },
): Promise<number[]> {
  const strategy = task.nodeConfig.sameInitiatorStrategy;
  if (strategy === 'toDirectManager') {
    return resolveAssigneeIds({ ...task.nodeConfig, assigneeType: 'manager', managerLevel: 1 }, {
      initiatorId: ctx.initiatorId,
      executor: ctx.executor,
      formData: ctx.formData,
      instanceId: ctx.instanceId,
    });
  }
  if (strategy === 'toDeptHead') {
    return resolveAssigneeIds({ ...task.nodeConfig, assigneeType: 'department' }, {
      initiatorId: ctx.initiatorId,
      executor: ctx.executor,
      formData: ctx.formData,
      instanceId: ctx.instanceId,
    });
  }
  return [];
}

/** 审批人经运行时策略过滤后为空时的原因（用于自动通过任务的可解释性留痕） */
export type AssigneeEmptiedReason = 'sameInitiator' | 'dedup' | null;

export interface AssigneeRuntimeResult {
  ids: number[];
  /** ids 为空时的过滤原因：同发起人跳过 / 审批人去重；解析本身为空时为 null */
  emptiedBy: AssigneeEmptiedReason;
  /** 被运行时策略剔除的具名人员（多人节点部分剔除时留痕用；全空场景由自动任务行说明） */
  excluded: Array<{ userId: number; reason: Exclude<AssigneeEmptiedReason, null> }>;
}

export async function applyAssigneeRuntimeStrategies(
  task: TaskAction,
  userIds: number[],
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings'] },
): Promise<AssigneeRuntimeResult> {
  let ids = [...new Set(userIds)];
  const dedupMode = resolveApproverDedupMode(ctx.settings);
  // 办理(handler)节点是必须实际执行的动作（打款/建档/盖章等），不是审批意见：
  // 无条件豁免「同发起人跳过」与「审批人去重」两类自动跳过——设计器会给所有节点
  // 默认写入 autoSkip，无法区分"显式配置"，而执行动作被跳过意味着流程显示完成但无人干活
  const isHandler = task.nodeType === 'handler';
  // 默认「自动跳过」：审批人解析为发起人本人时不生成自审任务（自批有合规风险），
  // 需要自审的流程在节点上显式配置 selfApprove
  const sameInitiatorStrategy = isHandler ? 'selfApprove' : (task.nodeConfig.sameInitiatorStrategy ?? 'autoSkip');
  let emptiedBy: AssigneeEmptiedReason = null;
  const excluded: AssigneeRuntimeResult['excluded'] = [];

  if (ids.includes(ctx.initiatorId) && sameInitiatorStrategy !== 'selfApprove') {
    ids = ids.filter((id) => id !== ctx.initiatorId);
    excluded.push({ userId: ctx.initiatorId, reason: 'sameInitiator' });
    if (ids.length === 0) emptiedBy = 'sameInitiator';
    if (sameInitiatorStrategy === 'toDirectManager' || sameInitiatorStrategy === 'toDeptHead') {
      const replacements = await resolveSameInitiatorReplacement(task, ctx);
      ids = [...new Set([...ids, ...replacements.filter((id) => id !== ctx.initiatorId)])];
      if (ids.length > 0) emptiedBy = null;
    }
  }

  // 审批人去重：节点级 deduplicateStrategy 显式设置时优先，否则跟随流程级 approverDedupMode；
  // handler 节点恒不去重（执行动作不可被"已审批过"吃掉）
  const effectiveDedup = isHandler ? 'none' : resolveEffectiveDedup(task.nodeConfig.deduplicateStrategy, dedupMode);
  if (effectiveDedup !== 'none' && ids.length > 0) {
    const dedupUsers = await collectDedupApprovers(ctx.executor, ctx.instanceId, effectiveDedup);
    for (const id of ids) {
      if (dedupUsers.has(id)) excluded.push({ userId: id, reason: 'dedup' });
    }
    ids = ids.filter((id) => !dedupUsers.has(id));
    if (ids.length === 0) emptiedBy = 'dedup';
  }

  return { ids, emptiedBy, excluded };
}

/**
 * 计算某审批节点的有效去重范围：
 * - 节点显式「仍需审批」→ 不去重
 * - 节点显式「自动跳过」→ 至少 all；流程级为 consecutive 时尊重 consecutive
 * - 节点未设置 → 完全跟随流程级模式
 */
function resolveEffectiveDedup(
  nodeStrategy: WorkflowDeduplicateStrategy | undefined,
  globalMode: WorkflowApproverDedupMode,
): WorkflowApproverDedupMode {
  if (nodeStrategy === 'repeatApprove') return 'none';
  if (nodeStrategy === 'autoSkip') return globalMode === 'consecutive' ? 'consecutive' : 'all';
  return globalMode;
}

/** 收集需要去重的「前序已审批」处理人集合 */
async function collectDedupApprovers(
  exec: DbExecutor,
  instanceId: number,
  mode: 'all' | 'consecutive',
): Promise<Set<number>> {
  if (mode === 'all') {
    // 去重实例内所有已审批人（含抄送，保持既有行为）
    const rows = await exec.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'approved')));
    return new Set(rows.map((row) => row.assigneeId).filter((id): id is number => typeof id === 'number'));
  }
  // consecutive：仅取「紧邻的前一个审批节点」（排除抄送）的处理人
  const rows = await exec
    .select({ nodeKey: workflowTasks.nodeKey, assigneeId: workflowTasks.assigneeId })
    .from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, instanceId),
      eq(workflowTasks.status, 'approved'),
      ne(workflowTasks.nodeType, 'ccNode'),
    ))
    .orderBy(desc(workflowTasks.id));
  const lastNodeKey = rows[0]?.nodeKey;
  if (!lastNodeKey) return new Set();
  return new Set(
    rows
      .filter((row) => row.nodeKey === lastNodeKey)
      .map((row) => row.assigneeId)
      .filter((id): id is number => typeof id === 'number'),
  );
}
