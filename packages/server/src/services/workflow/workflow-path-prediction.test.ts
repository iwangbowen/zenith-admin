import { describe, expect, it, vi } from 'vitest';
import type { WorkflowFlowData, WorkflowNodeConfig, WorkflowPredictedPathNode } from '@zenith/shared/workflow';
import { enrichPredictedApprovers } from './workflow-path-prediction';

function fixture(configs: Partial<WorkflowNodeConfig>[]) {
  const flow: WorkflowFlowData = { nodes: configs.map((config, index) => ({ id: String(index), position: { x: 0, y: 0 }, data: { key: String(index), label: '审批', type: 'approve', ...config } })), edges: [] };
  const path: WorkflowPredictedPathNode[] = flow.nodes.map(node => ({ key: node.data.key, name: node.data.label, type: 'approve', status: 'matched', reason: '后续节点' }));
  return { flow, path };
}

describe('read-only future approver prediction', () => {
  it('never runs random draws, decisions, future-form or pending-selection resolvers', async () => {
    const { flow, path } = fixture([{ assigneeType: 'decision' }, { assigneeType: 'formUser' }, { assigneeType: 'approverSelect' }, { assigneeType: 'nodeApprover' }, { assigneeType: 'user', approveMethod: 'random' }, { assigneeType: 'expression' }]);
    const resolve = vi.fn(async () => [12]);
    const names = vi.fn(async () => new Map<number, string>());
    const output = await enrichPredictedApprovers(path, flow, { resolve, names });
    expect(resolve).not.toHaveBeenCalled();
    expect(output.every(node => node.estimatedApprovers?.length === 0 && node.approverReason)).toBe(true);
  });
  it('resolves real names once and explains dynamic organization predictions', async () => {
    const { flow, path } = fixture([{ assigneeType: 'user' }, { assigneeType: 'department' }, { assigneeType: 'decision' }]);
    path[2].status = 'excluded';
    const resolve = vi.fn(async () => [12]);
    const names = vi.fn(async () => new Map([[12, '财务负责人']]));
    const output = await enrichPredictedApprovers(path, flow, { resolve, names });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(names).toHaveBeenCalledTimes(1);
    expect(output[0].estimatedApprovers).toEqual([{ id: 12, name: '财务负责人' }]);
    expect(output[1].approverReason).toContain('节点到达时确认');
    expect(output[2].estimatedApprovers).toEqual([]);
  });
});
