/**
 * 支付手续费 Service 单测。
 *
 * 覆盖要点：
 *  1. computeFeeByRule（纯函数，资金安全关键）：万分比费率、固定费、四舍五入、
 *     min/max clamp、手续费不超过订单金额、不为负数
 *  2. matchFeeRule：无规则返回 null、payMethod 精确匹配优先、按优先级兜底
 *  3. settleOrderFee 幂等结算：订单不存在跳过、正常计费回写 + 台账、
 *     并发竞争失败读回真实费用、已计费仅补 netAmount、零费用不记台账
 *
 * Mock 策略：db / payment-ledger / logger mock；schema 使用真实表定义（drizzle 条件构造不依赖连接）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return { db };
});

vi.mock('./payment-ledger.service', () => ({
  recordLedgerEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { db } from '../../db';
import { recordLedgerEntry } from './payment-ledger.service';
import { computeFeeByRule, matchFeeRule, settleOrderFee } from './payment-fee.service';
import type { PaymentFeeRuleRow } from '../../db/schema';

const dbMock = vi.mocked(db);
const ledgerMock = vi.mocked(recordLedgerEntry);

// ─── 工具：可 await 的链式 query builder mock ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'limit', 'offset', 'orderBy', 'set', 'values', 'returning'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeRule(overrides: Partial<PaymentFeeRuleRow> = {}): PaymentFeeRuleRow {
  return {
    id: 1,
    name: '默认费率',
    channel: 'wechat',
    payMethod: null,
    rateBps: 0,
    fixedFee: 0,
    minFee: null,
    maxFee: null,
    status: 'enabled',
    priority: 0,
    remark: null,
    tenantId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentFeeRuleRow;
}

beforeEach(() => {
  // resetAllMocks 同时清空 mockReturnValueOnce 队列，避免失败用例的残留 mock 污染后续用例
  vi.resetAllMocks();
  ledgerMock.mockResolvedValue(undefined);
});

// ─── computeFeeByRule ─────────────────────────────────────────────────────────
describe('computeFeeByRule - 手续费计算（金额单位：分）', () => {
  it('纯费率：10000 分 × 100bps（1%）= 100 分', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 100 }), 10000)).toBe(100);
  });

  it('纯固定费', () => {
    expect(computeFeeByRule(makeRule({ fixedFee: 50 }), 10000)).toBe(50);
  });

  it('费率 + 固定费叠加：10000 × 60bps + 10 = 70', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 60, fixedFee: 10 }), 10000)).toBe(70);
  });

  it('四舍五入：3333 × 15bps = 4.9995 → 5', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 15 }), 3333)).toBe(5);
  });

  it('半分进位：250 × 100bps = 2.5 → 3', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 100 }), 250)).toBe(3);
  });

  it('minFee 向上兜底', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 10, minFee: 20 }), 1000)).toBe(20); // 原始 1 分 → 20
  });

  it('maxFee 向下封顶', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 100, maxFee: 50 }), 100000)).toBe(50); // 原始 1000 分 → 50
  });

  it('手续费不超过订单金额（minFee 大于金额时 clamp 到金额）', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 100, minFee: 50 }), 10)).toBe(10);
  });

  it('手续费不为负（异常负固定费防护）', () => {
    expect(computeFeeByRule(makeRule({ fixedFee: -50 }), 10000)).toBe(0);
  });

  it('零金额订单手续费为 0（固定费也被金额上限压到 0）', () => {
    expect(computeFeeByRule(makeRule({ rateBps: 100, fixedFee: 30 }), 0)).toBe(0);
  });

  it('零费率零固定费 → 0', () => {
    expect(computeFeeByRule(makeRule(), 10000)).toBe(0);
  });
});

// ─── matchFeeRule ─────────────────────────────────────────────────────────────
describe('matchFeeRule - 规则匹配', () => {
  it('无任何启用规则 → null', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    expect(await matchFeeRule('wechat', 'wechat_native', null)).toBeNull();
  });

  it('payMethod 精确匹配优先于通用规则（即使通用规则优先级更高）', async () => {
    const generic = makeRule({ id: 1, name: '通用', payMethod: null, priority: 100 });
    const exact = makeRule({ id: 2, name: '精确', payMethod: 'wechat_native', priority: 1 });
    dbMock.select.mockReturnValueOnce(createChain([generic, exact])); // 已按 priority 降序
    const matched = await matchFeeRule('wechat', 'wechat_native', null);
    expect(matched?.id).toBe(2);
  });

  it('无精确匹配时取排序首位（优先级最高）的通用规则', async () => {
    const high = makeRule({ id: 3, name: '高优先', payMethod: null, priority: 10 });
    const low = makeRule({ id: 4, name: '低优先', payMethod: null, priority: 1 });
    dbMock.select.mockReturnValueOnce(createChain([high, low]));
    const matched = await matchFeeRule('wechat', 'wechat_jsapi', null);
    expect(matched?.id).toBe(3);
  });
});

// ─── settleOrderFee ───────────────────────────────────────────────────────────
interface OrderLike {
  id: number;
  orderNo: string;
  amount: number;
  paidAmount: number | null;
  feeAmount: number | null;
  netAmount: number | null;
  channel: string;
  payMethod: string;
  bizType: string;
  tenantId: number | null;
}

function makeOrder(overrides: Partial<OrderLike> = {}): OrderLike {
  return {
    id: 11,
    orderNo: 'PO20260705001',
    amount: 10000,
    paidAmount: 10000,
    feeAmount: null,
    netAmount: null,
    channel: 'wechat',
    payMethod: 'wechat_native',
    bizType: 'member_recharge',
    tenantId: null,
    ...overrides,
  };
}

describe('settleOrderFee - 幂等结算', () => {
  it('订单不存在 → 直接返回，不更新不记账', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    await settleOrderFee('NO-SUCH-ORDER');
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(ledgerMock).not.toHaveBeenCalled();
  });

  it('未计费订单：匹配规则计费 → 回写 feeAmount/netAmount + 记台账（带规则名）', async () => {
    const order = makeOrder();
    const rule = makeRule({ name: '微信标准费率', rateBps: 60 }); // 10000 × 60bps = 60
    dbMock.select
      .mockReturnValueOnce(createChain([order])) // 查订单
      .mockReturnValueOnce(createChain([rule])); // matchFeeRule
    const claimChain = createChain([{ feeAmount: 60 }]); // claim 成功
    dbMock.update.mockReturnValueOnce(claimChain);

    await settleOrderFee(order.orderNo);

    expect(claimChain.set).toHaveBeenCalledWith({ feeAmount: 60, netAmount: 9940 });
    expect(ledgerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'out',
        type: 'fee',
        amount: 60,
        orderNo: order.orderNo,
        remark: '手续费（微信标准费率）',
      }),
    );
  });

  it('无匹配规则 → 手续费 0，回写但不记台账', async () => {
    const order = makeOrder();
    dbMock.select
      .mockReturnValueOnce(createChain([order]))
      .mockReturnValueOnce(createChain([])); // 无规则
    const claimChain = createChain([{ feeAmount: 0 }]);
    dbMock.update.mockReturnValueOnce(claimChain);

    await settleOrderFee(order.orderNo);

    expect(claimChain.set).toHaveBeenCalledWith({ feeAmount: 0, netAmount: 10000 });
    expect(ledgerMock).not.toHaveBeenCalled();
  });

  it('并发竞争失败（claim 未命中）→ 读回真实费用，台账用通用备注（重复投递不重复计费）', async () => {
    const order = makeOrder();
    const rule = makeRule({ name: '规则A', rateBps: 100 }); // 本次计算 100
    dbMock.select
      .mockReturnValueOnce(createChain([order]))
      .mockReturnValueOnce(createChain([rule]))
      .mockReturnValueOnce(createChain([{ feeAmount: 88 }])); // 读回另一投递已写入的 88
    dbMock.update.mockReturnValueOnce(createChain([])); // claim 失败

    await settleOrderFee(order.orderNo);

    expect(ledgerMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 88, remark: '手续费' }));
  });

  it('已计费但缺 netAmount（崩溃恢复）→ 仅补 netAmount，不重新匹配规则', async () => {
    const order = makeOrder({ feeAmount: 60, netAmount: null });
    dbMock.select.mockReturnValueOnce(createChain([order]));
    const fixChain = createChain([]);
    dbMock.update.mockReturnValueOnce(fixChain);

    await settleOrderFee(order.orderNo);

    expect(dbMock.select).toHaveBeenCalledTimes(1); // 不再查询规则
    expect(fixChain.set).toHaveBeenCalledWith({ netAmount: 9940 });
    expect(ledgerMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 60 }));
  });

  it('已计费且 netAmount 已写 → 不更新订单，仅补台账（台账幂等由唯一索引兜底）', async () => {
    const order = makeOrder({ feeAmount: 60, netAmount: 9940 });
    dbMock.select.mockReturnValueOnce(createChain([order]));

    await settleOrderFee(order.orderNo);

    expect(dbMock.update).not.toHaveBeenCalled();
    expect(ledgerMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 60 }));
  });

  it('paidAmount 为空时按订单金额计费', async () => {
    const order = makeOrder({ paidAmount: null, amount: 5000 });
    const rule = makeRule({ rateBps: 100 }); // 5000 × 1% = 50
    dbMock.select
      .mockReturnValueOnce(createChain([order]))
      .mockReturnValueOnce(createChain([rule]));
    const claimChain = createChain([{ feeAmount: 50 }]);
    dbMock.update.mockReturnValueOnce(claimChain);

    await settleOrderFee(order.orderNo);

    expect(claimChain.set).toHaveBeenCalledWith({ feeAmount: 50, netAmount: 4950 });
  });
});
