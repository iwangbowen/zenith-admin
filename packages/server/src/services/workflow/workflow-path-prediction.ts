import type { WorkflowFlowData, WorkflowNodeConfig, WorkflowPredictedPathNode } from '@zenith/shared/workflow';
import { classifyWorkflowNode } from '@zenith/shared/workflow';

type PredictionResolvers = {
  resolve: (config: WorkflowNodeConfig) => Promise<number[]>;
  names: (ids: Iterable<number>) => Promise<Map<number, string>>;
  initiatorId: number;
};

/** 预览侧复用与实跑一致的同发起人策略；去重需要真实历史，预览只做同人跳过。 */
export async function applyPreviewAssigneePolicy(
  config: WorkflowNodeConfig,
  ids: number[],
  initiatorId: number,
  resolve: (config: WorkflowNodeConfig) => Promise<number[]>,
): Promise<{ ids: number[]; policySkipped: boolean; reason: string | null }> {
  const strategy = config.sameInitiatorStrategy ?? 'autoSkip';
  if (!ids.includes(initiatorId) || strategy === 'selfApprove') {
    return { ids, policySkipped: false, reason: null };
  }
  const remaining = ids.filter((id) => id !== initiatorId);
  if (strategy === 'autoSkip') {
    return {
      ids: remaining,
      policySkipped: remaining.length === 0,
      reason: remaining.length === 0 ? '审批人与发起人为同一人，将按规则自动跳过' : null,
    };
  }
  const replacement = await resolve({
    ...config,
    assigneeType: strategy === 'toDirectManager' ? 'manager' : 'department',
    managerLevel: 1,
  });
  const merged = [...new Set([...remaining, ...replacement.filter((id) => id !== initiatorId)])];
  return {
    ids: merged,
    policySkipped: false,
    reason: merged.length === 0 ? '审批人与发起人为同一人，且未找到可替换的上级/负责人' : null,
  };
}

/** Resolve only safe read operations. Future decisions, selections and random draws remain explicitly unknown. */
export async function enrichPredictedApprovers(path: WorkflowPredictedPathNode[], flow: WorkflowFlowData, resolvers: PredictionResolvers): Promise<WorkflowPredictedPathNode[]> {
  const configs = new Map(flow.nodes.map(node => [node.data.key, node.data]));
  const idsByKey = new Map<string, number[]>();
  const enriched = await Promise.all(path.map(async entry => {
    const config = configs.get(entry.key);
    const result: WorkflowPredictedPathNode = { ...entry, estimatedApprovers: [], approverReason: null };
    if (!config || entry.status === 'excluded') return result;
    const behavior = classifyWorkflowNode(config);
    if (behavior.kind === 'wait') {
      result.blocking = behavior.blocks;
      result.waitReason = behavior.waitReason;
      result.approverReason = behavior.waitReason === 'delay' ? '到达设定时间后继续'
        : behavior.waitReason === 'subprocess' ? (behavior.blocks ? '子流程进入后按其流程配置确定' : '子流程已发起，不等待其完成')
          : (config.triggerConfig?.triggerType === 'callback' ? '等待外部回调后继续' : '等待异步处理完成后继续');
      return result;
    }
    if (config.approveMethod === 'random') result.approverReason = '随机审批人在节点到达时确定';
    else if (config.approveMethod === 'auto' || config.approvalType === 'autoApprove' || config.approvalType === 'autoReject') result.approverReason = '自动处理节点，无需人工审批';
    else if (config.assigneeType === 'approverSelect') result.approverReason = '等待上一节点审批人选择';
    else if (config.assigneeType === 'formUser' || config.assigneeType === 'formDepartment' || config.assigneeType === 'expression') result.approverReason = '根据节点到达时的表单值确定';
    else if (config.assigneeType === 'nodeApprover') result.approverReason = '根据关联节点的实际审批人确定';
    else if (config.assigneeType === 'decision') result.approverReason = '审批人矩阵在节点到达时求值';
    else {
      const ids = await resolvers.resolve(config);
      const policy = await applyPreviewAssigneePolicy(config, ids, resolvers.initiatorId, resolvers.resolve);
      idsByKey.set(entry.key, policy.ids);
      result.policySkipped = policy.policySkipped;
      result.approverReason = policy.reason ?? (policy.ids.length ? (['user', 'initiator', 'initiatorSelect', 'initiatorSelectScope'].includes(config.assigneeType ?? '') ? '按当前流程配置确定' : '按当前组织关系预测，节点到达时确认') : '尚未解析到审批人，节点到达时按配置处理');
    }
    return result;
  }));
  const names = await resolvers.names([...idsByKey.values()].flat());
  return enriched.map(entry => ({ ...entry, estimatedApprovers: (idsByKey.get(entry.key) ?? []).flatMap(id => { const name = names.get(id); return name ? [{ id, name }] : []; }) }));
}
