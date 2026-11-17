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
    const output = await enrichPredictedApprovers(path, flow, { resolve, names, initiatorId: 99 });
    expect(resolve).not.toHaveBeenCalled();
    expect(output.every(node => node.estimatedApprovers?.length === 0 && node.approverReason)).toBe(true);
  });
  it('resolves real names once and explains dynamic organization predictions', async () => {
    const { flow, path } = fixture([{ assigneeType: 'user' }, { assigneeType: 'department' }, { assigneeType: 'decision' }]);
    path[2].status = 'excluded';
    const resolve = vi.fn(async () => [12]);
    const names = vi.fn(async () => new Map([[12, '财务负责人']]));
    const output = await enrichPredictedApprovers(path, flow, { resolve, names, initiatorId: 99 });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(names).toHaveBeenCalledTimes(1);
    expect(output[0].estimatedApprovers).toEqual([{ id: 12, name: '财务负责人' }]);
    expect(output[1].approverReason).toContain('节点到达时确认');
    expect(output[2].estimatedApprovers).toEqual([]);
  });

  it('marks same-initiator autoSkip as policy skipped instead of showing an empty approver', async () => {
    const { flow, path } = fixture([{ assigneeType: 'user', assigneeIds: [99], sameInitiatorStrategy: 'autoSkip' }]);
    const resolve = vi.fn(async () => [99]);
    const output = await enrichPredictedApprovers(path, flow, { resolve, names: async () => new Map(), initiatorId: 99 });
    expect(output[0].policySkipped).toBe(true);
    expect(output[0].estimatedApprovers).toEqual([]);
    expect(output[0].approverReason).toContain('自动跳过');
  });

  it('keeps selfApprove and unresolved replacement distinguishable', async () => {
    const { flow, path } = fixture([
      { assigneeType: 'user', assigneeIds: [99], sameInitiatorStrategy: 'selfApprove' },
      { assigneeType: 'user', assigneeIds: [99], sameInitiatorStrategy: 'toDirectManager' },
    ]);
    const resolve = vi.fn(async () => [99]);
    const output = await enrichPredictedApprovers(path, flow, { resolve, names: async () => new Map([[99, '本人']]), initiatorId: 99 });
    expect(output[0].policySkipped).toBeFalsy();
    expect(output[0].estimatedApprovers).toEqual([{ id: 99, name: '本人' }]);
    expect(output[1].policySkipped).toBeFalsy();
    expect(output[1].approverReason).toContain('未找到可替换');
  });
});
