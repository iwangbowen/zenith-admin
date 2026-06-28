import { describe, it, expect, beforeEach } from 'vitest';
import { advanceTokens, type TokenSnapshot, type AdvanceTokensResult } from './workflow-token-engine';
import type { WorkflowFlowData } from '@zenith/shared';

// ─── 测试基建：模拟 service 落库（消费 + 分配 id） ──────────────────────────────
let idSeq = 1;
let branchSeq = 0;
const genBranchId = () => `g${branchSeq++}`;

beforeEach(() => {
  idSeq = 1;
  branchSeq = 0;
});

/** 应用一次 advance 的 token 操作，返回新的 live token 集合（模拟持久化分配 id） */
function applyOps(live: TokenSnapshot[], res: AdvanceTokensResult): TokenSnapshot[] {
  const consumed = new Set(res.ops.consume);
  const remaining = live.filter((t) => !consumed.has(t.id));
  const created = res.ops.create.map((c) => ({ id: idSeq++, nodeKey: c.nodeKey, branchPath: c.branchPath }));
  return [...remaining, ...created];
}

function tokenAt(live: TokenSnapshot[], nodeKey: string): TokenSnapshot {
  const t = live.find((x) => x.nodeKey === nodeKey);
  if (!t) throw new Error(`no token at ${nodeKey}; live=${live.map((l) => l.nodeKey).join(',')}`);
  return t;
}

function seed(flowData: WorkflowFlowData, formData: Record<string, unknown> = {}): { res: AdvanceTokensResult; live: TokenSnapshot[] } {
  const res = advanceTokens({ flowData, formData, liveTokens: [], trigger: { type: 'seed' }, genBranchId });
  return { res, live: applyOps([], res) };
}

function advance(
  flowData: WorkflowFlowData,
  live: TokenSnapshot[],
  nodeKey: string,
  formData: Record<string, unknown> = {},
): { res: AdvanceTokensResult; live: TokenSnapshot[] } {
  const tk = tokenAt(live, nodeKey);
  const res = advanceTokens({
    flowData,
    formData,
    liveTokens: live,
    trigger: { type: 'advance', tokenId: tk.id, nodeKey: tk.nodeKey, branchPath: tk.branchPath },
    genBranchId,
  });
  return { res, live: applyOps(live, res) };
}

// ─── Flow builders ───────────────────────────────────────────────────────────
function makeLinearFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '主管', assigneeId: 10 } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a2', type: 'approve', label: '总监', assigneeId: 20 } },
      { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

function makeExclusiveFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'gw1', type: 'exclusiveGateway', label: '金额' } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a-director', type: 'approve', label: '总监', assigneeId: 20 } },
      { id: 'n4', position: { x: 2, y: 1 }, data: { key: 'a-manager', type: 'approve', label: '主管', assigneeId: 10, isDefault: true } },
      { id: 'n5', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', condition: { field: 'amount', operator: 'gt', value: 1000 } },
      { id: 'e3', source: 'n2', target: 'n4' },
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n5' },
    ],
  };
}

function makeParallelFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'nf', position: { x: 1, y: 0 }, data: { key: 'fork1', type: 'parallelGateway', label: '分叉' } },
      { id: 'nfin', position: { x: 2, y: 0 }, data: { key: 'a-finance', type: 'approve', label: '财务', assigneeId: 30 } },
      { id: 'nleg', position: { x: 2, y: 1 }, data: { key: 'a-legal', type: 'approve', label: '法务', assigneeId: 40 } },
      { id: 'nj', position: { x: 3, y: 0 }, data: { key: 'join1', type: 'parallelGateway', label: '汇聚' } },
      { id: 'ne', position: { x: 4, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'nf' },
      { id: 'e2', source: 'nf', target: 'nfin' },
      { id: 'e3', source: 'nf', target: 'nleg' },
      { id: 'e4', source: 'nfin', target: 'nj' },
      { id: 'e5', source: 'nleg', target: 'nj' },
      { id: 'e6', source: 'nj', target: 'ne' },
    ],
  };
}

// fork 直连 join 的空分支：branch B 从 fork 直接到 join
function makeEmptyBranchParallelFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'nf', position: { x: 1, y: 0 }, data: { key: 'fork1', type: 'parallelGateway', label: '分叉' } },
      { id: 'na', position: { x: 2, y: 0 }, data: { key: 'a-only', type: 'approve', label: '唯一审批', assigneeId: 30 } },
      { id: 'nj', position: { x: 3, y: 0 }, data: { key: 'join1', type: 'parallelGateway', label: '汇聚' } },
      { id: 'ne', position: { x: 4, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'nf' },
      { id: 'e2', source: 'nf', target: 'na' },
      { id: 'e3', source: 'nf', target: 'nj' }, // 空分支：fork → join 直连
      { id: 'e4', source: 'na', target: 'nj' },
      { id: 'e5', source: 'nj', target: 'ne' },
    ],
  };
}

function makeInclusiveFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'nf', position: { x: 1, y: 0 }, data: { key: 'fork1', type: 'inclusiveGateway', label: '包容分叉' } },
      { id: 'nfin', position: { x: 2, y: 0 }, data: { key: 'a-fin', type: 'approve', label: '财务', assigneeId: 30 } },
      { id: 'nleg', position: { x: 2, y: 1 }, data: { key: 'a-leg', type: 'approve', label: '法务', assigneeId: 40 } },
      { id: 'nj', position: { x: 3, y: 0 }, data: { key: 'join1', type: 'inclusiveGateway', label: '包容汇聚' } },
      { id: 'ne', position: { x: 4, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'nf' },
      { id: 'e2', source: 'nf', target: 'nfin', condition: { field: 'needFin', operator: 'eq', value: 'true' } },
      { id: 'e3', source: 'nf', target: 'nleg', condition: { field: 'needLegal', operator: 'eq', value: 'true' } },
      { id: 'e4', source: 'nfin', target: 'nj' },
      { id: 'e5', source: 'nleg', target: 'nj' },
      { id: 'e6', source: 'nj', target: 'ne' },
    ],
  };
}

// 嵌套并行：F1 → [A, F2]; F2 → [B, C] → J2 → J1; A → J1 → end
function makeNestedParallelFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'nf1', position: { x: 1, y: 0 }, data: { key: 'F1', type: 'parallelGateway', label: 'F1' } },
      { id: 'na', position: { x: 2, y: 0 }, data: { key: 'A', type: 'approve', label: 'A', assigneeId: 10 } },
      { id: 'nf2', position: { x: 2, y: 1 }, data: { key: 'F2', type: 'parallelGateway', label: 'F2' } },
      { id: 'nb', position: { x: 3, y: 1 }, data: { key: 'B', type: 'approve', label: 'B', assigneeId: 11 } },
      { id: 'nc', position: { x: 3, y: 2 }, data: { key: 'C', type: 'approve', label: 'C', assigneeId: 12 } },
      { id: 'nj2', position: { x: 4, y: 1 }, data: { key: 'J2', type: 'parallelGateway', label: 'J2' } },
      { id: 'nj1', position: { x: 5, y: 0 }, data: { key: 'J1', type: 'parallelGateway', label: 'J1' } },
      { id: 'ne', position: { x: 6, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'nf1' },
      { id: 'e2', source: 'nf1', target: 'na' },
      { id: 'e3', source: 'nf1', target: 'nf2' },
      { id: 'e4', source: 'nf2', target: 'nb' },
      { id: 'e5', source: 'nf2', target: 'nc' },
      { id: 'e6', source: 'nb', target: 'nj2' },
      { id: 'e7', source: 'nc', target: 'nj2' },
      { id: 'e8', source: 'nj2', target: 'nj1' },
      { id: 'e9', source: 'na', target: 'nj1' },
      { id: 'e10', source: 'nj1', target: 'ne' },
    ],
  };
}

function makeLoopBackParallelFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'ngw', position: { x: 1, y: 0 }, data: { key: 'gw', type: 'parallelGateway', label: '网关' } },
      { id: 'nA', position: { x: 2, y: 0 }, data: { key: 'a-loop', type: 'approve', label: 'A', assigneeId: 10 } },
      { id: 'nB', position: { x: 2, y: 1 }, data: { key: 'b-loop', type: 'approve', label: 'B', assigneeId: 11 } },
      { id: 'nEnd', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'ngw' },
      { id: 'e2', source: 'ngw', target: 'nA' },
      { id: 'e3', source: 'ngw', target: 'nB' },
      { id: 'e4', source: 'nA', target: 'nEnd' },
      { id: 'e5', source: 'nB', target: 'ngw' },
    ],
  };
}

function makeAutoApproveChainFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'auto1', type: 'approve', label: '自动通过', approvalType: 'autoApprove' } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'a2', type: 'approve', label: '人工', assigneeId: 20 } },
      { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

function makeWaitFlow(kind: 'delay' | 'subProcess'): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'w1', type: kind, label: kind, ...(kind === 'subProcess' ? { subProcessDefinitionId: 5 } : {}) } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
  };
}

function makeCcFlow(): WorkflowFlowData {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
      { id: 'n2', position: { x: 1, y: 0 }, data: { key: 'a1', type: 'approve', label: '主管', assigneeId: 10 } },
      { id: 'n3', position: { x: 2, y: 0 }, data: { key: 'cc1', type: 'ccNode', label: '抄送', assigneeIds: [50] } },
      { id: 'n4', position: { x: 3, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('advanceTokens - linear', () => {
  it('seeds a single frontier token at first approve', () => {
    const { res, live } = seed(makeLinearFlow());
    expect(res.tasksToCreate.map((t) => t.nodeKey)).toEqual(['a1']);
    expect(res.activeNodeKeys).toEqual(['a1']);
    expect(res.finished).toBe(false);
    expect(live.map((t) => t.nodeKey)).toEqual(['a1']);
    expect(live[0].branchPath).toEqual([]);
  });

  it('advances through approvals to finish', () => {
    const s = seed(makeLinearFlow());
    const r1 = advance(makeLinearFlow(), s.live, 'a1');
    expect(r1.res.tasksToCreate.map((t) => t.nodeKey)).toEqual(['a2']);
    expect(r1.live.map((t) => t.nodeKey)).toEqual(['a2']);
    const r2 = advance(makeLinearFlow(), r1.live, 'a2');
    expect(r2.res.finished).toBe(true);
    expect(r2.live.length).toBe(0); // 全部消费
  });
});

describe('advanceTokens - exclusive gateway', () => {
  it('routes by condition', () => {
    const hi = seed(makeExclusiveFlow(), { amount: 5000 });
    expect(hi.res.activeNodeKeys).toEqual(['a-director']);
    const lo = seed(makeExclusiveFlow(), { amount: 500 });
    expect(lo.res.activeNodeKeys).toEqual(['a-manager']);
  });
});

describe('advanceTokens - parallel fork/join', () => {
  it('forks into two frontier tokens with branch frames', () => {
    const { res, live } = seed(makeParallelFlow());
    expect(res.activeNodeKeys.sort()).toEqual(['a-finance', 'a-legal']);
    expect(live.length).toBe(2);
    // 两个 token 同组、index 0/1、total 2
    const fin = tokenAt(live, 'a-finance');
    const leg = tokenAt(live, 'a-legal');
    expect(fin.branchPath.length).toBe(1);
    expect(fin.branchPath[0].total).toBe(2);
    expect(leg.branchPath[0].id).toBe(fin.branchPath[0].id);
    expect(new Set([fin.branchPath[0].index, leg.branchPath[0].index])).toEqual(new Set([0, 1]));
  });

  it('does NOT finish when only one branch completes (join parks)', () => {
    const s = seed(makeParallelFlow());
    const r1 = advance(makeParallelFlow(), s.live, 'a-finance');
    expect(r1.res.finished).toBe(false);
    // 法务 frontier 仍在 + join 处 parked token
    expect(r1.live.some((t) => t.nodeKey === 'a-legal')).toBe(true);
    expect(r1.live.some((t) => t.nodeKey === 'join1')).toBe(true);
  });

  it('finishes when all branches complete at join', () => {
    const s = seed(makeParallelFlow());
    const r1 = advance(makeParallelFlow(), s.live, 'a-finance');
    expect(r1.res.finished).toBe(false);
    const r2 = advance(makeParallelFlow(), r1.live, 'a-legal');
    expect(r2.res.finished).toBe(true);
    expect(r2.live.length).toBe(0);
  });
});

describe('advanceTokens - empty branch (fork→join direct)', () => {
  it('parks the empty branch at seed and finishes when the real branch completes', () => {
    const { res, live } = seed(makeEmptyBranchParallelFlow());
    // 一个 frontier（a-only）+ 一个 parked（join1，空分支直达）
    expect(res.activeNodeKeys).toEqual(['a-only']);
    expect(live.some((t) => t.nodeKey === 'join1')).toBe(true);
    const r = advance(makeEmptyBranchParallelFlow(), live, 'a-only');
    expect(r.res.finished).toBe(true);
    expect(r.live.length).toBe(0);
  });
});

describe('advanceTokens - inclusive gateway (partial fork)', () => {
  it('only forks matched branches and joins on matched count', () => {
    const s = seed(makeInclusiveFlow(), { needFin: 'true', needLegal: 'false' });
    expect(s.res.activeNodeKeys).toEqual(['a-fin']);
    expect(s.live.filter((t) => t.nodeKey !== 'a-fin').length).toBe(0); // 无 parked，单分支
    const r = advance(makeInclusiveFlow(), s.live, 'a-fin', { needFin: 'true', needLegal: 'false' });
    expect(r.res.finished).toBe(true);
  });

  it('forks both matched branches and waits for both', () => {
    const fd = { needFin: 'true', needLegal: 'true' };
    const s = seed(makeInclusiveFlow(), fd);
    expect(s.res.activeNodeKeys.sort()).toEqual(['a-fin', 'a-leg']);
    const r1 = advance(makeInclusiveFlow(), s.live, 'a-fin', fd);
    expect(r1.res.finished).toBe(false);
    const r2 = advance(makeInclusiveFlow(), r1.live, 'a-leg', fd);
    expect(r2.res.finished).toBe(true);
  });
});

describe('advanceTokens - nested parallel', () => {
  it('outer join waits for inner join to complete', () => {
    const flow = makeNestedParallelFlow();
    const s = seed(flow);
    expect(s.res.activeNodeKeys.sort()).toEqual(['A', 'B', 'C']);
    const r1 = advance(flow, s.live, 'A');
    expect(r1.res.finished).toBe(false);
    const r2 = advance(flow, r1.live, 'B');
    expect(r2.res.finished).toBe(false); // 内层 J2 未齐
    const r3 = advance(flow, r2.live, 'C');
    expect(r3.res.finished).toBe(true); // J2 齐 → 弹栈 → J1 齐 → end
    expect(r3.live.length).toBe(0);
  });
});

describe('advanceTokens - loop-back gateway safety', () => {
  it('forks (does not deadlock) on a multi-in/out gateway with a back-edge', () => {
    const { res } = seed(makeLoopBackParallelFlow());
    expect(res.activeNodeKeys.sort()).toEqual(['a-loop', 'b-loop']);
    expect(res.finished).toBe(false);
  });
});

describe('advanceTokens - auto nodes', () => {
  it('auto-approve node passes through to next frontier (inline)', () => {
    const { res } = seed(makeAutoApproveChainFlow());
    const auto = res.tasksToCreate.find((t) => t.nodeKey === 'auto1');
    expect(auto?.autoStatus).toBe('approved');
    expect(res.activeNodeKeys).toEqual(['a2']);
  });

  it('auto-reject node marks rejected', () => {
    const flow = makeAutoApproveChainFlow();
    flow.nodes[1].data.approvalType = 'autoReject';
    const { res } = seed(flow);
    expect(res.rejected).toBe(true);
    expect(res.activeNodeKeys).toEqual([]);
  });
});

describe('advanceTokens - waiting frontier nodes', () => {
  it('delay node creates a waiting frontier token and halts', () => {
    const { res, live } = seed(makeWaitFlow('delay'));
    expect(res.tasksToCreate.map((t) => t.nodeKey)).toEqual(['w1']);
    expect(res.finished).toBe(false);
    expect(live.map((t) => t.nodeKey)).toEqual(['w1']);
  });

  it('subProcess (waitChild) creates a waiting frontier token', () => {
    const { res, live } = seed(makeWaitFlow('subProcess'));
    expect(res.activeNodeKeys).toEqual(['w1']);
    expect(live.map((t) => t.nodeKey)).toEqual(['w1']);
  });
});

describe('advanceTokens - cc node', () => {
  it('emits a cc task and continues to end', () => {
    const s = seed(makeCcFlow());
    const r = advance(makeCcFlow(), s.live, 'a1');
    expect(r.res.tasksToCreate.some((t) => t.nodeKey === 'cc1')).toBe(true);
    expect(r.res.finished).toBe(true);
  });
});
