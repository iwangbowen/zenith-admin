/**
 * 资金流水台账 Service。
 * 监听支付/退款成功事件自动记账（收款 in / 退款 out / 手续费 fee），
 * 提供资金维度的统一流水列表与汇总（区别于订单维度）。
 */
import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { db } from '../db';
import { paymentLedgerEntries, type PaymentLedgerEntryRow } from '../db/schema';
import { currentUser } from '../lib/context';
import { tenantCondition } from '../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';
import { paymentEventBus } from '../lib/payment-event-bus';
import logger from '../lib/logger';
import type { PaymentChannel, PaymentLedgerDirection, PaymentLedgerEntry, PaymentLedgerType } from '@zenith/shared';

function genNo(): string {
  return `LED${Date.now()}${randomInt(1000, 9999)}`;
}

export function mapLedgerEntry(row: PaymentLedgerEntryRow): PaymentLedgerEntry {
  return {
    id: row.id,
    entryNo: row.entryNo,
    direction: row.direction,
    type: row.type,
    amount: row.amount,
    orderNo: row.orderNo ?? null,
    refundNo: row.refundNo ?? null,
    channel: row.channel ?? null,
    bizType: row.bizType ?? null,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface RecordLedgerInput {
  direction: PaymentLedgerDirection;
  type: PaymentLedgerType;
  amount: number;
  orderNo?: string | null;
  refundNo?: string | null;
  channel?: PaymentChannel | null;
  bizType?: string | null;
  remark?: string | null;
  tenantId?: number | null;
}

/** 记一条资金流水（幂等：退款按 refundNo+type 去重，其余按 orderNo+type 去重）。 */
export async function recordLedgerEntry(input: RecordLedgerInput): Promise<void> {
  if (input.amount <= 0) return;
  if (input.type === 'refund' && input.refundNo) {
    const exists = await db.$count(paymentLedgerEntries, and(eq(paymentLedgerEntries.refundNo, input.refundNo), eq(paymentLedgerEntries.type, 'refund')));
    if (exists > 0) return;
  } else if (input.orderNo) {
    const exists = await db.$count(paymentLedgerEntries, and(eq(paymentLedgerEntries.orderNo, input.orderNo), eq(paymentLedgerEntries.type, input.type)));
    if (exists > 0) return;
  }
  await db.insert(paymentLedgerEntries).values({
    entryNo: genNo(),
    direction: input.direction,
    type: input.type,
    amount: input.amount,
    orderNo: input.orderNo ?? null,
    refundNo: input.refundNo ?? null,
    channel: input.channel ?? null,
    bizType: input.bizType ?? null,
    remark: input.remark ?? null,
    tenantId: input.tenantId ?? null,
  });
}

export interface ListLedgerQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  direction?: PaymentLedgerDirection;
  type?: PaymentLedgerType;
  channel?: PaymentChannel;
  startTime?: string;
  endTime?: string;
}

function buildLedgerWhere(q: ListLedgerQuery) {
  const conds = [];
  if (q.keyword) conds.push(like(paymentLedgerEntries.orderNo, `%${escapeLike(q.keyword)}%`));
  if (q.direction) conds.push(eq(paymentLedgerEntries.direction, q.direction));
  if (q.type) conds.push(eq(paymentLedgerEntries.type, q.type));
  if (q.channel) conds.push(eq(paymentLedgerEntries.channel, q.channel));
  const start = parseDateTimeInput(q.startTime);
  const end = parseDateTimeInput(q.endTime);
  if (start) conds.push(gte(paymentLedgerEntries.createdAt, start));
  if (end) conds.push(lte(paymentLedgerEntries.createdAt, end));
  return mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentLedgerEntries, currentUser()));
}

export async function listLedgerEntries(q: ListLedgerQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const where = buildLedgerWhere(q);
  const [total, list] = await Promise.all([
    db.$count(paymentLedgerEntries, where),
    withPagination(db.select().from(paymentLedgerEntries).where(where).orderBy(desc(paymentLedgerEntries.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapLedgerEntry), total, page, pageSize };
}

export interface LedgerSummary {
  inAmount: number;
  outAmount: number;
  netAmount: number;
  count: number;
}

export async function getLedgerSummary(q: ListLedgerQuery): Promise<LedgerSummary> {
  const where = buildLedgerWhere(q);
  const [row] = await db
    .select({
      inAmount: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.direction} = 'in' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      outAmount: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.direction} = 'out' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      count: sql<number>`count(*)`,
    })
    .from(paymentLedgerEntries)
    .where(where);
  const inAmount = Number(row?.inAmount ?? 0);
  const outAmount = Number(row?.outAmount ?? 0);
  return { inAmount, outAmount, netAmount: inAmount - outAmount, count: Number(row?.count ?? 0) };
}

let registered = false;
/** 注册台账记账订阅者（支付成功记收款、退款成功记退款）。 */
export function registerLedgerSubscribers(): void {
  if (registered) return;
  registered = true;
  paymentEventBus.on('payment.succeeded', (e) => {
    void recordLedgerEntry({ direction: 'in', type: 'payment', amount: e.amount, orderNo: e.orderNo, channel: e.channel, bizType: e.bizType, tenantId: e.tenantId, remark: '支付收款' }).catch((err) =>
      logger.error('[payment-ledger] record payment failed', { orderNo: e.orderNo, err }),
    );
  });
  paymentEventBus.on('refund.succeeded', (e) => {
    void recordLedgerEntry({ direction: 'out', type: 'refund', amount: e.refundAmount ?? 0, orderNo: e.orderNo, refundNo: e.refundNo, channel: e.channel, bizType: e.bizType, tenantId: e.tenantId, remark: '退款支出' }).catch((err) =>
      logger.error('[payment-ledger] record refund failed', { orderNo: e.orderNo, err }),
    );
  });
  logger.info('Payment ledger subscribers registered');
}
