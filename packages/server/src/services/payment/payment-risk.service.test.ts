/**
 * 支付风控 evaluateRisk 单测（两层裁决，资金安全关键）。
 *
 * 覆盖要点：
 *  1. 无规则且策略表未发布 → pass
 *  2. L1 名单：黑名单命中 → 规则动作 + dimension=blocklist；白名单命中 → 跳过本规则全部检查
 *  3. 原生维度保留：单笔上限命中 → block
 *  4. L2 决策表：matched block/review → dimension=decision（ruleId=null，不走原生维度）；
 *     matched pass → 显式放行（跳过原生检查）；未发布 → 回退原生维度
 *
 * Mock 策略：db / rules-lists 批量判定 / rules-runtime decide / rules.service 快照探测全 mock。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db', () => {
  const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), $count: vi.fn() };
  return { db };
});

vi.mock('../../lib/context', () => ({
  currentUser: vi.fn().mockReturnValue({ userId: 1, tenantId: null }),
  currentUserOrNull: vi.fn().mockReturnValue(null),
}));

vi.mock('./payment-outbox.service', () => ({
  recordEvent: vi.fn(),
}));

vi.mock('../platform/rules-lists.service', () => ({
  checkRuleListsBatch: vi.fn().mockResolvedValue({ lists: [], hits: [] }),
}));

vi.mock('../platform/rules-runtime.service', () => ({
  decide: vi.fn(),
}));

vi.mock('../platform/rules.service', () => ({
  resolveRuntimeDecisionTable: vi.fn().mockResolvedValue(null),
}));

import { db } from '../../db';
import { checkRuleListsBatch } from '../platform/rules-lists.service';
import { decide } from '../platform/rules-runtime.service';
import { resolveRuntimeDecisionTable } from '../platform/rules.service';
import { evaluateRisk, type RiskCheckInput } from './payment-risk.service';

const dbMock = vi.mocked(db);
const batchMock = vi.mocked(checkRuleListsBatch);
const decideMock = vi.mocked(decide);
const snapshotMock = vi.mocked(resolveRuntimeDecisionTable);

function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const baseInput: RiskCheckInput = {
  channel: 'wxpay', bizType: 'membership', bizId: 'ORD1', amount: 10000,
  openId: 'oUSER1', userId: 7, clientIp: '1.2.3.4', tenantId: null,
};

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: '测试规则', scope: 'global', channel: null, bizType: null,
    singleLimit: null, dailyLimit: null, dailyCountLimit: null,
    blockListKeys: [], allowListKeys: [], action: 'block', status: 'enabled',
    remark: null, tenantId: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  batchMock.mockResolvedValue({ lists: [], hits: [] });
  snapshotMock.mockResolvedValue(null);
});

describe('evaluateRisk · 基础', () => {
  it('无规则且策略表未发布 → pass', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    expect(await evaluateRisk(baseInput)).toEqual({ action: 'pass' });
    expect(decideMock).not.toHaveBeenCalled();
  });
});

describe('evaluateRisk · L1 名单库', () => {
  it('黑名单命中 → 规则动作 + dimension=blocklist（值@名单key）', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeRule({ blockListKeys: ['risk_blacklist'] })]));
    batchMock.mockResolvedValue({
      lists: [{ key: 'risk_blacklist', id: 5, type: 'black', tenantId: null }],
      hits: [{ key: 'risk_blacklist', listId: 5, value: 'oUSER1', listType: 'black', label: null, matchMode: 'exact', expiresAt: null }],
    });
    const res = await evaluateRisk(baseInput);
    expect(res).toMatchObject({ action: 'block', ruleId: 1, dimension: 'blocklist', dimensionValue: 'oUSER1@risk_blacklist' });
    expect(batchMock).toHaveBeenCalledWith(['risk_blacklist'], ['oUSER1', '7', '1.2.3.4'], { tenantId: null });
  });

  it('白名单命中 → 跳过本规则全部检查（含黑名单与限额）', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeRule({ blockListKeys: ['risk_blacklist'], allowListKeys: ['vip_whitelist'], singleLimit: 1 })]));
    batchMock.mockResolvedValue({
      lists: [
        { key: 'risk_blacklist', id: 5, type: 'black', tenantId: null },
        { key: 'vip_whitelist', id: 6, type: 'white', tenantId: null },
      ],
      hits: [
        { key: 'vip_whitelist', listId: 6, value: 'oUSER1', listType: 'white', label: null, matchMode: 'exact', expiresAt: null },
        { key: 'risk_blacklist', listId: 5, value: '1.2.3.4', listType: 'black', label: null, matchMode: 'exact', expiresAt: null },
      ],
    });
    expect(await evaluateRisk(baseInput)).toEqual({ action: 'pass' });
  });

  it('原生维度保留：单笔上限命中 → block', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeRule({ singleLimit: 5000 })]));
    const res = await evaluateRisk(baseInput);
    expect(res).toMatchObject({ action: 'block', ruleId: 1, dimension: 'single_limit' });
  });
});

describe('evaluateRisk · L2 决策表策略', () => {
  const publishedSnapshot = { tableId: 2, tenantId: null, version: 1, hitPolicy: 'first', inputs: [], outputs: [], rules: [], settings: {} };

  function mockL2(outputs: Record<string, unknown>, matched = true) {
    snapshotMock.mockResolvedValue(publishedSnapshot as never);
    // 当日聚合（global/channel/bizType 三次）
    dbMock.select
      .mockReturnValueOnce(createChain([{ total: 0, count: 0 }]))
      .mockReturnValueOnce(createChain([{ total: 0, count: 0 }]))
      .mockReturnValueOnce(createChain([{ total: 0, count: 0 }]));
    decideMock.mockResolvedValue({ matched, outputs, ref: { kind: 'table', key: 'payment_risk', version: 1 } });
  }

  it('决策表 matched block → dimension=decision（ruleId=null），不再走原生维度', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeRule({ singleLimit: 1 })])); // 原生规则若执行必 block
    mockL2({ action: 'block', reason: '策略拦截' });
    const res = await evaluateRisk(baseInput);
    expect(res).toMatchObject({ action: 'block', ruleId: null, dimension: 'decision', message: '策略拦截' });
    expect(decideMock).toHaveBeenCalledWith(
      { kind: 'table', key: 'payment_risk' },
      expect.objectContaining({ order: expect.objectContaining({ amount: 10000 }), today: expect.any(Object), hit: expect.any(Object), subject: expect.any(Object) }),
      expect.objectContaining({ caller: 'payment.risk' }),
    );
  });

  it('决策表 matched pass → 显式放行，跳过原生检查', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeRule({ singleLimit: 1 })]));
    mockL2({ action: 'pass' });
    expect(await evaluateRisk(baseInput)).toEqual({ action: 'pass' });
  });

  it('决策表未命中 → 回退原生维度', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeRule({ singleLimit: 5000 })]));
    mockL2({}, false);
    const res = await evaluateRisk(baseInput);
    expect(res).toMatchObject({ action: 'block', dimension: 'single_limit' });
  });

  it('决策表输出无有效动作 → 回退原生维度', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeRule({ singleLimit: 5000 })]));
    mockL2({ action: 'unknown' });
    const res = await evaluateRisk(baseInput);
    expect(res).toMatchObject({ action: 'block', dimension: 'single_limit' });
  });
});
