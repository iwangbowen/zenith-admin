import type { WorkflowFlowData, WorkflowNodeConfig, WorkflowPathPlanOptions } from '@zenith/shared/workflow';
import { planWorkflowPath } from '@zenith/shared/workflow';
import { uniquePositiveInts } from '@zenith/shared/core';
import { HTTPException } from 'hono/http-exception';

export async function applyRuntimeInitiatorSelections(flow: WorkflowFlowData, selected: Record<string, number[]> | null | undefined,
  context: Pick<WorkflowPathPlanOptions, 'formData' | 'formFields' | 'starter'>,
  filter: (config: WorkflowNodeConfig, ids: number[]) => Promise<number[]>) {
  const nodes = flow.nodes.filter(node => node.data.assigneeType === 'initiatorSelect' || node.data.assigneeType === 'initiatorSelectScope');
  if (!nodes.length) return flow;
  const path = planWorkflowPath(flow, { ...context, recomputeDerivedValues: true });
  const statuses = new Map(path.nodes.map(node => [node.nodeKey, node.status]));
  const picked = new Map<string, number[]>();
  for (const node of nodes) {
    if (statuses.get(node.data.key) === 'excluded') continue;
    const ids = await filter(node.data, uniquePositiveInts(selected?.[node.data.key] ?? []));
    if (!ids.length) throw new HTTPException(400, { message: '请选择节点「' + node.data.label + '」的审批人' });
    picked.set(node.data.key, ids);
  }
  return { ...flow, nodes: flow.nodes.map(node => {
    const ids = picked.get(node.data.key);
    return ids ? { ...node, data: { ...node.data, userIds: ids, assigneeIds: ids, assigneeId: ids.length === 1 ? ids[0] : null } } : node;
  }) };
}
