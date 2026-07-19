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
  it('supports in / open interval / string not-equal cells', () => {
    const t = {
      hitPolicy: 'first' as const,
      inputs: [
        { key: 'amt', label: '金额', expr: 'form.amount', type: 'number' as const },
        { key: 'ch', label: '渠道', expr: 'form.channel', type: 'string' as const },
      ],
      outputs: [{ key: 'route', label: '路由', type: 'string' as const }],
      rules: [
        { id: 'a', when: ['[100..200)', 'in wxpay,alipay'], then: { route: 'fast' } },
        { id: 'b', when: ['-', '!= bank'], then: { route: 'normal' } },
      ],
    };
    expect(evaluateDecisionTable(t, { form: { amount: 100, channel: 'wxpay' } }).outputs.route).toBe('fast');
    expect(evaluateDecisionTable(t, { form: { amount: 200, channel: 'wxpay' } }).outputs.route).toBe('normal'); // 开区间右端不含
    expect(evaluateDecisionTable(t, { form: { amount: 200, channel: 'bank' } }).matched).toBe(false);
  });
  it('supports date cells via dayjs comparison', () => {
    const t = {
      hitPolicy: 'first' as const,
      inputs: [{ key: 'ts', label: '下单时间', expr: 'form.orderedAt', type: 'date' as const }],
      outputs: [{ key: 'promo', label: '活动', type: 'string' as const }],
      rules: [
        { id: 'a', when: ['[2026-01-01 00:00:00..2026-01-31 23:59:59]'], then: { promo: 'jan' } },
        { id: 'b', when: ['>= 2026-02-01'], then: { promo: 'later' } },
      ],
    };
    expect(evaluateDecisionTable(t, { form: { orderedAt: '2026-01-15 12:00:00' } }).outputs.promo).toBe('jan');
    expect(evaluateDecisionTable(t, { form: { orderedAt: '2026-03-01 00:00:00' } }).outputs.promo).toBe('later');
    expect(evaluateDecisionTable(t, { form: { orderedAt: '2025-12-31 00:00:00' } }).matched).toBe(false);
  });
  it('evaluates "=" output expressions against scope', () => {
    const t = {
      ...table,
      rules: [{ id: 'r', when: ['>= 0'], then: { level: 'vip', discount: '= form.amount * 0.001' } }],
    };
    expect(evaluateDecisionTable(t, { form: { amount: 500 } }).outputs).toEqual({ level: 'vip', discount: 0.5 });
  });
  it('collect aggregation via settings.collectAggregate', () => {
    const t = {
      hitPolicy: 'collect' as const,
      inputs: [{ key: 'amt', label: '金额', expr: 'form.amount', type: 'number' as const }],
      outputs: [{ key: 'bonus', label: '加分', type: 'number' as const }],
      rules: [
        { id: 'a', when: ['>= 10'], then: { bonus: 1 } },
        { id: 'b', when: ['>= 100'], then: { bonus: 2 } },
      ],
    };
    expect(evaluateDecisionTable({ ...t, settings: { collectAggregate: 'sum' } }, { form: { amount: 150 } }).outputs.bonus).toBe(3);
    expect(evaluateDecisionTable({ ...t, settings: { collectAggregate: 'max' } }, { form: { amount: 150 } }).outputs.bonus).toBe(2);
    expect(evaluateDecisionTable({ ...t, settings: { collectAggregate: 'count' } }, { form: { amount: 150 } }).outputs.bonus).toBe(2);
    expect(evaluateDecisionTable(t, { form: { amount: 150 } }).outputs.bonus).toEqual([1, 2]);
  });
  it('falls back to defaults when no match and fallbackToDefaults enabled', () => {
    const t = {
      ...table,
      outputs: [{ key: 'level', label: '等级', type: 'string' as const, default: 'guest' }],
      rules: [{ id: 'r', when: ['>= 100000'], then: { level: 'gold' } }],
      settings: { fallbackToDefaults: true },
    };
    const res = evaluateDecisionTable(t, { form: { amount: 1 } });
    expect(res.matched).toBe(false);
    expect(res.usedFallback).toBe(true);
    expect(res.outputs).toEqual({ level: 'guest' });
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
    expect(evaluateDecisionTable(t, { form: { amount: 99 } }).reason).toBe('no_match');
  });
  it('unique policy conflicts on multi-hit', () => {
    const t = { ...table, hitPolicy: 'unique' as const, rules: [
      { id: 'a', when: ['>= 1'], then: { level: 'x' } },
      { id: 'b', when: ['>= 2'], then: { level: 'y' } },
    ] };
    const res = evaluateDecisionTable(t, { form: { amount: 5 } });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('unique_conflict');
    expect(res.matchedRowIds).toEqual(['a', 'b']);
    expect(evaluateDecisionTable(t, { form: { amount: 1.5 } }).matched).toBe(true);
  });
  it('any policy requires consistent outputs', () => {
    const outputs = [{ key: 'level', label: 'l', type: 'string' as const }];
    const consistent = { ...table, hitPolicy: 'any' as const, outputs, rules: [
      { id: 'a', when: ['>= 1'], then: { level: 'same' } },
      { id: 'b', when: ['>= 2'], then: { level: 'same' } },
    ] };
    const okRes = evaluateDecisionTable(consistent, { form: { amount: 5 } });
    expect(okRes.matched).toBe(true);
    expect(okRes.outputs.level).toBe('same');
    expect(okRes.matchedRowIds).toEqual(['a', 'b']);
    const conflict = { ...consistent, rules: [
      { id: 'a', when: ['>= 1'], then: { level: 'x' } },
      { id: 'b', when: ['>= 2'], then: { level: 'y' } },
    ] };
    const bad = evaluateDecisionTable(conflict, { form: { amount: 5 } });
    expect(bad.matched).toBe(false);
    expect(bad.reason).toBe('any_conflict');
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
