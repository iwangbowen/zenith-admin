import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  evaluateConditionGroups,
  advanceFlow,
  getInitialTasks,
  validateFlowData,
  getNodeOrder,
} from './workflow-engine';
import type { WorkflowFlowData } from '@zenith/shared';

// ─── Helper: 构建简单线性流程 ──────────────────────────────────────────────────

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

// ─── Helper: 构建排他网关流程 ──────────────────────────────────────────────────
//  start → exclusiveGateway → (金额>1000) → 总监审批 → end
//                           → (default)   → 主管审批 → end

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

// ─── Helper: 构建并行网关流程 ──────────────────────────────────────────────────
//  start → parallelGateway(fork) → 财务审批 → parallelGateway(join) → end
//                                → 法务审批 ↗

function makeParallelFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n-fork', position: { x: 1, y: 0 }, data: { key: 'fork1', type: 'parallelGateway', label: '并行分叉' } },
      { id: 'n-finance', position: { x: 2, y: 0 }, data: { key: 'a-finance', type: 'approve', label: '财务审批', assigneeId: 30 } },
      { id: 'n-legal', position: { x: 2, y: 1 }, data: { key: 'a-legal', type: 'approve', label: '法务审批', assigneeId: 40 } },
      { id: 'n-join', position: { x: 3, y: 0 }, data: { key: 'join1', type: 'parallelGateway', label: '并行汇聚' } },
      { id: 'n-end', position: { x: 4, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n-fork' },
      { id: 'e2', source: 'n-fork', target: 'n-finance' },
      { id: 'e3', source: 'n-fork', target: 'n-legal' },
      { id: 'e4', source: 'n-finance', target: 'n-join' },
      { id: 'e5', source: 'n-legal', target: 'n-join' },
      { id: 'e6', source: 'n-join', target: 'n-end' },
    ],
  };
}

// ─── Helper: 构建含抄送节点的流程 ──────────────────────────────────────────────

function makeCcFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '主管审批', assigneeId: 10 } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'cc1', type: 'ccNode', label: '抄送HR', assigneeIds: [50, 51], assigneeNames: ['HR1', 'HR2'] } },
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
    // 条件值为数字（非逗号串）时也应正确比对，而非恒不命中
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

// ─── 测试线性流程推进 ────────────────────────────────────────────────────────

describe('advanceFlow - linear', () => {
  it('advances from start to first approve', () => {
    const flow = makeLinearFlow();
    const result = getInitialTasks(flow);
    expect(result.finished).toBe(false);
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0].nodeKey).toBe('a1');
    expect(result.tasksToCreate[0].assigneeId).toBe(10);
  });

  it('advances from first approve to second approve', () => {
    const flow = makeLinearFlow();
    const result = advanceFlow(flow, 'a1', {}, new Set(['start', 'a1']));
    expect(result.finished).toBe(false);
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0].nodeKey).toBe('a2');
    expect(result.tasksToCreate[0].assigneeId).toBe(20);
  });

  it('finishes after last approve', () => {
    const flow = makeLinearFlow();
    const result = advanceFlow(flow, 'a2', {}, new Set(['start', 'a1', 'a2']));
    expect(result.finished).toBe(true);
    expect(result.tasksToCreate).toHaveLength(0);
  });
});

// ─── 测试排他网关 ────────────────────────────────────────────────────────────

describe('advanceFlow - exclusive gateway', () => {
  it('routes to director when amount > 1000', () => {
    const flow = makeExclusiveFlow();
    const result = advanceFlow(flow, 'start', { amount: 5000 }, new Set(['start']));
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0].nodeKey).toBe('a-director');
    expect(result.tasksToCreate[0].assigneeId).toBe(20);
  });

  it('routes to manager (default) when amount <= 1000', () => {
    const flow = makeExclusiveFlow();
    const result = advanceFlow(flow, 'start', { amount: 500 }, new Set(['start']));
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0].nodeKey).toBe('a-manager');
    expect(result.tasksToCreate[0].assigneeId).toBe(10);
  });

  it('finishes after approve node', () => {
    const flow = makeExclusiveFlow();
    const result = advanceFlow(flow, 'a-director', {}, new Set(['start', 'gw1', 'a-director']));
    expect(result.finished).toBe(true);
  });
});

// ─── 测试并行网关 ────────────────────────────────────────────────────────────

describe('advanceFlow - parallel gateway', () => {
  it('creates multiple tasks at fork', () => {
    const flow = makeParallelFlow();
    const result = getInitialTasks(flow);
    expect(result.tasksToCreate).toHaveLength(2);
    const keys = result.tasksToCreate.map(t => t.nodeKey).sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(['a-finance', 'a-legal']);
  });

  it('does not finish when only one branch is completed at join', () => {
    const flow = makeParallelFlow();
    const result = advanceFlow(flow, 'a-finance', {}, new Set(['start', 'fork1', 'a-finance']));
    // Should not advance past join because a-legal is not complete
    expect(result.finished).toBe(false);
    expect(result.tasksToCreate).toHaveLength(0);
  });

  it('finishes when all branches are completed at join', () => {
    const flow = makeParallelFlow();
    const result = advanceFlow(flow, 'a-legal', {}, new Set(['start', 'fork1', 'a-finance', 'a-legal']));
    expect(result.finished).toBe(true);
  });

  it('does not block the join when one parallel branch is empty (fork→join direct)', () => {
    // 一条分支有节点(a-finance)，另一条为空（fork-p1 直连 join-p1）
    const flow: WorkflowFlowData = {
      nodes: [
        { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
        { id: 'n-fork', position: { x: 1, y: 0 }, data: { key: 'fork-p1', type: 'parallelGateway', label: '并行分叉' } },
        { id: 'n-finance', position: { x: 2, y: 0 }, data: { key: 'a-finance', type: 'approve', label: '财务审批', assigneeId: 30 } },
        { id: 'n-join', position: { x: 3, y: 0 }, data: { key: 'join-p1', type: 'parallelGateway', label: '并行汇聚' } },
        { id: 'n-end', position: { x: 4, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n-fork' },
        { id: 'e2', source: 'n-fork', target: 'n-finance' },
        { id: 'e3', source: 'n-fork', target: 'n-join' }, // 空分支
        { id: 'e4', source: 'n-finance', target: 'n-join' },
        { id: 'e5', source: 'n-join', target: 'n-end' },
      ],
    };
    const init = getInitialTasks(flow);
    expect(init.tasksToCreate.map(t => t.nodeKey)).toContain('a-finance');
    expect(init.finished).toBe(false);
    // 财务审批完成后应能汇聚并结束（空分支不卡死）
    const result = advanceFlow(flow, 'a-finance', {}, new Set(['start', 'a-finance']));
    expect(result.finished).toBe(true);
  });
});

// ─── 测试抄送节点 ────────────────────────────────────────────────────────────

describe('advanceFlow - cc node', () => {
  it('creates a single cc task action and continues to end', () => {
    const flow = makeCcFlow();
    const result = advanceFlow(flow, 'a1', {}, new Set(['start', 'a1']));
    // 引擎只生成一个 ccNode 任务动作，由 expandTasksToRows 负责按 assigneeIds 解析展开
    const ccTasks = result.tasksToCreate.filter(t => t.nodeType === 'ccNode');
    expect(ccTasks).toHaveLength(1);
    expect(ccTasks[0].assigneeId).toBeNull();
    expect(ccTasks[0].nodeConfig.assigneeIds).toEqual([50, 51]);
    expect(result.finished).toBe(true);
  });
});

// ─── 测试 getNodeOrder（线性兼容） ───────────────────────────────────────────

describe('getNodeOrder', () => {
  it('returns nodes in topological order for linear flow', () => {
    const flow = makeLinearFlow();
    const order = getNodeOrder(flow);
    expect(order.map(n => n.key)).toEqual(['start', 'a1', 'a2', 'end']);
  });

  it('returns empty for flow without start node', () => {
    const flow: WorkflowFlowData = { nodes: [], edges: [] };
    expect(getNodeOrder(flow)).toEqual([]);
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

  it('reports exclusive gateway without conditions', () => {
    const flow = makeExclusiveFlow();
    // Remove condition from edges
    flow.edges = flow.edges.map(e => ({ ...e, condition: undefined }));
    const result = validateFlowData(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('条件'))).toBe(true);
  });

  it('reports gateway with multiple condition-less (default-like) branches', () => {
    const flow = makeExclusiveFlow();
    // 追加一个"无条件且非默认"的分支 → 出现两个默认分支（静默坑）
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

// ─── 测试 handler 节点（办理节点） ─────────────────────────────────────────────

function makeHandlerFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'h1', type: 'handler', label: '人工办理', assigneeId: 11 } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
  };
}

function makeRouteFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'rg', type: 'routeGateway', label: '路由' } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a-vip', type: 'approve', label: 'VIP审批', assigneeId: 30 } },
      { id: 'n4', position: { x: 2, y: 1 }, data: { key: 'a-normal', type: 'approve', label: '普通审批', assigneeId: 31, isDefault: true } },
      { id: 'n5', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', condition: { field: 'vip', operator: 'eq', value: 'true' } },
      { id: 'e3', source: 'n2', target: 'n4' },
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n5' },
    ],
  };
}

function makeCompoundConditionFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'gw', type: 'exclusiveGateway', label: '复合条件' } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a-hit', type: 'approve', label: '命中审批', assigneeId: 30 } },
      { id: 'n4', position: { x: 2, y: 1 }, data: { key: 'a-default', type: 'approve', label: '默认审批', assigneeId: 31 } },
      { id: 'n5', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      {
        id: 'e2',
        source: 'n2',
        target: 'n3',
        conditions: [{
          type: 'and',
          rules: [
            { field: 'amount', operator: 'gte', value: 1000 },
            { field: 'dept', operator: 'eq', value: '财务' },
          ],
        }],
      },
      { id: 'e3', source: 'n2', target: 'n4', isDefault: true },
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n5' },
    ],
  };
}

function makeInclusiveFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'fork', type: 'inclusiveGateway', label: '包容分叉' } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a-fin', type: 'approve', label: '财务', assigneeId: 40 } },
      { id: 'n4', position: { x: 2, y: 1 }, data: { key: 'a-legal', type: 'approve', label: '法务', assigneeId: 41 } },
      { id: 'n5', position: { x: 2, y: 2 }, data: { key: 'a-default', type: 'approve', label: '兜底', assigneeId: 42, isDefault: true } },
      { id: 'n6', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', condition: { field: 'needFin', operator: 'eq', value: 'true' } },
      { id: 'e3', source: 'n2', target: 'n4', condition: { field: 'needLegal', operator: 'eq', value: 'true' } },
      { id: 'e4', source: 'n2', target: 'n5' },
      { id: 'e5', source: 'n3', target: 'n6' },
      { id: 'e6', source: 'n4', target: 'n6' },
      { id: 'e7', source: 'n5', target: 'n6' },
    ],
  };
}

function makeAutoFlow(autoType: 'delay' | 'trigger' | 'subProcess'): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'auto', type: autoType, label: `自动-${autoType}` } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a1', type: 'approve', label: '审批', assigneeId: 99 } },
      { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

function makeAutoApprovalFlow(approvalType: 'autoApprove' | 'autoReject'): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'auto-approval', type: 'approve', label: '自动审批', approvalType } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a1', type: 'approve', label: '人工审批', assigneeId: 99 } },
      { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

describe('advanceFlow - handler node', () => {
  it('creates handler task at start', () => {
    const result = getInitialTasks(makeHandlerFlow());
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0].nodeKey).toBe('h1');
    expect(result.tasksToCreate[0].nodeType).toBe('handler');
  });

  it('finishes after handler complete', () => {
    const result = advanceFlow(makeHandlerFlow(), 'h1', {}, new Set(['start', 'h1']));
    expect(result.finished).toBe(true);
  });
});

describe('advanceFlow - route gateway', () => {
  it('routes by matching condition', () => {
    const result = advanceFlow(makeRouteFlow(), 'start', { vip: 'true' }, new Set(['start']));
    expect(result.tasksToCreate[0].nodeKey).toBe('a-vip');
  });

  it('falls back to default branch when no condition matches', () => {
    const result = advanceFlow(makeRouteFlow(), 'start', { vip: 'false' }, new Set(['start']));
    expect(result.tasksToCreate[0].nodeKey).toBe('a-normal');
  });
});

describe('advanceFlow - compound branch conditions', () => {
  it('routes by full condition groups instead of only the first rule', () => {
    const hit = advanceFlow(makeCompoundConditionFlow(), 'start', { amount: 1200, dept: '财务' }, new Set(['start']));
    expect(hit.tasksToCreate[0].nodeKey).toBe('a-hit');

    const miss = advanceFlow(makeCompoundConditionFlow(), 'start', { amount: 1200, dept: '行政' }, new Set(['start']));
    expect(miss.tasksToCreate[0].nodeKey).toBe('a-default');
  });
});

describe('advanceFlow - inclusive gateway', () => {
  it('forks into all matching branches', () => {
    const result = advanceFlow(makeInclusiveFlow(), 'start', { needFin: 'true', needLegal: 'true' }, new Set(['start']));
    const keys = result.tasksToCreate.map(t => t.nodeKey).sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(['a-fin', 'a-legal']);
  });

  it('forks into single matching branch', () => {
    const result = advanceFlow(makeInclusiveFlow(), 'start', { needFin: 'true', needLegal: 'false' }, new Set(['start']));
    expect(result.tasksToCreate.map(t => t.nodeKey)).toEqual(['a-fin']);
  });

  it('falls back to default when no condition matches', () => {
    const result = advanceFlow(makeInclusiveFlow(), 'start', { needFin: 'false', needLegal: 'false' }, new Set(['start']));
    expect(result.tasksToCreate.map(t => t.nodeKey)).toEqual(['a-default']);
  });
});

describe('advanceFlow - auto nodes (delay/trigger/subProcess)', () => {
  // trigger（非 callback）即时推进，自动到达下一个 approve
  it('auto-passes trigger node and reaches next approve', () => {
    const result = advanceFlow(makeAutoFlow('trigger'), 'start', {}, new Set(['start']));
    const approveTask = result.tasksToCreate.find(task => task.nodeKey === 'a1');
    expect(approveTask).toBeDefined();
    expect(approveTask?.assigneeId).toBe(99);
  });

  // delay 节点（feat b80d5cc1 delay-scheduler）：创建 waiting 任务并在此停止 BFS，
  // 由调度器在 wakeAt 唤醒后再推进，故本次不直接到达后续 approve
  it('delay node creates a waiting task and halts BFS (awaits scheduler)', () => {
    const result = advanceFlow(makeAutoFlow('delay'), 'start', {}, new Set(['start']));
    const delayTask = result.tasksToCreate.find(task => task.nodeKey === 'auto');
    expect(delayTask).toBeDefined();
    expect(delayTask?.nodeType).toBe('delay');
    expect(result.tasksToCreate.find(task => task.nodeKey === 'a1')).toBeUndefined();
  });

  // subProcess 节点（feat c8fd4273）默认 waitChild=true：创建子流程任务并等待子实例完成，
  // 故本次不直接到达后续 approve
  it('subProcess node (default waitChild) creates a task and awaits child instance', () => {
    const result = advanceFlow(makeAutoFlow('subProcess'), 'start', {}, new Set(['start']));
    const subTask = result.tasksToCreate.find(task => task.nodeKey === 'auto');
    expect(subTask).toBeDefined();
    expect(subTask?.nodeType).toBe('subProcess');
    expect(result.tasksToCreate.find(task => task.nodeKey === 'a1')).toBeUndefined();
  });

  // subProcess 异步（waitChild=false）：不阻塞，BFS 继续推进至后续 approve
  it('async subProcess node (waitChild=false) does not halt BFS and reaches next approve', () => {
    const flow = makeAutoFlow('subProcess');
    const sub = flow.nodes.find(n => n.data.key === 'auto');
    if (sub) sub.data.subProcessWaitChild = false;
    const result = advanceFlow(flow, 'start', {}, new Set(['start']));
    expect(result.tasksToCreate.find(task => task.nodeKey === 'auto')?.nodeType).toBe('subProcess');
    expect(result.tasksToCreate.find(task => task.nodeKey === 'a1')).toBeDefined();
  });
});

describe('advanceFlow - auto approval nodes', () => {
  it('returns an approved auto task without creating a manual current node', () => {
    const result = getInitialTasks(makeAutoApprovalFlow('autoApprove'));
    expect(result.rejected).toBe(false);
    expect(result.tasksToCreate).toHaveLength(1);
    expect(result.tasksToCreate[0]).toMatchObject({ nodeKey: 'auto-approval', autoStatus: 'approved' });
    expect(result.currentNodeKeys).toEqual([]);
  });

  it('marks the flow as rejected for auto reject nodes', () => {
    const result = getInitialTasks(makeAutoApprovalFlow('autoReject'));
    expect(result.rejected).toBe(true);
    expect(result.tasksToCreate[0]).toMatchObject({ nodeKey: 'auto-approval', autoStatus: 'rejected' });
  });
});
