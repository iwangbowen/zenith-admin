import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
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

  it('contains: substring check', () => {
    expect(evaluateCondition({ field: 'reason', operator: 'contains', value: '请假' }, { reason: '因事请假' })).toBe(true);
    expect(evaluateCondition({ field: 'reason', operator: 'contains', value: '请假' }, { reason: '出差' })).toBe(false);
  });

  it('handles null/undefined field values', () => {
    expect(evaluateCondition({ field: 'x', operator: 'eq', value: '' }, {})).toBe(true);
    expect(evaluateCondition({ field: 'x', operator: 'gt', value: 0 }, {})).toBe(false);
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
});

// ─── 测试抄送节点 ────────────────────────────────────────────────────────────

describe('advanceFlow - cc node', () => {
  it('creates cc tasks and continues to end', () => {
    const flow = makeCcFlow();
    const result = advanceFlow(flow, 'a1', {}, new Set(['start', 'a1']));
    // Should create 2 CC tasks + finish
    const ccTasks = result.tasksToCreate.filter(t => t.nodeType === 'ccNode');
    expect(ccTasks).toHaveLength(2);
    expect(ccTasks[0].assigneeId).toBe(50);
    expect(ccTasks[1].assigneeId).toBe(51);
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
});
