import { describe, expect, it } from 'vitest';
import { evaluateWorkflowCondition, evaluateWorkflowConditionGroups, evaluateWorkflowConditionGroupsState, evaluateWorkflowConditionState, workflowEdgeMatchesCondition } from './conditions';
import type { WorkflowEdgeCondition, WorkflowStarterContext } from './types';

const rule = (operator: WorkflowEdgeCondition['operator'], value: WorkflowEdgeCondition['value']): WorkflowEdgeCondition => ({ field: 'value', operator, value });
const starter: WorkflowStarterContext = { userId: 22, deptIds: [9, 3], roleIds: [6], postIds: [2] };

describe('shared workflow runtime condition semantics', () => {
  it.each([
    ['eq', '12', 12, true], ['neq', 12, '12', false], ['gt', 10, 12, true], ['gte', 12, '12', true],
    ['lt', 10, 12, false], ['lte', 12, 12, true], ['between', '20~10', 15, true], ['between', '10,20', 21, false],
    ['contains', '合同', '采购合同审查', true], ['in', '公章, 合同章', '合同章', true], ['notIn', '公章,合同章', '部门章', true],
    ['in', 3, 3, true], ['isEmpty', '', {}, true], ['isNotEmpty', '', [], false],
  ] satisfies Array<[WorkflowEdgeCondition['operator'], WorkflowEdgeCondition['value'], unknown, boolean]>)('preserves %s coercion and collection behavior', (operator, target, actual, expected) => {
    expect(evaluateWorkflowCondition(rule(operator, target), { value: actual })).toBe(expected);
  });

  it('supports multi-valued actuals and historical imported target arrays without matching object text', () => {
    expect(evaluateWorkflowCondition(rule('in', '法务,财务'), { value: ['财务', '研发'] })).toBe(true);
    expect(evaluateWorkflowCondition(rule('notIn', '法务,财务'), { value: ['研发'] })).toBe(true);
    expect(evaluateWorkflowCondition(rule('contains', '财务'), { value: ['财务'] })).toBe(true);
    const imported = { ...rule('in', ''), value: ['公章', '合同章'] } as unknown as WorkflowEdgeCondition;
    expect(evaluateWorkflowCondition(imported, { value: '合同章' })).toBe(true);
    expect(evaluateWorkflowCondition(rule('contains', '[object Object]'), { value: [{ name: '财务' }] })).toBe(false);
  });

  it('retains department ancestor, role, post and user starter membership', () => {
    for (const [field, value] of [['user', 22], ['dept', 3], ['role', 6], ['post', 2]] as const) {
      expect(evaluateWorkflowCondition({ field, source: 'starter', operator: 'in', value }, {}, starter)).toBe(true);
    }
    expect(evaluateWorkflowCondition({ field: 'dept', source: 'starter', operator: 'notIn', value: '3,4' }, {}, starter)).toBe(false);
    expect(evaluateWorkflowCondition({ field: 'role', source: 'starter', operator: 'in', value: 6 }, {})).toBe(false);
    expect(evaluateWorkflowConditionState({ field: 'role', source: 'starter', operator: 'in', value: 6 }, { formData: {} }).status).toBe('unknown');
  });

  it('aggregates detail sums, counts and averages with the original finite-number filtering', () => {
    const rows = [{ amount: 7000 }, { amount: '6000' }, { amount: 'invalid' }];
    expect(evaluateWorkflowCondition({ field: 'rows', aggregate: 'sum', aggregateField: 'amount', operator: 'gt', value: 10000 }, { rows })).toBe(true);
    expect(evaluateWorkflowCondition({ field: 'rows', aggregate: 'avg', aggregateField: 'amount', operator: 'eq', value: 6500 }, { rows })).toBe(true);
    expect(evaluateWorkflowCondition({ field: 'rows', aggregate: 'count', operator: 'eq', value: 3 }, { rows })).toBe(true);
    expect(evaluateWorkflowConditionState({ field: 'rows', aggregate: 'count', operator: 'eq', value: 0 }, { formData: { rows: [] } }).status).toBe('matched');
  });

  it('uses an injectable clock for relative dates and preserves future withinDays behavior', () => {
    const now = '2026-10-02 12:00:00';
    expect(evaluateWorkflowCondition(rule('withinDays', 3), { value: '2026-10-05 12:00:00' }, undefined, now)).toBe(true);
    expect(evaluateWorkflowCondition(rule('beforeDays', 3), { value: '2026-09-28 12:00:00' }, undefined, now)).toBe(true);
    expect(evaluateWorkflowCondition(rule('beforeDays', 3), { value: '2026-10-05 12:00:00' }, undefined, now)).toBe(false);
    expect(evaluateWorkflowCondition(rule('withinDays', 3), { value: 'invalid date' }, undefined, now)).toBe(false);
    expect(evaluateWorkflowConditionState(rule('withinDays', 3), { formData: { value: 'invalid date' }, now }).status).toBe('unknown');
  });

  it('gives configured condition groups precedence over the legacy single-condition field', () => {
    const edge = { id: 'edge', source: 'a', target: 'b', condition: rule('gt', 100), conditions: [{ type: 'and' as const, rules: [rule('gte', 12)] }] };
    expect(workflowEdgeMatchesCondition(edge, { value: 12 })).toBe(true);
    expect(evaluateWorkflowConditionGroups([{ type: 'and', rules: [] }], { value: 12 })).toBe(false);
  });
});

describe('three-state workflow condition prediction', () => {
  it('does not turn an absent required input into zero or select a default confidently', () => {
    expect(evaluateWorkflowConditionState(rule('lte', 100), { formData: {} }).status).toBe('unknown');
    expect(evaluateWorkflowConditionState(rule('isEmpty', ''), { formData: {}, requiredFields: new Set(['value']) }).status).toBe('unknown');
    expect(evaluateWorkflowConditionState(rule('isEmpty', ''), { formData: {} }).status).toBe('matched');
  });

  it('keeps invalid numeric inputs and partial aggregates uncertain while retaining runtime boolean semantics', () => {
    expect(evaluateWorkflowConditionState(rule('gt', 10), { formData: { value: 'not a number' } }).status).toBe('unknown');
    const aggregate: WorkflowEdgeCondition = { field: 'rows', aggregate: 'sum', aggregateField: 'amount', operator: 'gt', value: 10 };
    expect(evaluateWorkflowConditionState(aggregate, { formData: { rows: [{ amount: 20 }, { amount: 'invalid' }] } }).status).toBe('unknown');
    expect(evaluateWorkflowCondition(aggregate, { rows: [{ amount: 20 }, { amount: 'invalid' }] })).toBe(true);
  });

  it('propagates future-field reasons while starter conditions remain independent of form writes', () => {
    const context = { formData: { value: 2000 }, starter, unknownFields: { '*': '决策输出尚未产生' } };
    expect(evaluateWorkflowConditionState(rule('gt', 10000), context)).toEqual({ status: 'unknown', reason: '决策输出尚未产生' });
    expect(evaluateWorkflowConditionState({ field: 'dept', source: 'starter', operator: 'in', value: 3 }, context).status).toBe('matched');
  });

  it('uses decisive false for AND and decisive true for OR even if another input is unknown', () => {
    const unknown = { field: 'missing', operator: 'gt' as const, value: 1 };
    const falseRule = rule('gt', 100), trueRule = rule('eq', 12);
    expect(evaluateWorkflowConditionGroupsState([{ type: 'and', rules: [unknown, falseRule] }], { formData: { value: 12 } }).status).toBe('excluded');
    expect(evaluateWorkflowConditionGroupsState([{ type: 'or', rules: [unknown, trueRule] }], { formData: { value: 12 } }).status).toBe('matched');
    expect(evaluateWorkflowConditionGroupsState([{ type: 'and', rules: [unknown, trueRule] }], { formData: { value: 12 } }).status).toBe('unknown');
  });
});
