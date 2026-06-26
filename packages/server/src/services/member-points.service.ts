/**
 * 会员积分服务。
 *
 * 核心：changePoints() 为统一记账入口（事务 + 乐观锁 version + 原子写流水），
 * 预留给未来订单系统调用。earn/redeem/adjust/refund 均封装自它。
 */
import { and, desc, eq, ilike, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { members, memberPointAccounts, memberPointTransactions } from '../db/schema';
import type { MemberPointAccountRow, MemberPointTransactionRow } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { currentMemberId } from '../lib/member-context';
import { withOptimisticRetry, OptimisticLockError } from '../lib/optimistic';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import type { PointTxType } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapPointAccount(row: MemberPointAccountRow) {
  return {
    memberId: row.memberId,
    balance: row.balance,
    frozen: row.frozen,
    totalEarned: row.totalEarned,
    totalSpent: row.totalSpent,
  };
}

export function mapPointTransaction(row: MemberPointTransactionRow, memberName?: string | null) {
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

// ─── 账户查询 / 确保存在 ───────────────────────────────────────────────────────
export async function ensurePointAccount(memberId: number): Promise<MemberPointAccountRow> {
  const [acc] = await db.select().from(memberPointAccounts).where(eq(memberPointAccounts.memberId, memberId)).limit(1);
  if (acc) return acc;
  // 兜底：账户缺失时按需创建（正常注册时已创建）
  const [created] = await db.insert(memberPointAccounts).values({ memberId }).returning();
  return created;
}

export async function getPointAccount(memberId: number) {
  return mapPointAccount(await ensurePointAccount(memberId));
}

export async function getPointAccountBeforeAudit(memberId: number) {
  const [acc] = await db.select().from(memberPointAccounts).where(eq(memberPointAccounts.memberId, memberId)).limit(1);
  if (!acc) throw new HTTPException(404, { message: '积分账户不存在' });
  return mapPointAccount(acc);
}

export async function getMyPointAccount() {
  return getPointAccount(currentMemberId());
}

// ─── 统一记账入口 ─────────────────────────────────────────────────────────────
export interface ChangePointsInput {
  memberId: number;
  type: PointTxType;
  /** 带符号变动量：earn/refund 为正，redeem/expire 为负，adjust 可正可负 */
  amount: number;
  bizType?: string;
  bizId?: string;
  remark?: string;
  /** 后台操作人（管理员手动调整时记录）*/
  operatorId?: number;
}

export interface PointChangeResult {
  newBalance: number;
  newTotalEarned: number;
  newTotalSpent: number;
}

/**
 * 计算积分账户变动后的新值（纯函数，无 DB 依赖，便于单测）。
 * - earn/refund(正)累加 totalEarned；redeem/expire(负)累加 totalSpent
 * - 余额不足（变动后 < 0）抛 400
 */
export function computePointChange(
  acc: { balance: number; totalEarned: number; totalSpent: number },
  amount: number,
): PointChangeResult {
  const newBalance = acc.balance + amount;
  if (newBalance < 0) throw new HTTPException(400, { message: '积分余额不足' });
  return {
    newBalance,
    newTotalEarned: amount > 0 ? acc.totalEarned + amount : acc.totalEarned,
    newTotalSpent: amount < 0 ? acc.totalSpent + Math.abs(amount) : acc.totalSpent,
  };
}

export async function changePoints(input: ChangePointsInput): Promise<MemberPointAccountRow> {
  if (input.amount === 0) throw new HTTPException(400, { message: '积分变动量不能为 0' });

  return withOptimisticRetry(() =>
    db.transaction(async (tx) => {
      const [acc] = await tx
        .select()
        .from(memberPointAccounts)
        .where(eq(memberPointAccounts.memberId, input.memberId))
        .limit(1);
      if (!acc) throw new HTTPException(404, { message: '积分账户不存在' });

      const { newBalance, newTotalEarned, newTotalSpent } = computePointChange(acc, input.amount);

      const updated = await tx
        .update(memberPointAccounts)
        .set({
          balance: newBalance,
          totalEarned: newTotalEarned,
          totalSpent: newTotalSpent,
          version: acc.version + 1,
        })
        .where(and(eq(memberPointAccounts.id, acc.id), eq(memberPointAccounts.version, acc.version)))
        .returning();
      if (updated.length === 0) throw new OptimisticLockError();

      await tx.insert(memberPointTransactions).values({
        memberId: input.memberId,
        type: input.type,
        amount: input.amount,
        balanceAfter: newBalance,
        bizType: input.bizType ?? null,
        bizId: input.bizId ?? null,
        remark: input.remark ?? null,
        operatorId: input.operatorId ?? null,
      });
      return updated[0];
    }),
  );
}

/** 增加积分（amount 取绝对值，正向）*/
export function earnPoints(memberId: number, amount: number, opts?: { bizType?: string; bizId?: string; remark?: string }) {
  return changePoints({ memberId, type: 'earn', amount: Math.abs(amount), ...opts });
}

/** 扣减积分（amount 取负，校验余额）*/
export function redeemPoints(memberId: number, amount: number, opts?: { bizType?: string; bizId?: string; remark?: string }) {
  return changePoints({ memberId, type: 'redeem', amount: -Math.abs(amount), ...opts });
}

/** 后台手动调整（delta 可正可负）*/
export function adjustPoints(memberId: number, delta: number, operatorId: number, remark?: string) {
  return changePoints({ memberId, type: 'adjust', amount: delta, bizType: 'admin_adjust', remark, operatorId });
}

// ─── 流水查询 ─────────────────────────────────────────────────────────────────
export interface ListPointTxQuery {
  memberId?: number;
  memberKeyword?: string;
  type?: PointTxType;
  page: number;
  pageSize: number;
}

export async function listPointTransactions(q: ListPointTxQuery) {
  const conds: SQL[] = [];
  if (q.memberId) {
    conds.push(eq(memberPointTransactions.memberId, q.memberId));
  } else if (q.memberKeyword) {
    const numId = /^\d+$/.test(q.memberKeyword) ? parseInt(q.memberKeyword, 10) : null;
    if (numId) {
      conds.push(eq(memberPointTransactions.memberId, numId));
    } else {
      conds.push(inArray(
        memberPointTransactions.memberId,
        db.select({ id: members.id }).from(members).where(ilike(members.nickname, `%${escapeLike(q.memberKeyword)}%`)),
      ));
    }
  }
  if (q.type) conds.push(eq(memberPointTransactions.type, q.type));
  const where = conds.length ? and(...conds) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(memberPointTransactions, where),
    db.query.memberPointTransactions.findMany({
      where,
      with: { member: { columns: { nickname: true } } },
      orderBy: desc(memberPointTransactions.id),
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
  ]);
  return {
    list: rows.map((r) => mapPointTransaction(r, r.member?.nickname)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export function listMyPointTransactions(q: { type?: PointTxType; page: number; pageSize: number }) {
  return listPointTransactions({ ...q, memberId: currentMemberId() });
}
