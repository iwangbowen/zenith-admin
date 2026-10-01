import { describe, expect, it } from 'vitest';
import { applyFlowAssigneeNames, collectFlowAssigneeIds, normalizeDefinitionFlowData } from './workflow-flow-normalize';

const flow = () => ({
  nodes: [
    { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'a', type: 'approve', label: '总经理审批', assigneeType: 'user', userIds: [11] } },
    { id: 'n2', position: { x: 0, y: 0 }, data: { key: 'b', type: 'approve', label: '会签', assigneeType: 'user', userIds: [17, 13], assigneeIds: [13] } },
    { id: 'n3', position: { x: 0, y: 0 }, data: { key: 'c', type: 'approve', label: '主管', assigneeType: 'manager', managerLevel: 1 } },
    { id: 'n4', position: { x: 0, y: 0 }, data: { key: 'd', type: 'ccNode', label: '抄送财务', assigneeType: 'user', assigneeIds: [13], assigneeNames: ['刘会计'] } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2', condition: { field: 'docType', operator: 'in', value: ['合同', '协议'] } },
    { id: 'e2', source: 'n2', target: 'n3', conditions: [{ type: 'and', rules: [{ field: 'amount', operator: 'in', value: [1, 2] }] }] },
  ],
});

describe('normalizeDefinitionFlowData', () => {
  it('把 userIds 归一到 assigneeIds（与原 assigneeIds 合并去重）并删除 userIds', () => {
    const out = normalizeDefinitionFlowData(flow()) as { nodes: Array<{ data: Record<string, unknown> }> };
    expect(out.nodes[0].data.assigneeIds).toEqual([11]);
    expect(out.nodes[0].data.userIds).toBeUndefined();
    // 合并 + 去重（13 同时出现在 userIds 与 assigneeIds）
    expect(out.nodes[1].data.assigneeIds).toEqual([13, 17]);
    expect(out.nodes[1].data.userIds).toBeUndefined();
  });

  it('条件值数组归一为逗号串（in/notIn 不再静默失效）', () => {
    const out = normalizeDefinitionFlowData(flow()) as {
      edges: Array<{
        condition?: { value?: unknown };
        conditions?: Array<{ rules: Array<{ value?: unknown }> }>;
      }>;
    };
    expect(out.edges[0].condition?.value).toBe('合同,协议');
    expect(out.edges[1].conditions?.[0].rules[0].value).toBe('1,2');
  });

  it('幂等：重复调用结果不变', () => {
    const once = normalizeDefinitionFlowData(flow());
    expect(normalizeDefinitionFlowData(once)).toEqual(once);
  });

  it('不改动非指定成员来源与非条件字段', () => {
    const out = normalizeDefinitionFlowData(flow()) as { nodes: Array<{ data: Record<string, unknown> }> };
    expect(out.nodes[2].data.assigneeIds).toBeUndefined();
    expect(out.nodes[3].data.assigneeNames).toEqual(['刘会计']);
  });
});

describe('collectFlowAssigneeIds / applyFlowAssigneeNames', () => {
  it('收集指定成员 id 并补写姓名（按 id 顺序一一对应）', () => {
    const normalized = normalizeDefinitionFlowData(flow());
    expect(collectFlowAssigneeIds(normalized).sort((a, b) => a - b)).toEqual([11, 13, 17]);
    const named = applyFlowAssigneeNames(normalized, new Map([[11, '陈国栋'], [13, '刘会计'], [17, '张律师']])) as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    expect(named.nodes[0].data.assigneeNames).toEqual(['陈国栋']);
    expect(named.nodes[1].data.assigneeNames).toEqual(['刘会计', '张律师']);
    // 非指定成员节点不写入姓名
    expect(named.nodes[2].data.assigneeNames).toBeUndefined();
  });

  it('可直接对未归一的原始 flowData 收集 id（历史 userIds 写法）', () => {
    // 服务端写入收口先收集 id 再归一，因此必须容忍只剩 userIds 的旧数据
    expect(collectFlowAssigneeIds(flow()).sort((a, b) => a - b)).toEqual([11, 13, 17]);
    const named = applyFlowAssigneeNames(normalizeDefinitionFlowData(flow()), new Map([[11, '陈国栋']])) as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    expect(named.nodes[0].data.assigneeNames).toEqual(['陈国栋']);
  });

  it('查不到的成员退化为 用户#id，保证姓名与 id 不错位', () => {
    const named = applyFlowAssigneeNames(normalizeDefinitionFlowData(flow()), new Map([[11, '陈国栋']])) as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    expect(named.nodes[1].data.assigneeNames).toEqual(['用户#13', '用户#17']);
  });
});
