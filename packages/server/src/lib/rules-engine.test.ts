import { describe, it, expect } from 'vitest';
import { evaluateDecisionTable } from './rules-engine';
import { diffDecisionSnapshots } from './rules-version-diff';

const table = {
  hitPolicy: 'first' as const,
  inputs: [{ key: 'amt', label: '金额', expr: 'form.amount', type: 'number' as const }],
  outputs: [{ key: 'level', label: '等级', type: 'string' as const }, { key: 'discount', label: '折扣', type: 'number' as const }],
  rules: [
    { id: 'r1', when: ['>= 10000'], then: { level: 'gold', discount: 0.8 } },
    { id: 'r2', when: ['>= 3000'], then: { level: 'silver', discount: 0.9 } },
    { id: 'r3', when: ['-'], then: { level: 'normal', discount: 1 } },
  ],
};

describe('evaluateDecisionTable', () => {
  it('first-hit by amount tiers', () => {
    expect(evaluateDecisionTable(table, { form: { amount: 12000 } }).outputs).toEqual({ level: 'gold', discount: 0.8 });
    expect(evaluateDecisionTable(table, { form: { amount: 5000 } }).outputs).toEqual({ level: 'silver', discount: 0.9 });
    expect(evaluateDecisionTable(table, { form: { amount: 100 } }).outputs).toEqual({ level: 'normal', discount: 1 });
  });
  it('priority policy picks highest', () => {
    const t = { ...table, hitPolicy: 'priority' as const, rules: [
      { id: 'a', when: ['-'], then: { level: 'low' }, priority: 1 },
      { id: 'b', when: ['-'], then: { level: 'high' }, priority: 9 },
    ], outputs: [{ key: 'level', label: 'l', type: 'string' as const }] };
    expect(evaluateDecisionTable(t, { form: { amount: 1 } }).outputs.level).toBe('high');
  });
  it('range cell + default output', () => {
    const t = { ...table, rules: [{ id: 'r', when: ['10-20'], then: { level: 'mid' } }] };
    expect(evaluateDecisionTable(t, { form: { amount: 15 } }).matched).toBe(true);
    expect(evaluateDecisionTable(t, { form: { amount: 99 } }).matched).toBe(false);
  });
});

describe('diffDecisionSnapshots', () => {
  const base = { name: 'A', hitPolicy: 'first', inputs: [{ key: 'amt', label: '金额', type: 'number' }], outputs: [{ key: 'lv', label: '等级', type: 'string' }], rules: [{ id: 'r1', when: ['>= 1'], then: { lv: 'x' } }] };
  it('detects meta + rule changes', () => {
    const next = { ...base, name: 'B', rules: [{ id: 'r1', when: ['>= 2'], then: { lv: 'y' } }, { id: 'r2', when: ['-'], then: { lv: 'z' } }] };
    const d = diffDecisionSnapshots(1, 0, base, next);
    expect(d.changes.some((c) => c.kind === 'meta' && c.ref === 'name')).toBe(true);
    expect(d.changes.some((c) => c.op === 'added' && c.ref === 'r2')).toBe(true);
    expect(d.changes.some((c) => c.op === 'changed' && c.ref === 'r1')).toBe(true);
  });
});
