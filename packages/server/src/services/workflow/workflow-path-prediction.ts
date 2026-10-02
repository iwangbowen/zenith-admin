import type { WorkflowFlowData, WorkflowNodeConfig, WorkflowPredictedPathNode } from '@zenith/shared/workflow';

type PredictionResolvers = {
  resolve: (config: WorkflowNodeConfig) => Promise<number[]>;
  names: (ids: Iterable<number>) => Promise<Map<number, string>>;
};

/** Resolve only safe read operations. Future decisions, selections and random draws remain explicitly unknown. */
export async function enrichPredictedApprovers(path: WorkflowPredictedPathNode[], flow: WorkflowFlowData, resolvers: PredictionResolvers): Promise<WorkflowPredictedPathNode[]> {
  const configs = new Map(flow.nodes.map(node => [node.data.key, node.data]));
  const idsByKey = new Map<string, number[]>();
  const enriched = await Promise.all(path.map(async entry => {
    const config = configs.get(entry.key);
    const result: WorkflowPredictedPathNode = { ...entry, estimatedApprovers: [], approverReason: null };
    if (!config || entry.status === 'excluded') return result;
    if (config.approveMethod === 'random') result.approverReason = '随机审批人在节点到达时确定';
    else if (config.approveMethod === 'auto' || config.approvalType === 'autoApprove' || config.approvalType === 'autoReject') result.approverReason = '自动处理节点，无需人工审批';
    else if (config.assigneeType === 'approverSelect') result.approverReason = '等待上一节点审批人选择';
    else if (config.assigneeType === 'formUser' || config.assigneeType === 'formDepartment' || config.assigneeType === 'expression') result.approverReason = '根据节点到达时的表单值确定';
    else if (config.assigneeType === 'nodeApprover') result.approverReason = '根据关联节点的实际审批人确定';
    else if (config.assigneeType === 'decision') result.approverReason = '审批人矩阵在节点到达时求值';
    else {
      const ids = await resolvers.resolve(config);
      idsByKey.set(entry.key, ids);
      result.approverReason = ids.length ? (['user', 'initiator', 'initiatorSelect', 'initiatorSelectScope'].includes(config.assigneeType ?? '') ? '按当前流程配置确定' : '按当前组织关系预测，节点到达时确认') : '尚未解析到审批人，节点到达时按配置处理';
    }
    return result;
  }));
  const names = await resolvers.names([...idsByKey.values()].flat());
  return enriched.map(entry => ({ ...entry, estimatedApprovers: (idsByKey.get(entry.key) ?? []).flatMap(id => { const name = names.get(id); return name ? [{ id, name }] : []; }) }));
}
