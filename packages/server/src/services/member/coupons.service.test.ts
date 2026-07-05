/**
 * 优惠券 Service 单测（发券库存 / 限领 / 核销双花防护，数据变更安全关键）。
 *
 * 覆盖要点：
 *  1. issueCoupon：券/会员不存在 404、规则中心资格拒发 400、限领超额 400、
 *     库存售罄 400（原子 UPDATE 未命中）、成功发放（相对有效期换算 expireAt）
 *  2. receiveCoupon：非 active 模板不可领、固定有效期已过期不可领、成功领取
 *  3. redeemCoupon：原子核销成功、券码不存在 404、已过期标记 expired + 400、
 *     已使用/冻结 400（防双花）
 *  4. revokeCoupon：已使用不可作废、未使用冻结成功
 *  5. expireCoupons：返回批量置过期数量
 *
 * Mock 策略：db / member-context / rules.service mock；事务回调直接以 db mock 作为 tx。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
    query: {
      memberCoupons: { findFirst: vi.fn(), findMany: vi.fn() },
    },
  };
  return { db };
});

vi.mock('../../lib/member-context', () => ({
  currentMemberId: vi.fn().mockReturnValue(7),
}));

vi.mock('../platform/rules.service', () => ({
  getDecisionOutputs: vi.fn().mockResolvedValue({}),
}));

import { db } from '../../db';
import { currentMemberId } from '../../lib/member-context';
import { getDecisionOutputs } from '../platform/rules.service';
import {
  issueCoupon,
  receiveCoupon,
  redeemCoupon,
  revokeCoupon,
  expireCoupons,
} from './coupons.service';
import type { CouponRow, MemberCouponRow } from '../../db/schema';

const dbMock = vi.mocked(db);
const decisionMock = vi.mocked(getDecisionOutputs);

// ─── 工具：可 await 的链式 query builder mock ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'limit', 'offset', 'orderBy', 'set', 'values', 'returning', 'for'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeCoupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    id: 1,
    name: '满100减10',
    type: 'discount',
    faceValue: 1000,
    threshold: 10000,
    maxDiscount: null,
    totalQuantity: 100,
    issuedQuantity: 0,
    perLimit: 1,
    validType: 'relative',
    validStart: null,
    validEnd: null,
    validDays: 7,
    status: 'active',
    description: null,
    createdAt: new Date('2026-07-01T00:00:00'),
    updatedAt: new Date('2026-07-01T00:00:00'),
    ...overrides,
  } as CouponRow;
}

function makeMemberCoupon(overrides: Partial<MemberCouponRow> = {}): MemberCouponRow {
  return {
    id: 5,
    couponId: 1,
    memberId: 7,
    code: 'CP0123456789ABCDEF',
    status: 'unused',
    receivedAt: new Date('2026-07-01T10:00:00'),
    usedAt: null,
    expireAt: new Date('2026-07-08T10:00:00'),
    bizType: null,
    bizId: null,
    createdAt: new Date('2026-07-01T10:00:00'),
    ...overrides,
  } as MemberCouponRow;
}

beforeEach(() => {
  // resetAllMocks 同时清空 mockReturnValueOnce 队列，避免失败用例的残留 mock 污染后续用例
  vi.resetAllMocks();
  decisionMock.mockResolvedValue({});
  vi.mocked(currentMemberId).mockReturnValue(7);
  dbMock.transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
});

// ─── issueCoupon（后台发券） ──────────────────────────────────────────────────
describe('issueCoupon', () => {
  const member = { id: 7, levelId: 1, growthValue: 100 };

  function mockHappyPathUntilGrant(coupon: CouponRow) {
    dbMock.select
      .mockReturnValueOnce(createChain([coupon]))   // 查券模板
      .mockReturnValueOnce(createChain([member]))   // 查会员
      .mockReturnValueOnce(createChain([{ id: coupon.id }])); // perLimit 行锁
  }

  it('优惠券不存在 → 404', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    await expect(issueCoupon(999, 7)).rejects.toMatchObject({ status: 404, message: '优惠券不存在' });
  });

  it('会员不存在 → 404', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([makeCoupon()]))
      .mockReturnValueOnce(createChain([]));
    await expect(issueCoupon(1, 999)).rejects.toMatchObject({ status: 404, message: '会员不存在' });
  });

  it('规则中心判定不合格 → 400 拒发', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([makeCoupon()]))
      .mockReturnValueOnce(createChain([member]));
    decisionMock.mockResolvedValueOnce({ eligible: false });
    await expect(issueCoupon(1, 7)).rejects.toMatchObject({ status: 400, message: '该会员不满足此优惠券发放资格' });
  });

  it('已达每人限领数量 → 400（行锁 + 计数防并发突破限领）', async () => {
    mockHappyPathUntilGrant(makeCoupon({ perLimit: 2 }));
    dbMock.$count.mockResolvedValueOnce(2); // 已持有 2 张 ≥ perLimit 2
    await expect(issueCoupon(1, 7)).rejects.toMatchObject({ status: 400, message: '已达每人限领数量' });
    expect(dbMock.update).not.toHaveBeenCalled(); // 未进入库存扣减
  });

  it('库存售罄（原子 UPDATE 未命中）→ 400 防超发', async () => {
    mockHappyPathUntilGrant(makeCoupon({ totalQuantity: 100, issuedQuantity: 100 }));
    dbMock.$count.mockResolvedValueOnce(0);
    dbMock.update.mockReturnValueOnce(createChain([])); // 条件更新未命中
    await expect(issueCoupon(1, 7)).rejects.toMatchObject({ status: 400, message: '优惠券已领完' });
    expect(dbMock.insert).not.toHaveBeenCalled(); // 不落券码
  });

  it('成功发放：库存 +1、写入券码、相对有效期换算 expireAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T12:00:00'));
    try {
      const coupon = makeCoupon({ validType: 'relative', validDays: 7 });
      mockHappyPathUntilGrant(coupon);
      dbMock.$count.mockResolvedValueOnce(0);
      dbMock.update.mockReturnValueOnce(createChain([{ id: coupon.id }]));
      const insertChain = createChain([makeMemberCoupon()]);
      dbMock.insert.mockReturnValueOnce(insertChain);

      const result = await issueCoupon(1, 7);

      const inserted = insertChain.values.mock.calls[0][0];
      expect(inserted.couponId).toBe(1);
      expect(inserted.memberId).toBe(7);
      expect(inserted.status).toBe('unused');
      expect(inserted.code).toMatch(/^CP[0-9A-F]{16}$/);
      expect(inserted.expireAt).toEqual(new Date('2026-07-12T12:00:00')); // now + 7d
      expect(result.status).toBe('unused');
      expect(result.coupon?.name).toBe('满100减10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('固定有效期模板 expireAt 取 validEnd', async () => {
    const validEnd = new Date('2026-12-31T23:59:59');
    const coupon = makeCoupon({ validType: 'fixed', validEnd, validDays: null });
    mockHappyPathUntilGrant(coupon);
    dbMock.$count.mockResolvedValueOnce(0);
    dbMock.update.mockReturnValueOnce(createChain([{ id: coupon.id }]));
    const insertChain = createChain([makeMemberCoupon({ expireAt: validEnd })]);
    dbMock.insert.mockReturnValueOnce(insertChain);

    await issueCoupon(1, 7);

    expect(insertChain.values.mock.calls[0][0].expireAt).toBe(validEnd);
  });

  it('perLimit=0（不限领）跳过行锁与计数', async () => {
    const coupon = makeCoupon({ perLimit: 0 });
    dbMock.select
      .mockReturnValueOnce(createChain([coupon]))
      .mockReturnValueOnce(createChain([member]));
    dbMock.update.mockReturnValueOnce(createChain([{ id: coupon.id }]));
    dbMock.insert.mockReturnValueOnce(createChain([makeMemberCoupon()]));

    await issueCoupon(1, 7);

    expect(dbMock.$count).not.toHaveBeenCalled();
  });
});

// ─── receiveCoupon（前台自助领券） ────────────────────────────────────────────
describe('receiveCoupon', () => {
  it('模板非 active → 400 不可领取', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeCoupon({ status: 'draft' })]));
    await expect(receiveCoupon(1)).rejects.toMatchObject({ status: 400, message: '优惠券不可领取' });
  });

  it('固定有效期已过期 → 400', async () => {
    const coupon = makeCoupon({ validType: 'fixed', validEnd: new Date(Date.now() - 1000) });
    dbMock.select.mockReturnValueOnce(createChain([coupon]));
    await expect(receiveCoupon(1)).rejects.toMatchObject({ status: 400, message: '优惠券已过期' });
  });

  it('成功领取：归属当前登录会员（currentMemberId）', async () => {
    const coupon = makeCoupon({ perLimit: 0 });
    dbMock.select.mockReturnValueOnce(createChain([coupon]));
    dbMock.update.mockReturnValueOnce(createChain([{ id: coupon.id }]));
    const insertChain = createChain([makeMemberCoupon({ memberId: 7 })]);
    dbMock.insert.mockReturnValueOnce(insertChain);

    const result = await receiveCoupon(1);

    expect(insertChain.values.mock.calls[0][0].memberId).toBe(7);
    expect(result.memberId).toBe(7);
  });
});

// ─── redeemCoupon（核销，双花防护） ───────────────────────────────────────────
describe('redeemCoupon', () => {
  it('原子核销命中 → 返回已使用记录（带业务单号）', async () => {
    const used = makeMemberCoupon({ status: 'used', usedAt: new Date('2026-07-05T13:00:00') });
    const updateChain = createChain([used]);
    dbMock.update.mockReturnValueOnce(updateChain);

    const result = await redeemCoupon('CP0123456789ABCDEF', { bizType: 'order', bizId: 'SO-1001' });

    expect(result.status).toBe('used');
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'used', bizType: 'order', bizId: 'SO-1001' }),
    );
  });

  it('券码不存在 → 404', async () => {
    dbMock.update.mockReturnValueOnce(createChain([]));
    dbMock.select.mockReturnValueOnce(createChain([]));
    await expect(redeemCoupon('CPNOTEXIST')).rejects.toMatchObject({ status: 404, message: '券码不存在' });
  });

  it('未使用但已过期 → 落库 expired 标记并抛 400', async () => {
    const expired = makeMemberCoupon({ status: 'unused', expireAt: new Date(Date.now() - 1000) });
    dbMock.update.mockReturnValueOnce(createChain([])); // 原子核销未命中
    dbMock.select.mockReturnValueOnce(createChain([expired]));
    const markChain = createChain([]);
    dbMock.update.mockReturnValueOnce(markChain); // 过期标记

    await expect(redeemCoupon(expired.code)).rejects.toMatchObject({ status: 400, message: '优惠券已过期' });
    expect(markChain.set).toHaveBeenCalledWith({ status: 'expired' });
  });

  it('已使用的券再次核销 → 400 优惠券不可用（防双花）', async () => {
    dbMock.update.mockReturnValueOnce(createChain([]));
    dbMock.select.mockReturnValueOnce(createChain([makeMemberCoupon({ status: 'used' })]));
    await expect(redeemCoupon('CP0123456789ABCDEF')).rejects.toMatchObject({ status: 400, message: '优惠券不可用' });
  });

  it('冻结的券核销 → 400 优惠券不可用', async () => {
    dbMock.update.mockReturnValueOnce(createChain([]));
    dbMock.select.mockReturnValueOnce(createChain([makeMemberCoupon({ status: 'frozen' })]));
    await expect(redeemCoupon('CP0123456789ABCDEF')).rejects.toMatchObject({ status: 400, message: '优惠券不可用' });
  });

  it('核销条件包含 unused 状态 + 未过期（并发核销同一券码仅一次成功）', async () => {
    // 两次并发：第一次命中，第二次原子更新未命中 → 走已使用分支
    dbMock.update
      .mockReturnValueOnce(createChain([makeMemberCoupon({ status: 'used' })]))
      .mockReturnValueOnce(createChain([]));
    dbMock.select.mockReturnValueOnce(createChain([makeMemberCoupon({ status: 'used' })]));

    const first = await redeemCoupon('CP0123456789ABCDEF');
    expect(first.status).toBe('used');
    await expect(redeemCoupon('CP0123456789ABCDEF')).rejects.toThrow(HTTPException);
  });
});

// ─── revokeCoupon / expireCoupons ─────────────────────────────────────────────
describe('revokeCoupon', () => {
  it('记录不存在 → 404', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    await expect(revokeCoupon(999)).rejects.toMatchObject({ status: 404, message: '领券记录不存在' });
  });

  it('已使用的券不可作废 → 400', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMemberCoupon({ status: 'used' })]));
    await expect(revokeCoupon(5)).rejects.toMatchObject({ status: 400, message: '已使用的券不可作废' });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('未使用的券作废 → 置为 frozen', async () => {
    dbMock.select.mockReturnValueOnce(createChain([makeMemberCoupon({ status: 'unused' })]));
    const updateChain = createChain([]);
    dbMock.update.mockReturnValueOnce(updateChain);

    await revokeCoupon(5);

    expect(updateChain.set).toHaveBeenCalledWith({ status: 'frozen' });
  });
});

describe('expireCoupons', () => {
  it('返回批量置过期的行数', async () => {
    dbMock.update.mockReturnValueOnce(createChain([{ id: 1 }, { id: 2 }, { id: 3 }]));
    expect(await expireCoupons()).toBe(3);
  });

  it('无过期券时返回 0', async () => {
    dbMock.update.mockReturnValueOnce(createChain([]));
    expect(await expireCoupons()).toBe(0);
  });
});
