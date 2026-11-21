import { describe, expect, it } from 'vitest';
import type { WorkflowApproverPreviewNode, WorkflowPreviewBranchRef } from '@zenith/shared/workflow';
import { branchChainText, groupUnknownBranches } from './approval-chain-groups';

const node = (
  key: string,
  extra: Partial<WorkflowApproverPreviewNode> = {},
): WorkflowApproverPreviewNode => ({
  nodeKey: key,
  nodeName: key,
  nodeType: 'approve',
  approvers: [],
  ...extra,
});

const ref = (
  gatewayKey: string,
  branchKey: string,
  label: string,
  status: WorkflowPreviewBranchRef['status'],
): WorkflowPreviewBranchRef => ({
  gatewayKey,
  gatewayLabel: '条件分支',
  gatewayType: 'exclusiveGateway',
  branchKey,
  branchLabel: label,
  status,
});

describe('groupUnknownBranches', () => {
  it('把同一网关下条件未定的多条分支聚合成一组并隐藏原节点', () => {
    const nodes = [
      node('alloc', { status: 'matched', reason: '正常后续路径' }),
      node('chuzhi', { status: 'unknown', reason: '后续「分配」可修改「动作」，需处理后才能确定', branchPath: [ref('gw', 'gw#1', '正常', 'unknown')] }),
      node('xietiao', { status: 'unknown', reason: '后续「分配」可修改「动作」，需处理后才能确定', branchPath: [ref('gw', 'gw#2', '疑难', 'unknown')] }),
      node('jiaji', { status: 'unknown', reason: '后续「分配」可修改「动作」，需处理后才能确定', branchPath: [ref('gw', 'gw#3', '加急', 'unknown')] }),
    ];
    const grouped = groupUnknownBranches(nodes);
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0].rows.map((row) => row.label)).toEqual(['正常', '疑难', '加急']);
    expect(grouped.groups[0].rows[0].nodes.map((n) => n.nodeKey)).toEqual(['chuzhi']);
    expect(grouped.groups[0].firstIndex).toBe(1);
    expect(grouped.groups[0].lastIndex).toBe(3);
    expect(grouped.hiddenNodeKeys).toEqual(new Set(['chuzhi', 'xietiao', 'jiaji']));
    expect(grouped.groupByFirstIndex.get(1)?.gatewayKey).toBe('gw');
  });

  it('条件已明确命中时不聚合，交由现有预计路径过滤', () => {
    const nodes = [
      node('chuzhi', { status: 'matched', branchPath: [ref('gw', 'gw#1', '正常', 'matched')] }),
      node('xietiao', { status: 'excluded', branchPath: [ref('gw', 'gw#2', '疑难', 'excluded')] }),
    ];
    const grouped = groupUnknownBranches(nodes);
    expect(grouped.groups).toHaveLength(0);
    expect(grouped.hiddenNodeKeys.size).toBe(0);
  });

  it('只有一条可能分支时不聚合', () => {
    const nodes = [
      node('a', { status: 'unknown', branchPath: [ref('gw', 'gw#1', '正常', 'unknown')] }),
      node('b', { status: 'excluded' }),
    ];
    expect(groupUnknownBranches(nodes).groups).toHaveLength(0);
  });

  it('嵌套分支只按最外层聚合，内层节点归入外层分支链路', () => {
    const outer = (branch: string, label: string) => ref('outer', branch, label, 'unknown');
    const inner = (branch: string, label: string) => ref('inner', branch, label, 'unknown');
    const nodes = [
      node('a', { status: 'unknown', branchPath: [outer('outer#1', '正常'), inner('inner#1', '子条件1')] }),
      node('b', { status: 'unknown', branchPath: [outer('outer#1', '正常'), inner('inner#2', '子条件2')] }),
      node('c', { status: 'unknown', branchPath: [outer('outer#2', '疑难')] }),
    ];
    const grouped = groupUnknownBranches(nodes);
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0].gatewayKey).toBe('outer');
    expect(grouped.groups[0].rows[0].nodes.map((n) => n.nodeKey)).toEqual(['a', 'b']);
    expect(grouped.groups[0].rows[1].nodes.map((n) => n.nodeKey)).toEqual(['c']);
  });
});

describe('branchChainText', () => {
  it('标注办理 / 抄送 / 子流程 / 自选 / 自动动作等节点类型', () => {
    const text = branchChainText([
      node('审批'),
      node('办理', { nodeType: 'handler' }),
      node('抄送', { nodeType: 'ccNode' }),
      node('子流程', { nodeType: 'subProcess' }),
      node('自选', { selectionRequired: true }),
      node('自动', { automaticAction: 'approve' }),
    ].map((n, index) => ({ ...n, nodeKey: `${index}` })));
    expect(text).toBe('审批 → 办理 → 抄送（抄送） → 子流程（子流程） → 自选（自选审批人） → 自动（自动通过）');
  });

  it('超长链路折叠尾部节点数', () => {
    const nodes = Array.from({ length: 9 }, (_, index) => node(`n${index}`));
    expect(branchChainText(nodes, 3)).toBe('n0 → n1 → n2 → 等 9 个节点');
  });
});
