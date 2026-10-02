import { describe, expect, it, vi } from 'vitest';
import { planWorkflowPath, selectWorkflowPathBranches } from './path-planner';
import type { WorkflowEdge, WorkflowFlowData, WorkflowFormField, WorkflowNodeConfig } from './types';

const node = (key: string, type: WorkflowNodeConfig['type'], extras: Partial<WorkflowNodeConfig> = {}): WorkflowFlowData['nodes'][number] => ({ id: key, position: { x: 0, y: 0 }, data: { key, type, label: key, ...extras } });
const edge = (source: string, target: string, extras: Partial<WorkflowEdge> = {}): WorkflowEdge => ({ id: source + '-' + target, source, target, ...extras });
const gt = (field: string, value: number) => ({ field, operator: 'gt' as const, value });
const status = (plan: ReturnType<typeof planWorkflowPath>, key: string) => plan.nodes.find(row => row.nodeKey === key)?.status;
const branch = (plan: ReturnType<typeof planWorkflowPath>, target: string) => plan.branches.find(row => row.target === target)?.status;
const financialFields: WorkflowFormField[] = [
  { key: 'expenses', label: '费用明细', type: 'detail', required: true, children: [{ key: 'amount', label: '金额', type: 'amount', required: true }] },
  { key: 'total', label: '总额', type: 'formula', formula: 'SUM({expenses.amount})' },
];
const financialFlow = (extras: Partial<WorkflowNodeConfig> = {}): WorkflowFlowData => ({
  nodes: [node('start', 'start'), node('end', 'end'), node('manager', 'approve', extras), node('gateway', 'exclusiveGateway'), node('ceo', 'approve'), node('finance', 'approve')],
  edges: [edge('start', 'manager'), edge('manager', 'gateway'), edge('gateway', 'ceo', { condition: gt('total', 10000) }), edge('gateway', 'finance', { isDefault: true }), edge('ceo', 'finance'), edge('finance', 'end')],
});

describe('workflow path prediction', () => {
  it('recomputes an explicit draft and rejects forged derived routing without mutating its input', () => {
    const values = { expenses: [{ amount: 7000 }, { amount: 6000 }], total: 1 };
    const graph = financialFlow(), frozen = structuredClone(graph);
    const plan = planWorkflowPath(graph, { formData: values, formFields: financialFields, recomputeDerivedValues: true });
    expect(plan.formData.total).toBe(13000);
    expect(branch(plan, 'ceo')).toBe('matched');
    expect(branch(plan, 'finance')).toBe('excluded');
    expect(values.total).toBe(1); expect(graph).toEqual(frozen);
    expect(plan.nodes.filter(row => row.status === 'matched').map(row => row.nodeKey)).toEqual(['start', 'manager', 'gateway', 'ceo', 'finance', 'end']);
  });

  it('leaves an already submitted snapshot untouched unless the caller explicitly recomputes', () => {
    const values = { expenses: [{ amount: 2000 }], total: 13000 };
    const plan = planWorkflowPath(financialFlow(), { formData: values, formFields: financialFields });
    expect(plan.formData).toBe(values);
    expect(branch(plan, 'ceo')).toBe('matched');
  });

  it('keeps all candidates unknown if required formula sources are missing, even with an injected total', () => {
    const plan = planWorkflowPath(financialFlow(), { formData: { total: 1 }, formFields: financialFields, recomputeDerivedValues: true });
    expect(branch(plan, 'ceo')).toBe('unknown'); expect(branch(plan, 'finance')).toBe('unknown');
    expect(plan.branches.every(row => row.reason.length > 0)).toBe(true);
  });

  it('marks incomplete detail rows unknown instead of selecting a branch on a partial aggregate', () => {
    const plan = planWorkflowPath(financialFlow(), { formData: { expenses: [{ amount: 2000 }, {}], total: 2000 }, formFields: financialFields });
    expect(branch(plan, 'ceo')).toBe('unknown'); expect(branch(plan, 'finance')).toBe('unknown');
  });

  it('preserves first-match edge priority when conditions overlap', () => {
    const gateway = node('g', 'exclusiveGateway').data;
    const outs = [edge('g', 'one', { condition: gt('amount', 100) }), edge('g', 'two', { condition: gt('amount', 10) }), edge('g', 'default')];
    expect(selectWorkflowPathBranches(gateway, outs, { formData: { amount: 1000 } }).map(row => row.status)).toEqual(['matched', 'excluded', 'excluded']);
  });

  it('does not confidently choose a later true branch while an earlier branch is unknown', () => {
    const outs = [edge('g', 'one', { condition: gt('missing', 100) }), edge('g', 'two', { condition: gt('amount', 10) }), edge('g', 'default')];
    expect(selectWorkflowPathBranches(node('g', 'exclusiveGateway').data, outs, { formData: { amount: 1000 } }).map(row => row.status)).toEqual(['unknown', 'unknown', 'excluded']);
  });

  it('selects the default only after every condition is known false', () => {
    const outs = [edge('g', 'one', { condition: gt('amount', 10000) }), edge('g', 'default')];
    expect(selectWorkflowPathBranches(node('g', 'exclusiveGateway').data, outs, { formData: { amount: 2000 } }).map(row => row.status)).toEqual(['excluded', 'matched']);
    expect(selectWorkflowPathBranches(node('g', 'exclusiveGateway').data, outs, { formData: {} }).map(row => row.status)).toEqual(['unknown', 'unknown']);
  });

  it('retains every parallel branch and ignores their conditional labels just as the runtime does', () => {
    const graph: WorkflowFlowData = { nodes: [node('start', 'start'), node('fork', 'parallelGateway'), node('a', 'approve'), node('b', 'approve'), node('join', 'parallelGateway'), node('end', 'end')], edges: [edge('start', 'fork'), edge('fork', 'a', { condition: gt('amount', 10000) }), edge('fork', 'b'), edge('a', 'join'), edge('b', 'join'), edge('join', 'end')] };
    const plan = planWorkflowPath(graph, { formData: { amount: 1 } });
    expect(branch(plan, 'a')).toBe('matched'); expect(branch(plan, 'b')).toBe('matched'); expect(status(plan, 'end')).toBe('matched');
  });

  it('merges future editable fields at a parallel join regardless of which sibling arrives first', () => {
    const graph: WorkflowFlowData = { nodes: [node('start', 'start'), node('fork', 'parallelGateway'), node('plain', 'approve'), node('editor', 'approve', { fieldPermissions: { expenses: 'edit' } }), node('join', 'parallelGateway'), node('g', 'exclusiveGateway'), node('high', 'approve'), node('low', 'approve')], edges: [edge('start', 'fork'), edge('fork', 'plain'), edge('fork', 'editor'), edge('plain', 'join'), edge('editor', 'join'), edge('join', 'g'), edge('g', 'high', { condition: gt('total', 10000) }), edge('g', 'low')] };
    for (const edges of [graph.edges, [...graph.edges].reverse()]) {
      const plan = planWorkflowPath({ ...graph, edges }, { formData: { expenses: [{ amount: 2000 }], total: 2000 }, formFields: financialFields });
      expect(branch(plan, 'high')).toBe('unknown'); expect(branch(plan, 'low')).toBe('unknown'); expect(plan.truncated).toBe(false);
    }
  });

  it('keeps unrelated downstream conditions known despite a future edit to another field', () => {
    const plan = planWorkflowPath(financialFlow({ fieldPermissions: { notes: 'edit' } }), { formData: { expenses: [{ amount: 2000 }], total: 2000 }, formFields: financialFields });
    expect(branch(plan, 'ceo')).toBe('excluded'); expect(branch(plan, 'finance')).toBe('matched');
  });

  it('does not invent a future field edit on an automatically approved node', () => {
    const plan = planWorkflowPath(financialFlow({ approvalType: 'autoApprove', fieldPermissions: { expenses: 'edit' } }), { formData: { expenses: [{ amount: 2000 }], total: 2000 }, formFields: financialFields });
    expect(branch(plan, 'ceo')).toBe('excluded'); expect(branch(plan, 'finance')).toBe('matched');
  });

  it('keeps every matching inclusive branch, with an unknown candidate never becoming the default', () => {
    const outs = [edge('g', 'a', { condition: gt('amount', 100) }), edge('g', 'b', { condition: gt('missing', 100) }), edge('g', 'c', { condition: gt('amount', 200) }), edge('g', 'default')];
    expect(selectWorkflowPathBranches(node('g', 'inclusiveGateway').data, outs, { formData: { amount: 1000 } }).map(row => row.status)).toEqual(['matched', 'unknown', 'matched', 'excluded']);
    expect(selectWorkflowPathBranches(node('g', 'inclusiveGateway').data, outs, { formData: { amount: 1 } }).map(row => row.status)).toEqual(['excluded', 'unknown', 'excluded', 'unknown']);
  });

  it('treats future decisions as unknown without evaluating an external rule asset', () => {
    const graph = financialFlow(); graph.nodes.find(row => row.id === 'gateway')!.data = { key: 'gateway', type: 'routeGateway', label: '规则分流', decisionRuleKey: 'external-decision' };
    const plan = planWorkflowPath(graph, { formData: { total: 2000 } });
    expect(branch(plan, 'ceo')).toBe('unknown'); expect(branch(plan, 'finance')).toBe('unknown');
    expect(plan.branches.find(row => row.target === 'ceo')?.reason).toContain('决策结果');
  });

  it('marks trigger output fields unknown and propagates the dependency into downstream formulas', () => {
    const graph = financialFlow(); graph.nodes.find(row => row.id === 'manager')!.data = { key: 'manager', type: 'trigger', label: '更新明细', triggerConfig: { triggerType: 'updateData', fieldKeys: ['expenses'] } };
    const plan = planWorkflowPath(graph, { formData: { expenses: [{ amount: 2000 }], total: 2000 }, formFields: financialFields });
    expect(branch(plan, 'ceo')).toBe('unknown'); expect(branch(plan, 'finance')).toBe('unknown');
  });

  it('does not reuse an injected date-derived value when its source dates are missing or invalid', () => {
    const graph = financialFlow(); graph.edges[2].condition = gt('days', 3);
    const fields: WorkflowFormField[] = [{ key: 'range', label: '请假日期', type: 'dateRange', required: true }, { key: 'days', label: '天数', type: 'number', daysFromKey: 'range' }];
    for (const formData of [{ days: 5 }, { days: 5, range: ['invalid', 'also invalid'] }, { days: 5, range: ['2026-10-08', '2026-10-01'] }]) {
      const plan = planWorkflowPath(graph, { formData, formFields: fields });
      expect(branch(plan, 'ceo')).toBe('unknown'); expect(branch(plan, 'finance')).toBe('unknown');
    }
  });

  it('predicts only the remaining path from the actual active nodes, excluding prior editable approvals', () => {
    const plan = planWorkflowPath(financialFlow({ fieldPermissions: { expenses: 'edit' } }), { formData: { expenses: [{ amount: 2000 }], total: 2000 }, formFields: financialFields, activeNodeKeys: ['finance'], completedNodeKeys: ['manager'] });
    expect(status(plan, 'manager')).toBe('excluded'); expect(status(plan, 'gateway')).toBe('excluded'); expect(status(plan, 'finance')).toBe('matched'); expect(status(plan, 'end')).toBe('matched');
    expect(plan.nodes.filter(row => row.status !== 'excluded').map(row => row.nodeKey)).toEqual(['finance', 'end']);
  });

  it('treats an empty frontier as finished instead of restarting from start', () => {
    expect(planWorkflowPath(financialFlow(), { activeNodeKeys: [] }).nodes.every(row => row.status === 'excluded')).toBe(true);
  });

  it('terminates loop traversal and excludes exception paths without constructing runtime tokens or tasks', () => {
    const graph: WorkflowFlowData = { nodes: [node('start', 'start'), node('a', 'approve'), node('g', 'exclusiveGateway'), node('end', 'end'), node('catch', 'catchNode')], edges: [edge('start', 'a'), edge('a', 'g'), edge('g', 'a', { condition: gt('amount', 100) }), edge('g', 'end'), edge('a', 'catch', { isException: true })] };
    const plan = planWorkflowPath(graph, { formData: { amount: 200 } });
    expect(status(plan, 'a')).toBe('matched'); expect(status(plan, 'end')).toBe('excluded'); expect(status(plan, 'catch')).toBe('excluded'); expect(plan.truncated).toBe(false);
    expect(plan).not.toHaveProperty('tasksToCreate'); expect(plan.nodes).toHaveLength(graph.nodes.length);
  });

  it('does not invoke random selection or an external approval during prediction', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random must not run'); });
    const fetchMock = vi.fn(() => { throw new Error('external must not run'); }); vi.stubGlobal('fetch', fetchMock);
    try {
      const graph = financialFlow({ approveMethod: 'random', externalApproval: { enabled: true, url: 'https://example.invalid/approval', secret: 'fixture-only' } });
      const plan = planWorkflowPath(graph, { formData: { total: 2000 } });
      expect(status(plan, 'manager')).toBe('matched'); expect(random).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    } finally { random.mockRestore(); vi.unstubAllGlobals(); }
  });
});
