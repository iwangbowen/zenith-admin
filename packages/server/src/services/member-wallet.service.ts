/**
 * 会员钱包服务。
 *
 * - changeWallet() 统一记账（事务 + 乐观锁 + 流水），余额单位为分
 * - rechargeWallet() 发起充值：调用支付中心 createPayment（bizType='member_recharge'）
 * - creditWalletOnRecharge() 由支付成功事件触发入账，按支付单号幂等
 */
import { and, desc, eq, ilike, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { members, memberWallets, memberWalletTransactions, paymentOrders } from '../db/schema';
import type { MemberWalletRow, MemberWalletTransactionRow } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { currentMemberId } from '../lib/member-context';
import { withOptimisticRetry, OptimisticLockError } from '../lib/optimistic';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import logger from '../lib/logger';
import { createPayment } from './payment.service';
import type { WalletTxType, PaymentMethod } from '@zenith/shared';

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

export function mapWalletTransaction(row: MemberWalletTransactionRow, memberName?: string | null) {
  return {
    id: row.id,
    memberId: row.memberId,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    bizType: row.bizType ?? null,
    bizId: row.bizId ?? null,
    remark: row.remark ?? null,
    memberName: memberName ?? undefined,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 账户 ─────────────────────────────────────────────────────────────────────
export async function ensureWallet(memberId: number): Promise<MemberWalletRow> {
  const [w] = await db.select().from(memberWallets).where(eq(memberWallets.memberId, memberId)).limit(1);
  if (w) return w;
  const [created] = await db.insert(memberWallets).values({ memberId }).returning();
  return created;
}

export async function getWallet(memberId: number) {
  return mapWallet(await ensureWallet(memberId));
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
  paymentOrderId?: number;
  remark?: string;
  operatorId?: number;
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
): WalletChangeResult {
  const newBalance = w.balance + amount;
  if (newBalance < 0) throw new HTTPException(400, { message: '余额不足' });
  return {
    newBalance,
    newTotalRecharge: type === 'recharge' && amount > 0 ? w.totalRecharge + amount : w.totalRecharge,
    newTotalConsume: type === 'consume' && amount < 0 ? w.totalConsume + Math.abs(amount) : w.totalConsume,
  };
}

export async function changeWallet(input: ChangeWalletInput): Promise<MemberWalletRow> {
  if (input.amount === 0) throw new HTTPException(400, { message: '金额变动不能为 0' });

  return withOptimisticRetry(() =>
    db.transaction(async (tx) => {
      const [w] = await tx.select().from(memberWallets).where(eq(memberWallets.memberId, input.memberId)).limit(1);
      if (!w) throw new HTTPException(404, { message: '钱包不存在' });

      const { newBalance, newTotalRecharge, newTotalConsume } = computeWalletChange(w, input.type, input.amount);

      const updated = await tx
        .update(memberWallets)
        .set({
          balance: newBalance,
          totalRecharge: newTotalRecharge,
          totalConsume: newTotalConsume,
          version: w.version + 1,
        })
        .where(and(eq(memberWallets.id, w.id), eq(memberWallets.version, w.version)))
        .returning();
      if (updated.length === 0) throw new OptimisticLockError();

      await tx.insert(memberWalletTransactions).values({
        memberId: input.memberId,
        type: input.type,
        amount: input.amount,
        balanceAfter: newBalance,
        bizType: input.bizType ?? null,
        bizId: input.bizId ?? null,
        paymentOrderId: input.paymentOrderId ?? null,
        remark: input.remark ?? null,
        operatorId: input.operatorId ?? null,
      });
      return updated[0];
    }),
  );
}

/** 消费扣款（amount 取负，校验余额）*/
export function consumeWallet(memberId: number, amount: number, opts?: { bizType?: string; bizId?: string; remark?: string }) {
  return changeWallet({ memberId, type: 'consume', amount: -Math.abs(amount), ...opts });
}

/** 退款入账（amount 取正）*/
export function refundWallet(memberId: number, amount: number, opts?: { bizType?: string; bizId?: string; remark?: string; operatorId?: number }) {
  return changeWallet({ memberId, type: 'refund', amount: Math.abs(amount), ...opts });
}

/** 后台手动调整（delta 可正可负）*/
export function adjustWallet(memberId: number, delta: number, operatorId: number, remark?: string) {
  return changeWallet({ memberId, type: 'adjust', amount: delta, bizType: 'admin_adjust', remark, operatorId });
}

// ─── 充值（接入支付中心）──────────────────────────────────────────────────────
export async function rechargeWallet(memberId: number, amount: number, payMethod: PaymentMethod, clientIp?: string) {
  if (amount <= 0) throw new HTTPException(400, { message: '充值金额必须大于 0' });
  await ensureWallet(memberId);
  const { payParams } = await createPayment({
    bizType: WALLET_RECHARGE_BIZ_TYPE,
    bizId: String(memberId),
    subject: '会员钱包充值',
    amount,
    payMethod,
    expireMinutes: 30,
    clientIp,
  });
  return payParams;
}

/** 支付成功事件触发钱包入账（按支付单号幂等，防重投重复入账）*/
export async function creditWalletOnRecharge(event: { bizId: string; orderNo: string; amount: number }): Promise<void> {
  const memberId = Number(event.bizId);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    logger.warn('[MemberWallet] 充值入账 bizId 非法', { bizId: event.bizId });
    return;
  }
  // 幂等：该支付单是否已入账
  const [exist] = await db
    .select({ id: memberWalletTransactions.id })
    .from(memberWalletTransactions)
    .where(and(eq(memberWalletTransactions.bizType, WALLET_RECHARGE_BIZ_TYPE), eq(memberWalletTransactions.bizId, event.orderNo)))
    .limit(1);
  if (exist) return;

  const [order] = await db.select({ id: paymentOrders.id }).from(paymentOrders).where(eq(paymentOrders.orderNo, event.orderNo)).limit(1);
  await ensureWallet(memberId);
  await changeWallet({
    memberId,
    type: 'recharge',
    amount: event.amount,
    bizType: WALLET_RECHARGE_BIZ_TYPE,
    bizId: event.orderNo,
    paymentOrderId: order?.id,
    remark: '钱包充值到账',
  });
  logger.info('[MemberWallet] 充值到账', { memberId, orderNo: event.orderNo, amount: event.amount });
}

// ─── 流水查询 ─────────────────────────────────────────────────────────────────
export interface ListWalletTxQuery {
  memberId?: number;
  memberKeyword?: string;
  type?: WalletTxType;
  page: number;
  pageSize: number;
}

export async function listWalletTransactions(q: ListWalletTxQuery) {
  const conds: SQL[] = [];
  if (q.memberId) {
    conds.push(eq(memberWalletTransactions.memberId, q.memberId));
  } else if (q.memberKeyword) {
    const numId = /^\d+$/.test(q.memberKeyword) ? parseInt(q.memberKeyword, 10) : null;
    if (numId) {
      conds.push(eq(memberWalletTransactions.memberId, numId));
    } else {
      conds.push(inArray(
        memberWalletTransactions.memberId,
        db.select({ id: members.id }).from(members).where(ilike(members.nickname, `%${escapeLike(q.memberKeyword)}%`)),
      ));
    }
  }
  if (q.type) conds.push(eq(memberWalletTransactions.type, q.type));
  const where = conds.length ? and(...conds) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(memberWalletTransactions, where),
    db.query.memberWalletTransactions.findMany({
      where,
      with: { member: { columns: { nickname: true } } },
      orderBy: desc(memberWalletTransactions.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
  ]);
  return {
    list: rows.map((r) => mapWalletTransaction(r, r.member?.nickname)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export function listMyWalletTransactions(q: { type?: WalletTxType; page: number; pageSize: number }) {
  return listWalletTransactions({ ...q, memberId: currentMemberId() });
}
