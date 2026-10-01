import { describe, expect, it } from 'vitest';
import { workflowTaskActivationKey, workflowTaskActivationRounds } from './task-history';
import { workflowHandledInstanceItemSchema, workflowTaskDecisionSchema } from './contracts/instances';

describe('任务级审批历史', () => {
  it('同轮会签和加签共享轮次，重入节点递增，实例和节点分别编号', () => {
    const rows = [
      { instanceId: 1, nodeKey: 'finance', activationId: 'first' },
      { instanceId: 1, nodeKey: 'finance', activationId: 'first' },
      { instanceId: 1, nodeKey: 'manager', activationId: 'first' },
      { instanceId: 2, nodeKey: 'finance', activationId: 'first' },
      { instanceId: 1, nodeKey: 'finance', activationId: 'second' },
      { instanceId: 1, nodeKey: 'finance', activationId: 'second' },
    ];
    const rounds = workflowTaskActivationRounds(rows);
    expect(rows.map((row) => rounds.get(workflowTaskActivationKey(row)))).toEqual([1, 1, 1, 1, 2, 2]);
  });

  it('退回记录保留实际目标快照，拒绝非法动作', () => {
    expect(workflowTaskDecisionSchema.parse({ action: 'returnNode', targetNodeKey: 'manager', targetNodeName: '主管复核' })).toEqual({ action: 'returnNode', targetNodeKey: 'manager', targetNodeName: '主管复核' });
    expect(workflowTaskDecisionSchema.safeParse({ action: 'guessFromComment', targetNodeKey: null, targetNodeName: null }).success).toBe(false);
    expect(workflowHandledInstanceItemSchema.shape.handledTask.safeParse({ id: 4, nodeKey: 'finance', nodeName: '财务', nodeType: 'approve', activationId: 'first', round: 1, status: 'pending', actionAt: null, decision: null }).success).toBe(false);
  });
});
