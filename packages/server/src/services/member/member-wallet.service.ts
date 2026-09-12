import { memberSelfContract, memberWalletContract } from '@zenith/shared/member';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 会员钱包服务。
 *
 * - changeWallet() 统一记账（事务 + 乐观锁 + 流水），余额单位为分
 * - rechargeWallet() 发起充值：调用支付中心 createPayment（bizType='member_recharge'）
 * - creditWalletOnRecharge() 由支付成功事件触发入账，按支付单号幂等
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { memberWallets, memberWalletTransactions, members, paymentOrders, paymentRefunds } from '../../db/schema';
import type { MemberWalletRow, MemberWalletTransactionRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { currentMemberId, currentMemberOrNull } from '../../lib/member-context';
import { currentUserOrNull } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { withOptimisticRetry, OptimisticLockError } from '../../lib/optimistic';
import { pageOffset } from '../../lib/pagination';
import { buildWhere } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import logger from '../../lib/logger';
import { createPayment } from '../payment/payment.service';
import { memberReferenceCondition, mapLedgerTransaction } from './member-query-helpers';
import type { WalletTxType } from '@zenith/shared/member';
import type { PaymentCashierMethod } from '@zenith/shared/payment';

/** 钱包充值的支付业务类型标识 */
export const WALLET_RECHARGE_BIZ_TYPE = 'member_recharge';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapWallet(row: MemberWalletRow) {
  return {
    memberId: row.memberId,
    balance: row.balance,
    frozen: row.frozen,
    totalRecharge: row.totalRecharge,
    totalConsume: row.totalConsume,
  };
}

export const mapWalletTransaction = (row: MemberWalletTransactionRow, memberName?: string | null) => mapLedgerTransaction(row, memberName);

/** Admin wallet APIs must resolve the member through the active tenant scope.
 * Member-facing calls run without an admin user and intentionally remain
 * scoped by the member token instead. */
function adminMemberScope(): SQL | undefined {
  const user = currentUserOrNull();
  return user ? tenantCondition(members, user) : undefined;
}

async function ensureWalletMember(memberId: number): Promise<void> {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt), adminMemberScope()))
    .limit(1);
  requireRow(member, '会员不存在');
}

// ─── 账户 ─────────────────────────────────────────────────────────────────────
export async function ensureWallet(memberId: number): Promise<MemberWalletRow> {
  await ensureWalletMember(memberId);
  const [w] = await db
    .select({ wallet: memberWallets })
    .from(memberWallets)
    .innerJoin(members, eq(members.id, memberWallets.memberId))
    .where(and(eq(memberWallets.memberId, memberId), isNull(members.deletedAt), adminMemberScope()))
    .limit(1);
  if (w) return w.wallet;
  // 兜底按需创建；并发首建时 onConflictDoNothing 容忍撞唯一索引，回读胜者行
  const [created] = await db.insert(memberWallets).values({ memberId }).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await db
    .select({ wallet: memberWallets })
    .from(memberWallets)
    .innerJoin(members, eq(members.id, memberWallets.memberId))
    .where(and(eq(memberWallets.memberId, memberId), isNull(members.deletedAt), adminMemberScope()))
    .limit(1);
  if (!existing) throw new HTTPException(500, { message: '钱包创建后无法读取' });
  return existing.wallet;
}

export async function getWallet(memberId: number) {
  return mapWallet(await ensureWallet(memberId));
}

export async function getWalletBeforeAudit(memberId: number) {
  await ensureWalletMember(memberId);
  const [wallet] = await db
    .select({ wallet: memberWallets })
    .from(memberWallets)
    .innerJoin(members, eq(members.id, memberWallets.memberId))
    .where(and(eq(memberWallets.memberId, memberId), isNull(members.deletedAt), adminMemberScope()))
    .limit(1);
  return mapWallet(requireRow(wallet, '钱包不存在').wallet);
}

export async function getMyWallet() {
  return getWallet(currentMemberId());
}

// ─── 统一记账入口 ─────────────────────────────────────────────────────────────
export interface ChangeWalletInput {
  memberId: number;
  type: WalletTxType;
  /** 带符号变动量（分）：recharge/refund 为正，consume 为负，adjust 可正可负 */
  amount: number;
  bizType?: string;
  bizId?: string;
  paymentIntentNo?: string;
  paymentEventId?: string;
  remark?: string;
  operatorId?: number;
  /** Internal refund chargebacks may create a recoverable negative balance. */
  allowNegative?: boolean;
}

export interface WalletChangeResult {
  newBalance: number;
  newTotalRecharge: number;
  newTotalConsume: number;
}

/**
 * 计算钱包账户变动后的新值（纯函数，无 DB 依赖，单位分）。
 * - 仅 recharge 类型且正额累加 totalRecharge；仅 consume 类型且负额累加 totalConsume
 * - 余额不足（变动后 < 0）抛 400，防超扣
 */
export function computeWalletChange(
  w: { balance: number; totalRecharge: number; totalConsume: number },
  type: WalletTxType,
  amount: number,
  options?: { allowNegative?: boolean },
): WalletChangeResult {
  const newBalance = w.balance + amount;
  if (newBalance < 0 && !options?.allowNegative) throw new HTTPException(400, { message: '余额不足' });
  return {
    newBalance,
    newTotalRecharge: type === 'recharge' && amount > 0 ? w.totalRecharge + amount : w.totalRecharge,
    newTotalConsume: type === 'consume' && amount < 0 ? w.totalConsume + Math.abs(amount) : w.totalConsume,
  };
}

/** 事务内应用一次钱包变动（乐观锁 CAS + 原子写流水）。版本冲突抛 OptimisticLockError，由调用方重试整个事务。 */
async function applyWalletChange(tx: DbTransaction, input: ChangeWalletInput): Promise<MemberWalletRow> {
  const [w] = await tx.select().from(memberWallets).where(eq(memberWallets.memberId, input.memberId)).limit(1);
  const wallet = requireRow(w, '钱包不存在');

  const { newBalance, newTotalRecharge, newTotalConsume } = computeWalletChange(wallet, input.type, input.amount, { allowNegative: input.allowNegative });

  const updated = await tx
    .update(memberWallets)
    .set({
      balance: newBalance,
      totalRecharge: newTotalRecharge,
      totalConsume: newTotalConsume,
      version: wallet.version + 1,
    })
    .where(and(eq(memberWallets.id, wallet.id), eq(memberWallets.version, wallet.version)))
    .returning();
  if (updated.length === 0) throw new OptimisticLockError();

  await tx.insert(memberWalletTransactions).values({
    memberId: input.memberId,
    type: input.type,
    amount: input.amount,
    balanceAfter: newBalance,
    bizType: input.bizType ?? null,
    bizId: input.bizId ?? null,
    paymentIntentNo: input.paymentIntentNo ?? null,
    paymentEventId: input.paymentEventId ?? null,
    remark: input.remark ?? null,
    operatorId: input.operatorId ?? null,
  });
  return updated[0];
}

export async function changeWallet(input: ChangeWalletInput): Promise<MemberWalletRow> {
  if (input.amount === 0) throw new HTTPException(400, { message: '金额变动不能为 0' });

  return withOptimisticRetry(() => db.transaction((tx) => applyWalletChange(tx, input)));
}

/** 消费扣款（amount 取负，校验余额）*/
export function consumeWallet(memberId: number, amount: number, opts?: { bizType?: string; bizId?: string; remark?: string }) {
  return changeWallet({ memberId, type: 'consume', amount: -Math.abs(amount), ...opts });
}

/** 退款入账（amount 取正）；后台入口需保证会员存在且未删除 */
export async function refundWallet(memberId: number, amount: number, opts?: { bizType?: string; bizId?: string; remark?: string; operatorId?: number }) {
  await ensureWalletMember(memberId);
  const w = await changeWallet({ memberId, type: 'refund', amount: Math.abs(amount), ...opts });
  const { createMemberNotification } = await import('./member-notifications.service');
  await createMemberNotification({
    memberId,
    type: 'wallet_adjust',
    title: '钱包退款到账',
    content: `退款 ${(Math.abs(amount) / 100).toFixed(2)} 元已入账${opts?.remark ? `（${opts.remark}）` : ''}，当前余额 ${(w.balance / 100).toFixed(2)} 元。`,
  }).catch(() => undefined);
  return w;
}

/** 后台手动调整（delta 可正可负）；校验会员存在且未删除，并发站内通知 */
export async function adjustWallet(memberId: number, delta: number, operatorId: number, remark?: string) {
  await ensureWalletMember(memberId);
  const w = await changeWallet({ memberId, type: 'adjust', amount: delta, bizType: 'admin_adjust', remark, operatorId });
  const { createMemberNotification } = await import('./member-notifications.service');
  await createMemberNotification({
    memberId,
    type: 'wallet_adjust',
    title: '余额变动通知',
    content: `管理员${delta > 0 ? '增加' : '扣减'}了你的余额 ${(Math.abs(delta) / 100).toFixed(2)} 元${remark ? `（${remark}）` : ''}，当前余额 ${(w.balance / 100).toFixed(2)} 元。`,
  }).catch(() => undefined);
  return w;
}

// ─── 充值（接入支付中心）──────────────────────────────────────────────────────
export async function rechargeWallet(memberId: number, applicationId: number, amount: number, payMethod: PaymentCashierMethod, clientIp?: string, memberCouponId?: number) {
  if (amount <= 0) throw new HTTPException(400, { message: '充值金额必须大于 0' });
  await ensureWallet(memberId);
  const { payParams } = await createPayment({
    bizType: WALLET_RECHARGE_BIZ_TYPE,
    bizId: String(memberId),
    subject: '会员钱包充值',
    amount,
    currency: 'CNY',
    applicationId,
    userId: memberId,
    payMethod,
    tenantId: currentMemberOrNull()?.tenantId ?? null,
    expireMinutes: 30,
    clientIp,
    // 充值满减：实付=充值额-立减，到账按原充值额（平台补贴），券由支付事件核销/释放
    memberCouponId,
    couponMemberId: memberCouponId != null ? memberId : undefined,
  });
  return payParams;
}

/** 支付成功事件触发钱包入账（按支付单号幂等，防重投重复入账）。
 * 事务级咨询锁串行化同一支付单的并发重投；幂等检查与入账同一事务提交，杜绝双入账。 */
export async function creditWalletOnRecharge(event: { eventId: string; bizId: string; orderNo: string; amount: number; originalAmount?: number | null; appId?: number | null; tenantId?: number | null }): Promise<void> {
  const memberId = Number(event.bizId);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    logger.warn('[MemberWallet] 充值入账 bizId 非法', { bizId: event.bizId });
    return;
  }
  if (event.appId == null) {
    logger.warn('[MemberWallet] 充值事件缺少支付应用', { orderNo: event.orderNo });
    return;
  }
  const tenantScope = exactTenantCondition(paymentOrders.tenantId, event.tenantId ?? null);
  const [order] = await db
    .select({
      id: paymentOrders.id,
      amount: paymentOrders.amount,
      paidAmount: paymentOrders.paidAmount,
      originalAmount: paymentOrders.originalAmount,
      userId: paymentOrders.userId,
    })
    .from(paymentOrders)
    .where(and(
      eq(paymentOrders.orderNo, event.orderNo),
      eq(paymentOrders.bizType, WALLET_RECHARGE_BIZ_TYPE),
      eq(paymentOrders.bizId, event.bizId),
      eq(paymentOrders.appId, event.appId),
      eq(paymentOrders.status, 'success'),
      tenantScope,
    ))
    .limit(1);
  const expectedPaidAmount = order?.paidAmount ?? order?.amount;
  const expectedOriginalAmount = order?.originalAmount ?? order?.amount;
  const eventOriginalAmount = event.originalAmount ?? order?.amount;
  if (!order || order.userId == null || event.amount !== expectedPaidAmount || eventOriginalAmount !== expectedOriginalAmount) {
    logger.warn('[MemberWallet] 充值事件与支付订单不匹配', { orderNo: event.orderNo, bizId: event.bizId });
    return;
  }
  const memberTenantScope = exactTenantCondition(members.tenantId, event.tenantId ?? null);
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), memberTenantScope))
    .limit(1);
  if (!member || member.id !== order.userId) {
    logger.warn('[MemberWallet] 充值事件会员归属不匹配', { orderNo: event.orderNo, memberId });
    return;
  }
  await ensureWallet(memberId);
  const credited = await withOptimisticRetry(() =>
    db.transaction(async (tx) => {
      // 按支付单号获取事务级咨询锁（事务结束自动释放），并发重投在此排队
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wallet-recharge:${event.orderNo}`}))`);
      // 拿到锁后检查是否已入账（可见先前持锁事务已提交的流水）
      const [exist] = await tx
        .select({ id: memberWalletTransactions.id })
        .from(memberWalletTransactions)
        .where(and(eq(memberWalletTransactions.bizType, WALLET_RECHARGE_BIZ_TYPE), eq(memberWalletTransactions.bizId, event.orderNo)))
        .limit(1);
      if (exist) return false;

      // 充值满减用券时实付为立减后金额，到账按优惠前原充值额（平台补贴优惠差额）
      const creditAmount = event.originalAmount ?? event.amount;
      await applyWalletChange(tx, {
        memberId,
        type: 'recharge',
        amount: creditAmount,
        bizType: WALLET_RECHARGE_BIZ_TYPE,
        bizId: event.orderNo,
        paymentIntentNo: event.orderNo,
        paymentEventId: event.eventId,
        remark: event.originalAmount != null ? '钱包充值到账（含充值满减补贴）' : '钱包充值到账',
      });
      return true;
    }),
  );
  if (credited) logger.info('[MemberWallet] 充值到账', { memberId, orderNo: event.orderNo, amount: event.amount });
}

/**
 * 充值订单退款成功后的钱包冲正。
 * 退款属于支付域的终态事件，不能只退渠道资金而保留会员钱包余额；
 * 以 refundNo 作为幂等键，并允许余额暂时为负数形成可追收欠款。
 */
export async function reverseWalletRechargeOnRefund(event: {
  eventId: string;
  orderNo: string;
  refundNo?: string;
  refundAmount?: number;
  appId?: number | null;
  tenantId?: number | null;
}): Promise<void> {
  if (event.appId == null || !event.refundNo || !event.refundAmount || event.refundAmount <= 0) return;
  const tenantScope = exactTenantCondition(paymentOrders.tenantId, event.tenantId ?? null);
  const [matched] = await db
    .select({
      orderNo: paymentOrders.orderNo,
      userId: paymentOrders.userId,
      bizType: paymentOrders.bizType,
      appId: paymentOrders.appId,
      tenantId: paymentOrders.tenantId,
      refundAmount: paymentRefunds.refundAmount,
    })
    .from(paymentRefunds)
    .innerJoin(paymentOrders, eq(paymentOrders.id, paymentRefunds.orderId))
    .where(and(
      eq(paymentRefunds.refundNo, event.refundNo),
      eq(paymentRefunds.orderNo, event.orderNo),
      eq(paymentRefunds.status, 'success'),
      eq(paymentOrders.appId, event.appId),
      inArray(paymentOrders.status, ['success', 'refunding', 'refunded']),
      tenantScope,
    ))
    .limit(1);
  if (!matched || matched.bizType !== WALLET_RECHARGE_BIZ_TYPE || matched.userId == null || matched.refundAmount !== event.refundAmount) {
    logger.warn('[MemberWallet] 充值退款事件与支付退款单不匹配', { orderNo: event.orderNo, refundNo: event.refundNo });
    return;
  }
  const memberTenantScope = exactTenantCondition(members.tenantId, event.tenantId ?? null);
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, matched.userId), isNull(members.deletedAt), memberTenantScope))
    .limit(1);
  if (!member) {
    logger.warn('[MemberWallet] 充值退款会员不存在或已删除', { orderNo: event.orderNo, refundNo: event.refundNo, memberId: matched.userId });
    return;
  }
  await ensureWallet(matched.userId);
  await withOptimisticRetry(() => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wallet-refund:${event.refundNo}`}))`);
    const [existing] = await tx
      .select({ id: memberWalletTransactions.id })
      .from(memberWalletTransactions)
      .where(and(
        eq(memberWalletTransactions.bizType, 'member_recharge_refund'),
        eq(memberWalletTransactions.bizId, event.refundNo!),
      ))
      .limit(1);
    if (existing) return;
    await applyWalletChange(tx, {
      memberId: matched.userId!,
      type: 'consume',
      amount: -Math.abs(event.refundAmount!),
      bizType: 'member_recharge_refund',
      bizId: event.refundNo,
      paymentIntentNo: matched.orderNo,
      paymentEventId: event.eventId,
      remark: '会员充值退款冲正（余额不足将形成待追收欠款）',
      allowNegative: true,
    });
  }));
  logger.info('[MemberWallet] 充值退款冲正完成', { memberId: matched.userId, orderNo: event.orderNo, refundNo: event.refundNo, amount: event.refundAmount });
}

// ─── 流水查询 ─────────────────────────────────────────────────────────────────
export type ListWalletTxQuery = QueryOutputOf<typeof memberWalletContract.transactions> & { memberId?: number };

export function buildWalletTxWhere(q: { memberId?: number; memberKeyword?: string; type?: WalletTxType }): SQL | undefined {
  return buildWhere(
    memberReferenceCondition(memberWalletTransactions.memberId, q),
    q.type ? eq(memberWalletTransactions.type, q.type) : undefined,
  );
}

export async function listWalletTransactions(q: ListWalletTxQuery) {
  const scopedMemberIds = adminMemberScope()
    ? inArray(
      memberWalletTransactions.memberId,
      db.select({ id: members.id }).from(members).where(and(isNull(members.deletedAt), adminMemberScope())),
    )
    : undefined;
  const where = buildWhere(buildWalletTxWhere(q), scopedMemberIds);

  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(memberWalletTransactions, where),
    rows: () => db.query.memberWalletTransactions.findMany({
      where,
      with: { member: { columns: { nickname: true } } },
      orderBy: desc(memberWalletTransactions.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
    map: (r) => mapWalletTransaction(r, r.member?.nickname),
  });
}

export function listMyWalletTransactions(q: QueryOutputOf<typeof memberSelfContract.walletTransactions>) {
  return listWalletTransactions({ ...q, memberId: currentMemberId() });
}
