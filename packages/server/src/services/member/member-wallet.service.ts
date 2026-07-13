/**
 * 会员钱包服务。
 *
 * - changeWallet() 统一记账（事务 + 乐观锁 + 流水），余额单位为分
 * - rechargeWallet() 发起充值：调用支付中心 createPayment（bizType='member_recharge'）
 * - creditWalletOnRecharge() 由支付成功事件触发入账，按支付单号幂等
 */
import { and, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { members, memberWallets, memberWalletTransactions, paymentOrders } from '../../db/schema';
import type { MemberWalletRow, MemberWalletTransactionRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { currentMemberId } from '../../lib/member-context';
import { withOptimisticRetry, OptimisticLockError } from '../../lib/optimistic';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import logger from '../../lib/logger';
import { createPayment } from '../payment/payment.service';
import { ensureMemberExists } from './member-auth.service';
import type { WalletTxType, PaymentCashierMethod } from '@zenith/shared';

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
  // 兜底按需创建；并发首建时 onConflictDoNothing 容忍撞唯一索引，回读胜者行
  const [created] = await db.insert(memberWallets).values({ memberId }).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await db.select().from(memberWallets).where(eq(memberWallets.memberId, memberId)).limit(1);
  return existing;
}

export async function getWallet(memberId: number) {
  return mapWallet(await ensureWallet(memberId));
}

export async function getWalletBeforeAudit(memberId: number) {
  const [wallet] = await db.select().from(memberWallets).where(eq(memberWallets.memberId, memberId)).limit(1);
  if (!wallet) throw new HTTPException(404, { message: '钱包不存在' });
  return mapWallet(wallet);
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

/** 事务内应用一次钱包变动（乐观锁 CAS + 原子写流水）。版本冲突抛 OptimisticLockError，由调用方重试整个事务。 */
async function applyWalletChange(tx: DbTransaction, input: ChangeWalletInput): Promise<MemberWalletRow> {
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
  await ensureMemberExists(memberId);
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
  await ensureMemberExists(memberId);
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
export async function rechargeWallet(memberId: number, amount: number, payMethod: PaymentCashierMethod, clientIp?: string) {
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

/** 支付成功事件触发钱包入账（按支付单号幂等，防重投重复入账）。
 * 事务级咨询锁串行化同一支付单的并发重投；幂等检查与入账同一事务提交，杜绝双入账。 */
export async function creditWalletOnRecharge(event: { bizId: string; orderNo: string; amount: number }): Promise<void> {
  const memberId = Number(event.bizId);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    logger.warn('[MemberWallet] 充值入账 bizId 非法', { bizId: event.bizId });
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

      const [order] = await tx.select({ id: paymentOrders.id }).from(paymentOrders).where(eq(paymentOrders.orderNo, event.orderNo)).limit(1);
      await applyWalletChange(tx, {
        memberId,
        type: 'recharge',
        amount: event.amount,
        bizType: WALLET_RECHARGE_BIZ_TYPE,
        bizId: event.orderNo,
        paymentOrderId: order?.id,
        remark: '钱包充值到账',
      });
      return true;
    }),
  );
  if (credited) logger.info('[MemberWallet] 充值到账', { memberId, orderNo: event.orderNo, amount: event.amount });
}

// ─── 流水查询 ─────────────────────────────────────────────────────────────────
export interface ListWalletTxQuery {
  memberId?: number;
  memberKeyword?: string;
  type?: WalletTxType;
  page: number;
  pageSize: number;
}

export function buildWalletTxWhere(q: { memberId?: number; memberKeyword?: string; type?: WalletTxType }): SQL | undefined {
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
  return conds.length ? and(...conds) : undefined;
}

export async function listWalletTransactions(q: ListWalletTxQuery) {
  const where = buildWalletTxWhere(q);

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
