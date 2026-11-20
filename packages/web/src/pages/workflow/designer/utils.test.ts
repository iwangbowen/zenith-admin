import { describe, expect, it } from 'vitest';
import type { FlowProcess } from './types';
import { createBranch, duplicateNode, findFlowNode, validateConditionBranches } from './utils';

const conditions = [
  { type: 'and' as const, rules: [{ field: 'amount', operator: 'gt' as const, value: 100 }] },
];

function gatewayProcess(): FlowProcess {
  return {
    initiator: {
      id: 'initiator',
      type: 'initiator',
      name: '发起人',
      props: {},
      children: {
        id: 'gw',
        type: 'conditionBranch',
        name: '条件分支',
        props: {},
        branches: [
          { id: 'b1', name: '条件1', conditions, graphEdge: { id: 'edge-1', source: 'gw', target: 'join' } },
          { id: 'b2', name: '条件2', conditions: [{ type: 'and', rules: [{ field: 'amount', operator: 'lte', value: 100 }] }], graphEdge: { id: 'edge-2', source: 'gw', target: 'join' } },
        ],
      },
    },
  };
}

describe('createBranch', () => {
  it('删除分支后复用序号时跳过已占用名称', () => {
    expect(createBranch('conditionBranch', 3, ['条件1', '条件3']).name).toBe('条件4');
    expect(createBranch('conditionBranch', 3, ['条件1', '条件2']).name).toBe('条件3');
    expect(createBranch('parallelBranch', 2, ['并行1']).name).toBe('并行2');
  });
});

describe('duplicateNode', () => {
  it('复制分支节点时剥离 graphEdge，避免与原分支边 id 冲突', () => {
    const next = duplicateNode(gatewayProcess(), 'gw');
    const source = findFlowNode(next.initiator, 'gw')!;
    const copy = source.children!;
    expect(copy.id).not.toBe('gw');
    expect(copy.branches).toHaveLength(2);
    for (const branch of copy.branches!) {
      expect(branch.graphEdge).toBeUndefined();
      expect(branch.id).not.toBe('b1');
      expect(branch.id).not.toBe('b2');
    }
  });
});

describe('validateConditionBranches', () => {
  it('拦截跨分支完全相同的条件', () => {
    const process = gatewayProcess();
    process.initiator.children!.branches![1].conditions = structuredClone(conditions);
    expect(validateConditionBranches(process)).toEqual([
      expect.stringContaining('条件与「条件1」完全相同'),
    ]);
  });

  it('条件不同的分支通过校验', () => {
    expect(validateConditionBranches(gatewayProcess())).toEqual([]);
  });
});
