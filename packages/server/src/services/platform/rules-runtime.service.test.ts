/**
 * decide() 求值、降级与留痕回归：规则服务、名单、执行记录及 DB 使用 mock。
 * 缓存保持真实实现，每用例前 invalidate 防止跨用例污染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../db', () => {
  const db = { select: vi.fn() };
  return { db };
});

vi.mock('../../lib/context', () => ({
  currentUserOrNull: vi.fn().mockReturnValue(null),
}));

vi.mock('../../lib/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('./rules.service', () => ({
  resolveRuntimeDecisionTable: vi.fn(),
  resolveGrayPinnedVersion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./rules-lists.service', () => ({
  checkRuleListsBatch: vi.fn(),
}));

vi.mock('./rules-executions.service', () => ({
  recordRuleExecution: vi.fn(),
  snapshotRuleScope: vi.fn((scope: Record<string, unknown>) => ({ ...scope })),
}));

import { db } from '../../db';
import { resolveRuntimeDecisionTable } from './rules.service';
import { checkRuleListsBatch } from './rules-lists.service';
import { recordRuleExecution } from './rules-executions.service';
import { invalidateRuleRuntimeCache } from './rules-runtime-cache';
import { decide } from './rules-runtime.service';

const dbMock = vi.mocked(db);
const resolveTableMock = vi.mocked(resolveRuntimeDecisionTable);
const batchMock = vi.mocked(checkRuleListsBatch);
const recordMock = vi.mocked(recordRuleExecution);

function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/** 最小可命中决策表快照：amount >= 100 → level=vip */
const tableSnapshot = {
  tableId: 11,
  tenantId: null,
  version: 3,
  hitPolicy: 'first' as const,
  inputs: [{ key: 'amount', label: '金额', expr: 'form.amount', type: 'number' as const }],
  outputs: [{ key: 'level', label: '等级', type: 'string' as const }],
  rules: [{ id: 'r1', when: ['>= 100'], then: { level: 'vip' } }],
  settings: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateRuleRuntimeCache();
  vi.mocked(resolveRuntimeDecisionTable).mockReset();
  batchMock.mockReset();
});

describe('decide · table', () => {
  it('evaluates published snapshots without production execution history during simulation', async () => {
    resolveTableMock.mockResolvedValue(tableSnapshot);
    const result = await decide({ kind: 'table', key: 'member_level' }, { form: { amount: 200 } }, { caller: 'workflow.simulation', record: false });
    expect(result.outputs).toEqual({ level: 'vip' });
    expect(recordMock).not.toHaveBeenCalled();
  });
  it('发布快照命中 → matched + outputs + version，留痕带 refKind/caller', async () => {
    resolveTableMock.mockResolvedValue(tableSnapshot);
    const res = await decide({ kind: 'table', key: 'member_level' }, { form: { amount: 200 } }, { caller: 'unit.test' });
    expect(res.matched).toBe(true);
    expect(res.outputs).toEqual({ level: 'vip' });
    expect(res.ref).toEqual({ kind: 'table', key: 'member_level', version: 3 });
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({
      refKind: 'table', refId: 11, ruleKey: 'member_level', version: 3, caller: 'unit.test', source: 'runtime', matched: true,
    }));
  });

  it('资产不可用 + optional → not_found 降级且不留痕', async () => {
    resolveTableMock.mockResolvedValue(null);
    const res = await decide({ kind: 'table', key: 'missing' }, {}, { caller: 'unit.test' });
    expect(res).toMatchObject({ matched: false, outputs: {}, reason: 'not_found' });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('资产不可用 + required → 抛 400', async () => {
    resolveTableMock.mockResolvedValue(null);
    await expect(decide({ kind: 'table', key: 'missing' }, {}, { caller: 'unit.test', mode: 'required' }))
      .rejects.toBeInstanceOf(HTTPException);
  });

  it('底层异常 + optional → reason=error 降级不上抛', async () => {
    resolveTableMock.mockRejectedValue(new Error('db down'));
    const res = await decide({ kind: 'table', key: 'member_level' }, {}, { caller: 'unit.test' });
    expect(res).toMatchObject({ matched: false, reason: 'error' });
  });
});

describe('decide · list', () => {
  const listMeta = { key: 'risk_blacklist', id: 5, type: 'black' as const, tenantId: null };

  it('命中 → matched + outputs.matches + 留痕（matchedRowIds=命中值）', async () => {
    batchMock.mockResolvedValue({
      lists: [listMeta],
      hits: [{ key: 'risk_blacklist', listId: 5, value: '13800000000', listType: 'black', label: '演示', matchMode: 'exact', expiresAt: null }],
    });
    const res = await decide({ kind: 'list', key: 'risk_blacklist' }, {}, { caller: 'unit.test', subjects: ['13800000000', '1.2.3.4'] });
    expect(res.matched).toBe(true);
    expect(res.outputs).toMatchObject({ hit: true, listType: 'black' });
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({
      refKind: 'list', refId: 5, matched: true, matchedRowIds: ['13800000000'],
    }));
  });

  it('未命中 → matched=false 且不留痕', async () => {
    batchMock.mockResolvedValue({ lists: [listMeta], hits: [] });
    const res = await decide({ kind: 'list', key: 'risk_blacklist' }, {}, { caller: 'unit.test', subjects: ['clean'] });
    expect(res).toMatchObject({ matched: false, reason: 'no_match' });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('名单不存在 → not_found', async () => {
    batchMock.mockResolvedValue({ lists: [], hits: [] });
    const res = await decide({ kind: 'list', key: 'ghost' }, {}, { caller: 'unit.test', subjects: ['x'] });
    expect(res).toMatchObject({ matched: false, reason: 'not_found' });
  });
});

describe('decide · scorecard', () => {
  it('发布快照求值 → outputs 含 totalScore/grade/decision 并留痕', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{
      id: 7, key: 'credit_score', status: 'published', version: 2, tenantId: null,
      publishedSnapshot: {
        baseScore: 100,
        variables: [{ key: 'age', label: '年龄', expr: 'form.age', weight: 1, missingScore: 0, bands: [{ op: 'default', score: 50 }] }],
        grades: [{ minScore: 120, grade: 'A', decision: 'approve' }],
      },
    }]));
    const res = await decide({ kind: 'scorecard', key: 'credit_score' }, { form: { age: 30 } }, { caller: 'unit.test' });
    expect(res.matched).toBe(true);
    expect(res.outputs).toMatchObject({ totalScore: 150, grade: 'A', decision: 'approve' });
    expect(res.ref.version).toBe(2);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ refKind: 'scorecard', refId: 7, version: 2 }));
  });

  it('未发布 → not_found', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    const res = await decide({ kind: 'scorecard', key: 'ghost' }, {}, { caller: 'unit.test' });
    expect(res).toMatchObject({ matched: false, reason: 'not_found' });
  });
});

describe('decide · flow', () => {
  it('publishedSteps 逐步执行 → 输出合并，每步 + 流级各留痕', async () => {
    dbMock.select.mockReturnValueOnce(createChain([{
      id: 9, key: 'member_benefit_flow', status: 'published', version: 4, tenantId: null,
      publishedSteps: [{ id: 's1', tableKey: 'member_level' }],
    }]));
    resolveTableMock.mockResolvedValue(tableSnapshot);
    const res = await decide({ kind: 'flow', key: 'member_benefit_flow' }, { form: { amount: 500 } }, { caller: 'unit.test' });
    expect(res.matched).toBe(true);
    expect(res.outputs).toEqual({ level: 'vip' });
    expect(res.ref.version).toBe(4);
    const kinds = recordMock.mock.calls.map(([row]) => row.refKind);
    expect(kinds).toContain('table'); // 步骤留痕
    expect(kinds).toContain('flow');  // 流级留痕
    const flowRow = recordMock.mock.calls.map(([row]) => row).find((r) => r.refKind === 'flow');
    expect(flowRow).toMatchObject({ refId: 9, version: 4, matched: true });
  });
});
