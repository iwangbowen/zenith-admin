/**
 * 支付结算批次 Service。
 * 按渠道 + 账期聚合成功订单生成结算批次（净额 = 收款 - 手续费 - 退款），
 * 状态机：生成(pending) → 结算中(settling) → 已结算(settled)/失败(failed)，结算时记资金台账。
 */
import { and, between, desc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../db';
import { paymentOrders, paymentRefunds, paymentSettlementBatches, type PaymentSettlementBatchRow } from '../db/schema';
import { currentUser } from '../lib/context';
import { getCreateTenantId, tenantCondition } from '../lib/tenant';
import { mergeWhere, withPagination } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateRangeStart, parseDateRangeEnd } from '../lib/datetime';
import { recordLedgerEntry } from './payment-ledger.service';
import type { PaymentChannel, PaymentSettlementBatch, PaymentSettlementStatus } from '@zenith/shared';

function genNo(): string {
  return `SETTLE${Date.now()}${randomInt(1000, 9999)}`;
}

export function mapSettlementBatch(row: PaymentSettlementBatchRow): PaymentSettlementBatch {
  return {
    id: row.id,
    batchNo: row.batchNo,
    channel: row.channel,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    orderCount: row.orderCount,
    grossAmount: row.grossAmount,
    feeAmount: row.feeAmount,
    refundAmount: row.refundAmount,
    netAmount: row.netAmount,
    settledAt: formatNullableDateTime(row.settledAt),
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListSettlementsQuery {
  page?: number;
  pageSize?: number;
  channel?: PaymentChannel;
  status?: PaymentSettlementStatus;
}

export async function listSettlements(q: ListSettlementsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.channel) conds.push(eq(paymentSettlementBatches.channel, q.channel));
  if (q.status) conds.push(eq(paymentSettlementBatches.status, q.status));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentSettlementBatches, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentSettlementBatches, where),
    withPagination(db.select().from(paymentSettlementBatches).where(where).orderBy(desc(paymentSettlementBatches.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapSettlementBatch), total, page, pageSize };
}

async function ensureBatch(id: number): Promise<PaymentSettlementBatchRow> {
  const tc = tenantCondition(paymentSettlementBatches, currentUser());
  const [row] = await db.select().from(paymentSettlementBatches).where(and(eq(paymentSettlementBatches.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '结算批次不存在' });
  return row;
}

export async function getSettlement(id: number): Promise<PaymentSettlementBatch> {
  return mapSettlementBatch(await ensureBatch(id));
}

export interface GenerateSettlementInput {
  channel: PaymentChannel;
  periodStart: string;
  periodEnd: string;
  remark?: string;
}

/** 生成结算批次：聚合账期内成功订单（gross/fee）与成功退款（refund），net = gross - fee - refund。 */
export async function generateSettlement(input: GenerateSettlementInput): Promise<PaymentSettlementBatch> {
  const start = parseDateRangeStart(input.periodStart);
  const end = parseDateRangeEnd(input.periodEnd);
  if (!start || !end) throw new HTTPException(400, { message: '账期格式不正确（YYYY-MM-DD）' });
  if (start > end) throw new HTTPException(400, { message: '账期开始不能晚于结束' });
  const user = currentUser();
  const tenantId = getCreateTenantId(user);
  const tc = tenantCondition(paymentOrders, user);

  const [orderAgg] = await db
    .select({
      orderCount: sql<number>`count(*)`,
      gross: sql<number>`coalesce(sum(coalesce(${paymentOrders.paidAmount}, ${paymentOrders.amount})),0)`,
      fee: sql<number>`coalesce(sum(coalesce(${paymentOrders.feeAmount},0)),0)`,
    })
    .from(paymentOrders)
    .where(
      mergeWhere(
        and(
          eq(paymentOrders.channel, input.channel),
          inArray(paymentOrders.status, ['success', 'refunding', 'refunded']),
          between(paymentOrders.paidAt, start, end),
        ),
        tc,
      ),
    );

  const refundTc = tenantCondition(paymentRefunds, user);
  const [refundAgg] = await db
    .select({ refund: sql<number>`coalesce(sum(${paymentRefunds.refundAmount}),0)` })
    .from(paymentRefunds)
    .where(
      mergeWhere(
        and(eq(paymentRefunds.channel, input.channel), eq(paymentRefunds.status, 'success'), between(paymentRefunds.refundedAt, start, end)),
        refundTc,
      ),
    );

  const grossAmount = Number(orderAgg?.gross ?? 0);
  const feeAmount = Number(orderAgg?.fee ?? 0);
  const refundAmount = Number(refundAgg?.refund ?? 0);
  const rawNetAmount = grossAmount - feeAmount - refundAmount;
  const netAmount = Math.max(0, rawNetAmount);
  const remark = [input.remark, rawNetAmount < 0 ? `账期净额为负（${rawNetAmount} 分），本批次按 0 分结算` : undefined].filter(Boolean).join('；') || null;

  const [row] = await db
    .insert(paymentSettlementBatches)
    .values({
      batchNo: genNo(),
      channel: input.channel,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'pending',
      orderCount: Number(orderAgg?.orderCount ?? 0),
      grossAmount,
      feeAmount,
      refundAmount,
      netAmount,
      remark,
      tenantId,
    })
    .returning();
  return mapSettlementBatch(row);
}

const ALLOWED_TRANSITIONS: Record<PaymentSettlementStatus, PaymentSettlementStatus[]> = {
  pending: ['settling', 'failed'],
  settling: ['settled', 'failed'],
  settled: [],
  failed: [],
};

/** 状态机流转。结算完成（settled）时记一条资金台账（type=settlement, direction=out）。 */
export async function transitionSettlement(id: number, target: PaymentSettlementStatus): Promise<PaymentSettlementBatch> {
  const batch = await ensureBatch(id);
  if (!ALLOWED_TRANSITIONS[batch.status].includes(target)) {
    throw new HTTPException(400, { message: `不允许从「${batch.status}」流转到「${target}」` });
  }
  const settledAt = target === 'settled' ? new Date() : batch.settledAt;
  const [row] = await db
    .update(paymentSettlementBatches)
    .set({ status: target, settledAt })
    .where(eq(paymentSettlementBatches.id, id))
    .returning();
  if (target === 'settled' && row.netAmount > 0) {
    await recordLedgerEntry({
      direction: 'out',
      type: 'settlement',
      amount: row.netAmount,
      channel: row.channel,
      tenantId: row.tenantId,
      remark: `结算批次 ${row.batchNo} 到账`,
    });
  }
  return mapSettlementBatch(row);
}

export async function deleteSettlement(id: number): Promise<void> {
  const batch = await ensureBatch(id);
  if (batch.status === 'settling') throw new HTTPException(400, { message: '结算中批次不可删除' });
  await db.delete(paymentSettlementBatches).where(eq(paymentSettlementBatches.id, id));
}
