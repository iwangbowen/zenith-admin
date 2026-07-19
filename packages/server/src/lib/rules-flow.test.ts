import { describe, it, expect } from 'vitest';
import { evaluateDecisionFlowSteps, type FlowTableLike } from './rules-flow';

const levelTable: FlowTableLike = {
  hitPolicy: 'first',
  inputs: [{ key: 'amt', label: '金额', expr: 'form.amount', type: 'number' }],
  outputs: [{ key: 'level', label: '等级', type: 'string' }],
  rules: [
    { id: 'a', when: ['>= 1000'], then: { level: 'gold' } },
    { id: 'b', when: ['-'], then: { level: 'normal' } },
  ],
};

const bonusTable: FlowTableLike = {
  hitPolicy: 'first',
  inputs: [{ key: 'lv', label: '等级', expr: 'level', type: 'string' }],
  outputs: [{ key: 'bonus', label: '加成', type: 'number' }],
  rules: [
    { id: 'x', when: ['gold'], then: { bonus: 100 } },
    { id: 'y', when: ['-'], then: { bonus: 0 } },
  ],
};

const resolver = (tables: Record<string, FlowTableLike>) => async (key: string) => tables[key] ?? null;

describe('evaluateDecisionFlowSteps', () => {
  it('chains steps: earlier outputs feed later inputs', async () => {
    const res = await evaluateDecisionFlowSteps(
      [
        { id: 's1', tableKey: 'level' },
        { id: 's2', tableKey: 'bonus' },
      ],
      { form: { amount: 2000 } },
      resolver({ level: levelTable, bonus: bonusTable }),
    );
    expect(res.outputs).toEqual({ level: 'gold', bonus: 100 });
    expect(res.steps).toHaveLength(2);
    expect(res.steps.every((s) => !s.skipped && s.matched)).toBe(true);
  });

  it('skips step when condition is false', async () => {
    const res = await evaluateDecisionFlowSteps(
      [
        { id: 's1', tableKey: 'level' },
        { id: 's2', tableKey: 'bonus', condition: 'level === "gold"' },
      ],
      { form: { amount: 10 } },
      resolver({ level: levelTable, bonus: bonusTable }),
    );
    expect(res.outputs).toEqual({ level: 'normal' });
    expect(res.steps[1].skipped).toBe(true);
    expect(res.steps[1].skipReason).toBe('condition');
  });

  it('namespaces outputs to avoid key clashes', async () => {
    const res = await evaluateDecisionFlowSteps(
      [{ id: 's1', tableKey: 'level', outputNamespace: 'member' }],
      { form: { amount: 2000 } },
      resolver({ level: levelTable }),
    );
    expect(res.outputs).toEqual({ member: { level: 'gold' } });
  });

  it('marks unavailable table as skipped without breaking the flow', async () => {
    const res = await evaluateDecisionFlowSteps(
      [
        { id: 's1', tableKey: 'missing' },
        { id: 's2', tableKey: 'level' },
      ],
      { form: { amount: 2000 } },
      resolver({ level: levelTable }),
    );
    expect(res.steps[0].skipped).toBe(true);
    expect(res.steps[0].skipReason).toBe('unavailable');
    expect(res.outputs).toEqual({ level: 'gold' });
  });
});
