/**
 * 会员资金链路（积分 / 钱包 / 优惠券）— 数据库集成测试（默认跳过）。
 *
 * 覆盖人工最难验证的并发正确性与幂等：
 * - changePoints()：事务 + 乐观锁防超扣、无丢失更新、流水与账户严格一致
 * - changeWallet()：并发消费不超扣；creditWalletOnRecharge() 重复投递（串行/并发）仅入账一次
 * - 优惠券：并发核销同一券码防双花、并发领取防超发/防超限、过期标记持久化
 *
 * 需要可用的 PostgreSQL（默认连接见 .env）。为避免普通 `npm test` 触库，
 * 仅在显式 opt-in 时运行：
 *   PowerShell:  $env:MEMBER_FUNDS_DB_IT='1'; npx vitest run src/services/member-funds.it.test.ts
 *   Bash:        MEMBER_FUNDS_DB_IT=1 npx vitest run src/services/member-funds.it.test.ts
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { and, asc, eq, inArray } from 'drizzle-orm';

const RUN = process.env.MEMBER_FUNDS_DB_IT === '1';

/** 并发测试的超时放宽（乐观锁重试 + 行锁等待）*/
const CONCURRENT = { timeout: 20_000 };

function splitResults<T>(results: PromiseSettledResult<T>[]) {
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled').map((r) => r.value);
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason as unknown);
  return { fulfilled, rejected };
}

/** 断言所有失败原因均为预期状态码的 HTTPException（不允许出现其它类型错误）*/
function expectAllHttpErrors(rejected: unknown[], allowedStatuses: number[]) {
  for (const err of rejected) {
    expect(err).toBeInstanceOf(HTTPException);
    expect(allowedStatuses).toContain((err as HTTPException).status);
  }
}

/** 校验追加型流水链：从 0 开始逐笔累计，每笔 balanceAfter 与累计值一致，终值等于账户余额 */
function expectLedgerChain(rows: { amount: number; balanceAfter: number }[], finalBalance: number) {
  let running = 0;
  for (const r of rows) {
    running += r.amount;
    expect(r.balanceAfter).toBe(running);
  }
  expect(running).toBe(finalBalance);
}

describe.runIf(RUN)('member funds (DB integration)', () => {
  let db: typeof import('../db')['db'];
  let schema: typeof import('../db/schema');
  let points: typeof import('./member-points.service');
  let wallet: typeof import('./member-wallet.service');
  let couponsSvc: typeof import('./coupons.service');

  const memberIds: number[] = [];
  const couponIds: number[] = [];
  const tag = Date.now();
  let seq = 0;

  async function newMember(): Promise<number> {
    seq += 1;
    const [m] = await db
      .insert(schema.members)
      .values({ nickname: `it-funds-${tag}-${seq}`, username: `it_funds_${tag}_${seq}` })
      .returning({ id: schema.members.id });
    memberIds.push(m.id);
    return m.id;
  }

  async function newCoupon(patch: Partial<typeof schema.coupons.$inferInsert> = {}): Promise<number> {
    seq += 1;
    const [c] = await db
      .insert(schema.coupons)
      .values({
        name: `it-coupon-${tag}-${seq}`,
        type: 'amount',
        faceValue: 500,
        status: 'active',
        validType: 'relative',
        validDays: 30,
        totalQuantity: 0,
        perLimit: 0,
        ...patch,
      })
      .returning({ id: schema.coupons.id });
    couponIds.push(c.id);
    return c.id;
  }

  /** 模拟一次独立请求中的发放（issueCoupon/receiveCoupon 的共同核心路径）*/
  function grantOnce(couponId: number, memberId: number) {
    return db.transaction(async (tx) => couponsSvc.grantCouponInTx(tx, couponId, memberId));
  }

  const pointAccRow = async (memberId: number) =>
    (await db.select().from(schema.memberPointAccounts).where(eq(schema.memberPointAccounts.memberId, memberId)))[0];
  const pointTxRows = (memberId: number) =>
    db.select().from(schema.memberPointTransactions)
      .where(eq(schema.memberPointTransactions.memberId, memberId))
      .orderBy(asc(schema.memberPointTransactions.id));
  const walletRow = async (memberId: number) =>
    (await db.select().from(schema.memberWallets).where(eq(schema.memberWallets.memberId, memberId)))[0];
  const walletTxRows = (memberId: number) =>
    db.select().from(schema.memberWalletTransactions)
      .where(eq(schema.memberWalletTransactions.memberId, memberId))
      .orderBy(asc(schema.memberWalletTransactions.id));

  beforeAll(async () => {
    db = (await import('../db')).db;
    schema = await import('../db/schema');
    points = await import('./member-points.service');
    wallet = await import('./member-wallet.service');
    couponsSvc = await import('./coupons.service');
  });

  afterAll(async () => {
    // members 级联清理积分账户/流水、钱包/流水、券码；coupons 级联清理剩余券码
    if (couponIds.length) await db.delete(schema.coupons).where(inArray(schema.coupons.id, couponIds));
    if (memberIds.length) await db.delete(schema.members).where(inArray(schema.members.id, memberIds));
    await (await import('../db')).closeDb();
  });

  // ─── changePoints：统一积分记账 ───────────────────────────────────────────────
  describe('changePoints — 事务 + 乐观锁记账', () => {
    it('顺序记账：余额、累计值、version、流水链完全一致', async () => {
      const mid = await newMember();
      await points.ensurePointAccount(mid);
      for (let i = 0; i < 5; i++) await points.earnPoints(mid, 10, { bizType: 'it', bizId: `earn-${i}` });
      await points.redeemPoints(mid, 30, { bizType: 'it', bizId: 'redeem-1' });

      const acc = await pointAccRow(mid);
      expect(acc.balance).toBe(20);
      expect(acc.totalEarned).toBe(50);
      expect(acc.totalSpent).toBe(30);
      expect(acc.version).toBe(6);

      const txs = await pointTxRows(mid);
      expect(txs).toHaveLength(6);
      expectLedgerChain(txs, acc.balance);
    });

    it('变动量为 0 拒绝（400）', async () => {
      const mid = await newMember();
      await points.ensurePointAccount(mid);
      await expect(points.changePoints({ memberId: mid, type: 'adjust', amount: 0 })).rejects.toHaveProperty('status', 400);
    });

    it('积分账户不存在抛 404', async () => {
      const mid = await newMember();
      await expect(points.earnPoints(mid, 10)).rejects.toHaveProperty('status', 404);
    });

    it('并发 earn：无丢失更新，成功笔数与账户/流水/version 严格一致', CONCURRENT, async () => {
      const mid = await newMember();
      await points.ensurePointAccount(mid);

      const N = 8;
      const results = await Promise.allSettled(
        Array.from({ length: N }, (_, i) => points.earnPoints(mid, 10, { bizType: 'it-conc', bizId: String(i) })),
      );
      const { fulfilled, rejected } = splitResults(results);
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      // 失败只允许是乐观锁重试耗尽（409），不允许静默丢失或错误入账
      expectAllHttpErrors(rejected, [409]);

      const acc = await pointAccRow(mid);
      expect(acc.balance).toBe(fulfilled.length * 10);
      expect(acc.totalEarned).toBe(fulfilled.length * 10);
      expect(acc.version).toBe(fulfilled.length);

      const txs = await pointTxRows(mid);
      expect(txs).toHaveLength(fulfilled.length); // 失败事务完整回滚，不残留流水
      expectLedgerChain(txs, acc.balance);
    });

    it('并发 redeem：余额受限时绝不超扣', CONCURRENT, async () => {
      const mid = await newMember();
      await points.ensurePointAccount(mid);
      await points.earnPoints(mid, 50);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => points.redeemPoints(mid, 10, { bizType: 'it-conc-redeem' })),
      );
      const { fulfilled, rejected } = splitResults(results);
      // 余额 50 最多支撑 5 笔各 10 分的扣减
      expect(fulfilled.length).toBeLessThanOrEqual(5);
      // 失败只允许是余额不足（400）或冲突重试耗尽（409）
      expectAllHttpErrors(rejected, [400, 409]);

      const acc = await pointAccRow(mid);
      expect(acc.balance).toBe(50 - fulfilled.length * 10);
      expect(acc.balance).toBeGreaterThanOrEqual(0);
      expect(acc.totalSpent).toBe(fulfilled.length * 10);

      const txs = await pointTxRows(mid);
      expectLedgerChain(txs, acc.balance);
    });
  });

  // ─── changeWallet：钱包记账（单位分）──────────────────────────────────────────
  describe('changeWallet — 钱包记账与充值幂等', () => {
    it('并发 consume：余额受限时绝不超扣（透支为 0 容忍）', CONCURRENT, async () => {
      const mid = await newMember();
      await wallet.ensureWallet(mid);
      await wallet.changeWallet({ memberId: mid, type: 'recharge', amount: 5000, bizType: 'it-init' });

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => wallet.consumeWallet(mid, 1000, { bizType: 'it-conc-consume' })),
      );
      const { fulfilled, rejected } = splitResults(results);
      expect(fulfilled.length).toBeLessThanOrEqual(5);
      expectAllHttpErrors(rejected, [400, 409]);

      const w = await walletRow(mid);
      expect(w.balance).toBe(5000 - fulfilled.length * 1000);
      expect(w.balance).toBeGreaterThanOrEqual(0);
      expect(w.totalConsume).toBe(fulfilled.length * 1000);
      expect(w.totalRecharge).toBe(5000);

      const txs = await walletTxRows(mid);
      expectLedgerChain(txs, w.balance);
    });

    it('creditWalletOnRecharge — 同一支付单串行重复投递仅入账一次', async () => {
      const mid = await newMember();
      const orderNo = `IT-RCH-${tag}-S`;
      await wallet.creditWalletOnRecharge({ bizId: String(mid), orderNo, amount: 8888 });
      await wallet.creditWalletOnRecharge({ bizId: String(mid), orderNo, amount: 8888 });

      const w = await walletRow(mid);
      expect(w.balance).toBe(8888);
      expect(w.totalRecharge).toBe(8888);
      const txs = await walletTxRows(mid);
      expect(txs.filter((t) => t.bizId === orderNo)).toHaveLength(1);
    });

    it('creditWalletOnRecharge — 同一支付单并发重复投递仅入账一次', CONCURRENT, async () => {
      const mid = await newMember();
      const orderNo = `IT-RCH-${tag}-C`;
      await Promise.all(
        Array.from({ length: 5 }, () => wallet.creditWalletOnRecharge({ bizId: String(mid), orderNo, amount: 500 })),
      );

      const w = await walletRow(mid);
      expect(w.balance).toBe(500);
      expect(w.totalRecharge).toBe(500);
      const txs = await walletTxRows(mid);
      expect(txs.filter((t) => t.bizId === orderNo)).toHaveLength(1);
    });

    it('creditWalletOnRecharge — bizId 非法时静默忽略不抛错', async () => {
      await expect(
        wallet.creditWalletOnRecharge({ bizId: 'not-a-number', orderNo: `IT-RCH-${tag}-BAD`, amount: 100 }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── 优惠券：并发发放与核销 ───────────────────────────────────────────────────
  describe('优惠券 — 并发发放与核销', () => {
    it('并发领取限量券不超发（原子库存扣减）', CONCURRENT, async () => {
      const cid = await newCoupon({ totalQuantity: 3, perLimit: 0 });
      const mid = await newMember();

      const results = await Promise.allSettled(Array.from({ length: 8 }, () => grantOnce(cid, mid)));
      const { fulfilled, rejected } = splitResults(results);
      expect(fulfilled).toHaveLength(3);
      expectAllHttpErrors(rejected, [400]);

      const [c] = await db.select().from(schema.coupons).where(eq(schema.coupons.id, cid));
      expect(c.issuedQuantity).toBe(3);
      const held = await db.$count(schema.memberCoupons, eq(schema.memberCoupons.couponId, cid));
      expect(held).toBe(3);
    });

    it('同会员并发领取不突破每人限领', CONCURRENT, async () => {
      const cid = await newCoupon({ totalQuantity: 0, perLimit: 1 });
      const mid = await newMember();

      const results = await Promise.allSettled(Array.from({ length: 6 }, () => grantOnce(cid, mid)));
      const { fulfilled, rejected } = splitResults(results);
      expect(fulfilled).toHaveLength(1);
      expectAllHttpErrors(rejected, [400]);

      const held = await db.$count(
        schema.memberCoupons,
        and(eq(schema.memberCoupons.couponId, cid), eq(schema.memberCoupons.memberId, mid)),
      );
      expect(held).toBe(1);
    });

    it('并发核销同一券码仅一次成功（防双花）', CONCURRENT, async () => {
      const cid = await newCoupon();
      const mid = await newMember();
      const mc = await grantOnce(cid, mid);

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) => couponsSvc.redeemCoupon(mc.code, { bizType: 'it-order', bizId: `O-${i}` })),
      );
      const { fulfilled, rejected } = splitResults(results);
      expect(fulfilled).toHaveLength(1);
      expectAllHttpErrors(rejected, [400]);

      const [row] = await db.select().from(schema.memberCoupons).where(eq(schema.memberCoupons.id, mc.id));
      expect(row.status).toBe('used');
      expect(row.usedAt).not.toBeNull();
      expect(row.bizType).toBe('it-order');
    });

    it('已核销券再次核销被拒绝（400）', async () => {
      const cid = await newCoupon();
      const mid = await newMember();
      const mc = await grantOnce(cid, mid);
      await couponsSvc.redeemCoupon(mc.code);
      await expect(couponsSvc.redeemCoupon(mc.code)).rejects.toHaveProperty('status', 400);
    });

    it('券码不存在抛 404', async () => {
      await expect(couponsSvc.redeemCoupon(`CP-IT-${tag}-MISSING`)).rejects.toHaveProperty('status', 404);
    });

    it('过期券核销被拒且过期标记持久化', async () => {
      const cid = await newCoupon();
      const mid = await newMember();
      const [mc] = await db
        .insert(schema.memberCoupons)
        .values({
          couponId: cid,
          memberId: mid,
          code: `CPIT${tag}EXP`,
          status: 'unused',
          expireAt: new Date(Date.now() - 3_600_000),
        })
        .returning();

      await expect(couponsSvc.redeemCoupon(mc.code)).rejects.toHaveProperty('status', 400);
      // 过期标记必须落库（不得被抛错事务回滚）
      const [row] = await db.select().from(schema.memberCoupons).where(eq(schema.memberCoupons.id, mc.id));
      expect(row.status).toBe('expired');
    });
  });
});
