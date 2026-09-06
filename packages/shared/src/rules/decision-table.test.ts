/**
 * 决策表命中策略单测：期望值与 server rules-engine.test.ts 中的既有断言对齐（golden），
 * 保证 hit-policy 装配上移 shared 后服务端与 Mock 行为一致。
 */
import { describe, expect, it } from 'vitest';
import { aggregateCollectedOutputs, defaultDecisionOutputs, matchDecisionRows, resolveDecisionHits, type DecisionTableLike } from './decision-table';
import type { RuleDecisionOutput, RuleDecisionRow } from './contracts';

const outputs: RuleDecisionOutput[] = [
  { key: 'level', label: '等级', type: 'string', default: 'normal' },
  { key: 'discount', label: '折扣', type: 'number', default: null },
];

const rows: RuleDecisionRow[] = [
  { id: 'r1', when: ['> 100', 'vip'], then: { level: 'gold', discount: 0.8 }, priority: 1 },
  { id: 'r2', when: ['> 100', ''], then: { level: 'silver', discount: 0.9 }, priority: 5 },
  { id: 'r3', when: ['', 'vip'], then: { level: 'gold', discount: 0.8 }, priority: 3 },
];

function table(hitPolicy: DecisionTableLike['hitPolicy'], settings?: DecisionTableLike['settings']): DecisionTableLike {
  return {
    hitPolicy,
    inputs: [
      { key: 'amount', label: '金额', type: 'number', expr: 'form.amount' },
      { key: 'tier', label: '等级', type: 'string', expr: 'form.tier' },
    ],
    outputs,
    rules: rows,
    settings,
  };
}

const build = (row: RuleDecisionRow) => ({ level: row.then.level ?? null, discount: row.then.discount ?? null });

describe('matchDecisionRows', () => {
  it('按列类型匹配单元格 DSL，保持表内顺序', () => {
    expect(matchDecisionRows(table('first'), [200, 'vip']).map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(matchDecisionRows(table('first'), [50, 'vip']).map((r) => r.id)).toEqual(['r3']);
    expect(matchDecisionRows(table('first'), [50, 'basic'])).toEqual([]);
  });
});

describe('resolveDecisionHits', () => {
  it('未命中：默认不回退；fallbackToDefaults 时输出各列默认值且 usedFallback', () => {
    expect(resolveDecisionHits(table('first'), [], build)).toEqual({ matched: false, outputs: {}, matchedRowIds: [], hitPolicy: 'first', reason: 'no_match' });
    expect(resolveDecisionHits(table('first', { fallbackToDefaults: true }), [], build)).toEqual({
      matched: false, outputs: { level: 'normal', discount: null }, matchedRowIds: [], hitPolicy: 'first', reason: 'no_match', usedFallback: true,
    });
  });

  it('first：取首个命中行', () => {
    expect(resolveDecisionHits(table('first'), rows, build)).toEqual({ matched: true, outputs: { level: 'gold', discount: 0.8 }, matchedRowIds: ['r1'], hitPolicy: 'first' });
  });

  it('unique：多命中视为冲突', () => {
    expect(resolveDecisionHits(table('unique'), [rows[0]], build).matched).toBe(true);
    expect(resolveDecisionHits(table('unique'), rows, build)).toEqual({ matched: false, outputs: {}, matchedRowIds: ['r1', 'r2', 'r3'], hitPolicy: 'unique', reason: 'unique_conflict' });
  });

  it('priority：取 priority 最大的行', () => {
    expect(resolveDecisionHits(table('priority'), rows, build)).toEqual({ matched: true, outputs: { level: 'silver', discount: 0.9 }, matchedRowIds: ['r2'], hitPolicy: 'priority' });
  });

  it('any：命中行输出一致才算命中', () => {
    expect(resolveDecisionHits(table('any'), [rows[0], rows[2]], build)).toEqual({ matched: true, outputs: { level: 'gold', discount: 0.8 }, matchedRowIds: ['r1', 'r3'], hitPolicy: 'any' });
    expect(resolveDecisionHits(table('any'), rows, build)).toEqual({ matched: false, outputs: {}, matchedRowIds: ['r1', 'r2', 'r3'], hitPolicy: 'any', reason: 'any_conflict' });
  });

  it('collect：默认 list 聚合并附带 collected', () => {
    const res = resolveDecisionHits(table('collect'), rows, build);
    expect(res.matched).toBe(true);
    expect(res.matchedRowIds).toEqual(['r1', 'r2', 'r3']);
    expect(res.outputs).toEqual({ level: ['gold', 'silver', 'gold'], discount: [0.8, 0.9, 0.8] });
    expect(res.collected).toHaveLength(3);
  });
});

describe('aggregateCollectedOutputs', () => {
  const collected = rows.map(build);

  it('sum / min / max / count / distinct / list', () => {
    expect(aggregateCollectedOutputs(collected, outputs, 'sum')).toEqual({ level: 0, discount: 2.5 });
    expect(aggregateCollectedOutputs(collected, outputs, 'min')).toEqual({ level: null, discount: 0.8 });
    expect(aggregateCollectedOutputs(collected, outputs, 'max')).toEqual({ level: null, discount: 0.9 });
    expect(aggregateCollectedOutputs(collected, outputs, 'count')).toEqual({ level: 3, discount: 3 });
    expect(aggregateCollectedOutputs(collected, outputs, 'distinct')).toEqual({ level: ['gold', 'silver'], discount: [0.8, 0.9] });
    expect(aggregateCollectedOutputs(collected, outputs, 'list')).toEqual({ level: ['gold', 'silver', 'gold'], discount: [0.8, 0.9, 0.8] });
  });

  it('defaultDecisionOutputs 缺省值为 null', () => {
    expect(defaultDecisionOutputs(outputs)).toEqual({ level: 'normal', discount: null });
  });
});
