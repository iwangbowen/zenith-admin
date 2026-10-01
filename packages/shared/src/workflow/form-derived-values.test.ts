import { describe, expect, it } from 'vitest';
import { computeWorkflowDerivedValues, initializeWorkflowFormValues } from './form-derived-values';
import type { WorkflowFormField } from './types';

describe('workflow derived form values', () => {
  it('calculates reversed formula dependencies after date day linkage before any input event', () => {
    const fields: WorkflowFormField[] = [
      { key: 'total', type: 'formula', label: '总费用', formula: '{subtotal} * 1.1', defaultValue: 999 },
      { key: 'subtotal', type: 'formula', label: '费用', formula: '{days} * {daily}' },
      { key: 'days', type: 'number', label: '天数', daysFromKey: 'dates' },
      { key: 'dates', type: 'dateRange', label: '出差日期' },
      { key: 'daily', type: 'amount', label: '每日标准', defaultValue: 100 },
    ];
    expect(initializeWorkflowFormValues(fields, { dates: ['2026-10-01', '2026-10-03'], total: 0 }))
      .toMatchObject({ days: 3, subtotal: 300, total: 330 });
  });

  it('keeps detail formulas in row scope and calculates aggregates from their updated results', () => {
    const fields: WorkflowFormField[] = [
      { key: 'total', type: 'formula', label: '采购合计', formula: 'SUM({items.subtotal})' },
      { key: 'items', type: 'detail', label: '采购明细', children: [
        { key: 'subtotal', type: 'amount', label: '小计', formula: '{qty} * {price}' },
        { key: 'qty', type: 'number', label: '数量' },
        { key: 'price', type: 'amount', label: '单价' },
      ] },
    ];
    const input = { items: [{ qty: 2, price: 12, subtotal: 999 }, { qty: 3, price: 20 }], total: 0 };
    const next = computeWorkflowDerivedValues(fields, input);
    expect(next).toEqual({ items: [{ qty: 2, price: 12, subtotal: 24 }, { qty: 3, price: 20, subtotal: 60 }], total: 84 });
    expect(input.items[0].subtotal).toBe(999);
    expect(next).not.toHaveProperty('subtotal');
    expect(computeWorkflowDerivedValues(fields, next)).toBe(next);
  });

  it('clears stale values when dates become invalid and formula dependencies form a cycle', () => {
    const fields: WorkflowFormField[] = [
      { key: 'days', type: 'number', label: '天数', daysFromKey: 'dates' },
      { key: 'a', type: 'formula', label: 'A', formula: '{b} + 1' },
      { key: 'b', type: 'formula', label: 'B', formula: '{a} + 1' },
    ];
    expect(computeWorkflowDerivedValues(fields, { dates: ['2026-10-03', '2026-10-01'], days: 3, a: 10, b: 20 }))
      .toMatchObject({ days: undefined, a: undefined, b: undefined });
  });

  it('resolves layout-contained formulas and preserves explicit input defaults', () => {
    const fields: WorkflowFormField[] = [{ key: 'group', type: 'group', label: '费用', children: [
      { key: 'amount', type: 'amount', label: '金额', defaultValue: 100 },
      { key: 'suggested', type: 'amount', label: '建议', defaultFormula: '{amount} * 2' },
      { key: 'total', type: 'formula', label: '合计', formula: '{amount} + {suggested}' },
    ] }];
    expect(initializeWorkflowFormValues(fields, { amount: 80, suggested: 30 }))
      .toEqual({ amount: 80, suggested: 30, total: 110 });
    expect(initializeWorkflowFormValues(fields, { amount: 80 })).toMatchObject({ suggested: 160, total: 240 });
  });
});
