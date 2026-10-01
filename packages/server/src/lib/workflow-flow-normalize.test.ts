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

// ─── 设计器树：画布渲染读 process.initiator 链，运行时读扁平 nodes ─────────────────

const processFlow = () => ({
  nodes: [
    { id: 'start', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
  ],
  process: {
    initiator: {
      id: 'i1',
      type: 'initiator',
      name: '发起人',
      props: {},
      children: {
        id: 'a1',
        type: 'approver',
        name: '法务审批',
        props: { assigneeType: 'user', userIds: [17, 13] },
        children: {
          id: 'br1',
          type: 'conditionBranch',
          name: '金额分支',
          props: {},
          branches: [
            {
              id: 'b1',
              name: '大额',
              children: { id: 'c1', type: 'approver', name: '总经理审批', props: { assigneeType: 'user', userIds: [13], assigneeIds: [11] } },
            },
            {
              id: 'b2',
              name: '其它情况',
              isDefault: true,
              children: { id: 'd1', type: 'cc', name: '抄送行政', props: { assigneeType: 'user', userIds: [21] } },
            },
          ],
          children: { id: 'm1', type: 'approver', name: '主管审批', props: { assigneeType: 'manager', managerLevel: 2 } },
        },
      },
    },
  },
});

interface ProcessNodeShape {
  props: Record<string, unknown>;
  children?: ProcessNodeShape;
  branches?: Array<{ children?: ProcessNodeShape }>;
}

function processRoot(flowData: unknown): ProcessNodeShape {
  return (flowData as { process: { initiator: ProcessNodeShape } }).process.initiator;
}

describe('设计器 process 树归一', () => {
  it('树形 props 的 userIds 合并进 assigneeIds 并删除（含分支内节点）', () => {
    const root = processRoot(normalizeDefinitionFlowData(processFlow()));
    const legal = root.children; // 法务审批
    expect(legal?.props.assigneeIds).toEqual([17, 13]);
    expect(legal?.props.userIds).toBeUndefined();
    const branchNode = legal?.children; // 条件分支
    // 分支内：assigneeIds 优先，userIds 合并去重
    expect(branchNode?.branches?.[0].children?.props.assigneeIds).toEqual([11, 13]);
    expect(branchNode?.branches?.[0].children?.props.userIds).toBeUndefined();
    expect(branchNode?.branches?.[1].children?.props.assigneeIds).toEqual([21]);
    // 非「指定成员」来源不受影响
    expect(branchNode?.children?.props.assigneeIds).toBeUndefined();
  });

  it('幂等：对含 process 树的 flowData 重复调用结果不变', () => {
    const once = normalizeDefinitionFlowData(processFlow());
    expect(normalizeDefinitionFlowData(once)).toEqual(once);
  });

  it('收集指定成员 id 覆盖树形节点（原始 userIds 与归一后均可）', () => {
    const expectIds = (data: unknown) => expect(collectFlowAssigneeIds(data).sort((a, b) => a - b)).toEqual([11, 13, 17, 21]);
    expectIds(processFlow());
    expectIds(normalizeDefinitionFlowData(processFlow()));
  });

  it('补写姓名覆盖树形节点，按 id 顺序一一对应', () => {
    const names = new Map([[11, '陈国栋'], [13, '刘会计'], [17, '张律师'], [21, '郑香']]);
    const root = processRoot(applyFlowAssigneeNames(normalizeDefinitionFlowData(processFlow()), names));
    expect(root.children?.props.assigneeNames).toEqual(['张律师', '刘会计']);
    const branchNode = root.children?.children;
    expect(branchNode?.branches?.[0].children?.props.assigneeNames).toEqual(['陈国栋', '刘会计']);
    expect(branchNode?.branches?.[1].children?.props.assigneeNames).toEqual(['郑香']);
    // 主管来源不写姓名（画布按 managerLevel 渲染）
    expect(branchNode?.children?.props.assigneeNames).toBeUndefined();
  });
});
