/**
 * 支付运营排障 Service。
 * Outbox 事件查看与手动重投、模拟支付成功回调（演示/联调用），
 * 帮助运营快速排障与复现支付履约链路。
 */
import { and, desc, eq, like } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { paymentEvents, paymentOrders, type PaymentEventRow } from '../db/schema';
import { currentUser } from '../lib/context';
import { tenantCondition } from '../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { processEvent } from './payment-outbox.service';
import { markOrderPaid, mapOrder, loadOrderConfig } from './payment.service';
import type { PaymentOrder, PaymentOutboxEvent } from '@zenith/shared';

export function mapOutboxEvent(row: PaymentEventRow): PaymentOutboxEvent {
  return {
    id: row.id,
    type: row.type,
    orderNo: row.orderNo,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    createdAt: formatDateTime(row.createdAt),
    processedAt: formatNullableDateTime(row.processedAt),
  };
}

export interface ListEventsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'pending' | 'done' | 'failed';
  type?: string;
}

export async function listPaymentEvents(q: ListEventsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.keyword) conds.push(like(paymentEvents.orderNo, `%${escapeLike(q.keyword)}%`));
  if (q.status) conds.push(eq(paymentEvents.status, q.status));
  if (q.type) conds.push(eq(paymentEvents.type, q.type));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentEvents, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentEvents, where),
    withPagination(db.select().from(paymentEvents).where(where).orderBy(desc(paymentEvents.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapOutboxEvent), total, page, pageSize };
}

/** 手动重投 Outbox 事件：重置为 pending 并立即投递。 */
export async function redispatchEvent(id: number): Promise<PaymentOutboxEvent> {
  const tc = tenantCondition(paymentEvents, currentUser());
  const [row] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '事件不存在' });
  await db.update(paymentEvents).set({ status: 'pending', attempts: 0, lastError: null }).where(eq(paymentEvents.id, id));
  await processEvent(id);
  const [latest] = await db.select().from(paymentEvents).where(eq(paymentEvents.id, id)).limit(1);
  return mapOutboxEvent(latest ?? row);
}

/**
 * 模拟支付成功（演示/联调）：将待支付订单标记为已支付，触发完整履约链路。
 * 安全限制：仅允许沙箱渠道订单，或非生产环境，避免误操作真实资金。
 */
export async function simulateOrderPaid(id: number): Promise<PaymentOrder> {
  const tc = tenantCondition(paymentOrders, currentUser());
  const [order] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.id, id), tc)).limit(1);
  if (!order) throw new HTTPException(404, { message: '支付订单不存在' });
  if (order.status !== 'pending' && order.status !== 'paying') {
    throw new HTTPException(400, { message: '仅待支付/支付中订单可模拟支付' });
  }
  const config = await loadOrderConfig(order);
  const isSandbox = config?.sandbox ?? false;
  if (!isSandbox && process.env.NODE_ENV === 'production') {
    throw new HTTPException(403, { message: '生产环境仅允许对沙箱渠道订单模拟支付' });
  }
  await markOrderPaid(order, {
    channelTradeNo: `SIM${Date.now()}`,
    paidAmount: order.amount,
    paidAt: new Date(),
    notifyData: JSON.stringify({ simulated: true, operator: currentUser().userId }),
  });
  const [latest] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, id)).limit(1);
  return mapOrder(latest ?? order);
}
