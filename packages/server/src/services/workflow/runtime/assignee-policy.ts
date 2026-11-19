import type { WorkflowFlowData, WorkflowNodeConfig, WorkflowApproverDedupMode, WorkflowDeduplicateStrategy } from '@zenith/shared/workflow';
import { resolveApproverDedupMode } from '@zenith/shared/workflow';
import type { TaskAction } from '../../../lib/workflow-engine';

/** 审批人经运行时策略过滤后为空时的原因（用于自动通过任务的可解释性留痕） */
export type AssigneeEmptiedReason = 'sameInitiator' | 'dedup' | null;

export type AssigneeRuntimeOutcome = 'assigned' | 'policySkipped' | 'unresolved';

export interface AssigneeRuntimeResult {
  /** assigned=有可派人员；policySkipped=按规则主动跳过；unresolved=解析/替换后确实无人 */
  outcome: AssigneeRuntimeOutcome;
  ids: number[];
  /** ids 为空时的过滤原因：同发起人跳过 / 审批人去重；解析本身为空时为 null */
  emptiedBy: AssigneeEmptiedReason;
  /** 被运行时策略剔除的具名人员（多人节点部分剔除时留痕用；全空场景由自动任务行说明） */
  excluded: Array<{ userId: number; reason: Exclude<AssigneeEmptiedReason, null> }>;
}

export interface AssigneePolicyPorts {
  initiatorId: number;
  settings?: WorkflowFlowData['settings'];
  resolve(config: WorkflowNodeConfig): Promise<number[]>;
  collectDedup(mode: 'all' | 'consecutive', nodeKey: string): Promise<Set<number>>;
}

/** Production and in-memory execution share the same assignee policies. */
export async function applyRuntimeAssigneePolicy(task: TaskAction, userIds: number[], ports: AssigneePolicyPorts): Promise<AssigneeRuntimeResult> {
  let ids = [...new Set(userIds)];
  const dedupMode = resolveApproverDedupMode(ports.settings);
  // 办理(handler)节点是必须实际执行的动作（打款/建档/盖章等），不是审批意见：
  // 无条件豁免「同发起人跳过」与「审批人去重」两类自动跳过——设计器会给所有节点
  // 默认写入 autoSkip，无法区分"显式配置"，而执行动作被跳过意味着流程显示完成但无人干活
  const isHandler = task.nodeType === 'handler';
  // 默认「自动跳过」：审批人解析为发起人本人时不生成自审任务（自批有合规风险），
  // 需要自审的流程在节点上显式配置 selfApprove
  const sameInitiatorStrategy = isHandler ? 'selfApprove' : (task.nodeConfig.sameInitiatorStrategy ?? 'autoSkip');
  let emptiedBy: AssigneeEmptiedReason = null;
  let outcome: AssigneeRuntimeOutcome = ids.length === 0 ? 'unresolved' : 'assigned';
  const excluded: AssigneeRuntimeResult['excluded'] = [];

  if (ids.includes(ports.initiatorId) && sameInitiatorStrategy !== 'selfApprove') {
    ids = ids.filter((id) => id !== ports.initiatorId);
    excluded.push({ userId: ports.initiatorId, reason: 'sameInitiator' });
    if (ids.length === 0) {
      emptiedBy = 'sameInitiator';
      // 显式自动跳过才是 policySkipped；转主管/负责人后仍无人属于 unresolved，必须走空人兜底
      outcome = sameInitiatorStrategy === 'autoSkip' ? 'policySkipped' : 'unresolved';
    }
    if (sameInitiatorStrategy === 'toDirectManager' || sameInitiatorStrategy === 'toDeptHead') {
      const replacements = await ports.resolve({ ...task.nodeConfig, assigneeType: sameInitiatorStrategy === 'toDirectManager' ? 'manager' : 'department', ...(sameInitiatorStrategy === 'toDirectManager' ? { managerLevel: 1 } : {}) });
      ids = [...new Set([...ids, ...replacements.filter((id) => id !== ports.initiatorId)])];
      if (ids.length > 0) {
        emptiedBy = null;
        outcome = 'assigned';
      }
    }
  }

  // 审批人去重：节点级 deduplicateStrategy 显式设置时优先，否则跟随流程级 approverDedupMode；
  // handler 节点恒不去重（执行动作不可被"已审批过"吃掉）
  const effectiveDedup = isHandler ? 'none' : resolveEffectiveDedup(task.nodeConfig.deduplicateStrategy, dedupMode);
  if (effectiveDedup !== 'none' && ids.length > 0) {
    const dedupUsers = await ports.collectDedup(effectiveDedup, task.nodeKey);
    for (const id of ids) {
      if (dedupUsers.has(id)) excluded.push({ userId: id, reason: 'dedup' });
    }
    ids = ids.filter((id) => !dedupUsers.has(id));
    if (ids.length === 0) {
      emptiedBy = 'dedup';
      outcome = 'policySkipped';
    }
  }

  return { outcome, ids, emptiedBy, excluded };
}

function resolveEffectiveDedup(
  nodeStrategy: WorkflowDeduplicateStrategy | undefined,
  globalMode: WorkflowApproverDedupMode,
): WorkflowApproverDedupMode {
  if (nodeStrategy === 'repeatApprove') return 'none';
  if (nodeStrategy === 'autoSkip') return globalMode === 'consecutive' ? 'consecutive' : 'all';
  return globalMode;
}

