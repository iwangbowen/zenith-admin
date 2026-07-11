import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  evaluateConditionGroups,
  validateFlowData,
  getAncestorNodeKeys,
  findReturnPrevTarget,
  resolveRuntimeApproveMethod,
  normalizeFlowData,
} from './workflow-engine';
import type { WorkflowFlowData } from '@zenith/shared';
import { WORKFLOW_SCHEMA_VERSION } from '@zenith/shared';

// 说明：DAG 推进（advanceFlow/getInitialTasks）已被显式执行 Token 引擎取代，
// fork/join/网关/自动节点/回边等推进语义的回归测试见 workflow-token-engine.test.ts。
// 本文件仅覆盖仍由 workflow-engine.ts 导出的纯工具：条件求值 / 结构校验 / 祖先与退回目标。

// ─── Helper: 线性流程 ──────────────────────────────────────────────────────────
function makeLinearFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '主管审批', assigneeId: 10 } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a2', type: 'approve', label: '总监审批', assigneeId: 20 } },
      { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

// ─── Helper: 排他网关流程 ──────────────────────────────────────────────────────
function makeExclusiveFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'gw1', type: 'exclusiveGateway', label: '金额判断' } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a-director', type: 'approve', label: '总监审批', assigneeId: 20 } },
      { id: 'n4', position: { x: 2, y: 1 }, data: { key: 'a-manager', type: 'approve', label: '主管审批', assigneeId: 10, isDefault: true } },
      { id: 'n5', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', condition: { field: 'amount', operator: 'gt', value: 1000 } },
      { id: 'e3', source: 'n2', target: 'n4' }, // default (no condition)
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n5' },
    ],
  };
}

// ─── Helper: 分支流程（祖先选择/退回上一步） ────────────────────────────────────
//  start ─→ A ─→ B ─→ C ─→ end   （C 的上游祖先链：B、A、start）
//        └→ D ─────────→ end      （D 为另一分支，非 C 的祖先）
function makeBranchedFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'nA', position: { x: 1, y: 0 }, data: { key: 'a', type: 'approve', label: 'A', assigneeId: 10 } },
      { id: 'nB', position: { x: 2, y: 0 }, data: { key: 'b', type: 'approve', label: 'B', assigneeId: 11 } },
      { id: 'nC', position: { x: 3, y: 0 }, data: { key: 'c', type: 'approve', label: 'C', assigneeId: 12 } },
      { id: 'nD', position: { x: 1, y: 1 }, data: { key: 'd', type: 'approve', label: 'D', assigneeId: 13 } },
      { id: 'nEnd', position: { x: 4, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'nA' },
      { id: 'e2', source: 'nA', target: 'nB' },
      { id: 'e3', source: 'nB', target: 'nC' },
      { id: 'e4', source: 'nC', target: 'nEnd' },
      { id: 'e5', source: 'n1', target: 'nD' },
      { id: 'e6', source: 'nD', target: 'nEnd' },
    ],
  };
}

/** 构造一个含 subProcess 节点的最小可校验流程 */
function makeSubProcessFlow(spData: Record<string, unknown>): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'sp', type: 'subProcess', label: '子流程', ...spData } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批', assigneeId: 1 } },
      { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

// ─── 测试 evaluateCondition ──────────────────────────────────────────────────
describe('evaluateCondition', () => {
  it('eq: matches equal values', () => {
    expect(evaluateCondition({ field: 'type', operator: 'eq', value: 'leave' }, { type: 'leave' })).toBe(true);
    expect(evaluateCondition({ field: 'type', operator: 'eq', value: 'leave' }, { type: 'travel' })).toBe(false);
  });

  it('neq: matches not equal', () => {
    expect(evaluateCondition({ field: 'type', operator: 'neq', value: 'leave' }, { type: 'travel' })).toBe(true);
    expect(evaluateCondition({ field: 'type', operator: 'neq', value: 'leave' }, { type: 'leave' })).toBe(false);
  });

  it('gt / gte / lt / lte: numeric comparison', () => {
    const data = { amount: 5000 };
    expect(evaluateCondition({ field: 'amount', operator: 'gt', value: 1000 }, data)).toBe(true);
    expect(evaluateCondition({ field: 'amount', operator: 'gt', value: 5000 }, data)).toBe(false);
    expect(evaluateCondition({ field: 'amount', operator: 'gte', value: 5000 }, data)).toBe(true);
    expect(evaluateCondition({ field: 'amount', operator: 'lt', value: 10000 }, data)).toBe(true);
    expect(evaluateCondition({ field: 'amount', operator: 'lte', value: 5000 }, data)).toBe(true);
  });

  it('in: checks comma-separated list', () => {
    expect(evaluateCondition({ field: 'dept', operator: 'in', value: '技术,产品,设计' }, { dept: '技术' })).toBe(true);
    expect(evaluateCondition({ field: 'dept', operator: 'in', value: '技术,产品,设计' }, { dept: '销售' })).toBe(false);
  });

  it('in / notIn: supports a single numeric value target', () => {
    expect(evaluateCondition({ field: 'level', operator: 'in', value: 3 }, { level: 3 })).toBe(true);
    expect(evaluateCondition({ field: 'level', operator: 'in', value: 3 }, { level: '3' })).toBe(true);
    expect(evaluateCondition({ field: 'level', operator: 'in', value: 3 }, { level: 4 })).toBe(false);
    expect(evaluateCondition({ field: 'level', operator: 'notIn', value: 3 }, { level: 4 })).toBe(true);
    expect(evaluateCondition({ field: 'level', operator: 'notIn', value: 3 }, { level: 3 })).toBe(false);
  });

  it('contains: substring check', () => {
    expect(evaluateCondition({ field: 'reason', operator: 'contains', value: '请假' }, { reason: '因事请假' })).toBe(true);
    expect(evaluateCondition({ field: 'reason', operator: 'contains', value: '请假' }, { reason: '出差' })).toBe(false);
  });

  it('does not stringify complex object values for scalar comparisons', () => {
    const formData = { payload: { status: 'approved' }, rows: [{ amount: 1 }] };
    expect(evaluateCondition({ field: 'payload', operator: 'eq', value: '{"status":"approved"}' }, formData)).toBe(false);
    expect(evaluateCondition({ field: 'payload', operator: 'neq', value: '{"status":"approved"}' }, formData)).toBe(false);
    expect(evaluateCondition({ field: 'rows', operator: 'contains', value: '{"amount":1}' }, formData)).toBe(false);
  });

  it('supports explicit collection operators for primitive arrays', () => {
    const formData = { tags: ['urgent', 'finance'] };
    expect(evaluateCondition({ field: 'tags', operator: 'contains', value: 'urgent' }, formData)).toBe(true);
    expect(evaluateCondition({ field: 'tags', operator: 'in', value: 'legal,finance' }, formData)).toBe(true);
    expect(evaluateCondition({ field: 'tags', operator: 'notIn', value: 'legal,hr' }, formData)).toBe(true);
  });

  it('handles null/undefined field values', () => {
    expect(evaluateCondition({ field: 'x', operator: 'eq', value: '' }, {})).toBe(true);
    expect(evaluateCondition({ field: 'x', operator: 'gt', value: 0 }, {})).toBe(false);
  });
});

describe('evaluateConditionGroups', () => {
  it('matches any group and respects each group logic', () => {
    const groups = [
      {
        type: 'and' as const,
        rules: [
          { field: 'amount', operator: 'gte' as const, value: 1000 },
          { field: 'dept', operator: 'eq' as const, value: '财务' },
        ],
      },
      {
        type: 'or' as const,
        rules: [
          { field: 'urgent', operator: 'eq' as const, value: true },
          { field: 'level', operator: 'gte' as const, value: 3 },
        ],
      },
    ];

    expect(evaluateConditionGroups(groups, { amount: 1200, dept: '财务', urgent: false, level: 1 })).toBe(true);
    expect(evaluateConditionGroups(groups, { amount: 200, dept: '行政', urgent: false, level: 4 })).toBe(true);
    expect(evaluateConditionGroups(groups, { amount: 200, dept: '行政', urgent: false, level: 1 })).toBe(false);
  });
});

// ─── 测试 validateFlowData ──────────────────────────────────────────────────
describe('validateFlowData', () => {
  it('validates a valid linear flow', () => {
    const result = validateFlowData(makeLinearFlow());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports missing start node', () => {
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批' } },
        { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('开始'))).toBe(true);
  });

  it('reports missing end node', () => {
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } },
        { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('结束'))).toBe(true);
  });

  it('reports missing approve node', () => {
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } },
        { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('审批'))).toBe(true);
  });

  it('reports unreachable nodes', () => {
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } },
        { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批' } },
        { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
        { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'a2', type: 'approve', label: '孤立节点' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    };
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('孤立节点'))).toBe(true);
  });

  it('reports malformed topology before publish', () => {
    const flow = makeLinearFlow();
    flow.nodes.push({ id: 'n2', position: { x: 9, y: 9 }, data: { key: 'duplicate-id', type: 'approve', label: '重复 ID', assigneeId: 1 } });
    flow.edges.push({ id: 'broken-edge', source: 'n-missing', target: 'n3' });

    const result = validateFlowData(flow);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('节点 ID"n2"重复'))).toBe(true);
    expect(result.errors.some(e => e.includes('起点节点不存在'))).toBe(true);
  });

  it('accepts terminating exception catch nodes without requiring normal-path reachability', () => {
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } },
        { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批', assigneeId: 1 } },
        { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
        { id: 'n4', position: { x: 1, y: 1 }, data: { key: 'catch', type: 'catchNode', label: '异常捕获', catchAction: 'terminate' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e-catch', source: 'n2', target: 'n4', isException: true },
      ],
    };

    const result = validateFlowData(flow);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts exception recovery paths even when they are not on the normal path', () => {
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } },
        { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批', assigneeId: 1 } },
        { id: 'n3', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
        { id: 'n4', position: { x: 1, y: 1 }, data: { key: 'catch', type: 'catchNode', label: '异常捕获', catchAction: 'toAdmin' } },
        { id: 'n5', position: { x: 2, y: 1 }, data: { key: 'recover', type: 'approve', label: '恢复审批', assigneeId: 2 } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e-catch', source: 'n2', target: 'n4', isException: true },
        { id: 'e-recover', source: 'n4', target: 'n5' },
        { id: 'e-recover-end', source: 'n5', target: 'n3' },
      ],
    };

    const result = validateFlowData(flow);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports catch nodes without an exception inbound edge', () => {
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } },
        { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批', assigneeId: 1 } },
        { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
        { id: 'n4', position: { x: 1, y: 1 }, data: { key: 'catch', type: 'catchNode', label: '异常捕获' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    };

    const result = validateFlowData(flow);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('异常入边'))).toBe(true);
  });

  it('reports exclusive gateway without conditions', () => {
    const flow = makeExclusiveFlow();
    flow.edges = flow.edges.map(e => ({ ...e, condition: undefined }));
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('条件'))).toBe(true);
  });

  it('reports gateway with multiple condition-less (default-like) branches', () => {
    const flow = makeExclusiveFlow();
    flow.nodes.push({ id: 'n6', position: { x: 2, y: 2 }, data: { key: 'a-extra', type: 'approve', label: '额外审批', assigneeId: 50 } });
    flow.edges.push({ id: 'e6', source: 'n2', target: 'n6' }); // 无条件、非默认
    flow.edges.push({ id: 'e7', source: 'n6', target: 'n5' });
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('条件'))).toBe(true);
  });

  it('reports subProcess node without a selected definition', () => {
    const flow = makeSubProcessFlow({});
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('未选择要调用的流程定义'))).toBe(true);
  });

  it('reports multi-instance subProcess without a loop source', () => {
    const flow = makeSubProcessFlow({ subProcessId: 7, subProcessMode: 'multi' });
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('循环数据源'))).toBe(true);
  });

  it('accepts a valid single subProcess and a valid multi subProcess', () => {
    const single = validateFlowData(makeSubProcessFlow({ subProcessId: 7 }));
    expect(single.errors.some(e => e.includes('子流程'))).toBe(false);
    const multi = validateFlowData(makeSubProcessFlow({ subProcessId: 7, subProcessMode: 'multi', subProcessMultiSource: 'items' }));
    expect(multi.errors.some(e => e.includes('子流程'))).toBe(false);
  });
});

// ─── 退回上一步：祖先选择（修复并行流程误选另一分支最近审批节点） ──────────────
describe('getAncestorNodeKeys', () => {
  it('returns only upstream ancestors of a node', () => {
    const anc = getAncestorNodeKeys(makeBranchedFlow(), 'c');
    expect(anc.has('b')).toBe(true);
    expect(anc.has('a')).toBe(true);
    expect(anc.has('start')).toBe(true);
    // D 在另一分支上，不是 C 的祖先
    expect(anc.has('d')).toBe(false);
  });

  it('returns empty set for unknown node', () => {
    expect(getAncestorNodeKeys(makeBranchedFlow(), 'nope').size).toBe(0);
  });
});

describe('findReturnPrevTarget', () => {
  const flow = makeBranchedFlow();

  it('prefers the nearest approved ancestor over a more-recent sibling-branch node', () => {
    // D 最近审批，但不在 C 的上游路径；应退回到祖先 B，而非 D
    expect(findReturnPrevTarget(flow, 'c', ['d', 'b', 'a'])).toBe('b');
  });

  it('falls back to most-recent when no approved ancestor exists', () => {
    expect(findReturnPrevTarget(flow, 'c', ['d'])).toBe('d');
  });

  it('returns null when there are no approved nodes', () => {
    expect(findReturnPrevTarget(flow, 'c', [])).toBeNull();
  });
});

describe('resolveRuntimeApproveMethod (设计态 → 运行态)', () => {
  it('passes through real persisted methods unchanged', () => {
    expect(resolveRuntimeApproveMethod('and', 3)).toBe('and');
    expect(resolveRuntimeApproveMethod('or', 2)).toBe('or');
    expect(resolveRuntimeApproveMethod('sequential', 2)).toBe('sequential');
    expect(resolveRuntimeApproveMethod('ratio', 2)).toBe('ratio');
  });

  it('downgrades random by approver count (random 随机挑一人后落库为 or)', () => {
    expect(resolveRuntimeApproveMethod('random', 3)).toBe('and'); // 原始多人 → 回退方式 and（落库随机退化为单人时再置 null）
    expect(resolveRuntimeApproveMethod('random', 1)).toBe('or');
  });

  it('treats auto / empty as count-based fallback', () => {
    expect(resolveRuntimeApproveMethod('auto', 2)).toBe('and');
    expect(resolveRuntimeApproveMethod('auto', 1)).toBe('or');
    expect(resolveRuntimeApproveMethod(null, 2)).toBe('and');
    expect(resolveRuntimeApproveMethod(undefined, 1)).toBe('or');
  });
});

describe('normalizeFlowData (schema 版本兼容迁移)', () => {
  const flow: WorkflowFlowData = {
    nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } }],
    edges: [],
  };

  it('is identity for the current schema version', () => {
    expect(normalizeFlowData(flow, WORKFLOW_SCHEMA_VERSION)).toBe(flow);
    expect(normalizeFlowData(flow)).toBe(flow);
  });

  it('returns current-schema flowData for older versions (v1 恒等)', () => {
    expect(normalizeFlowData(flow, 0)).toEqual(flow);
  });
});

