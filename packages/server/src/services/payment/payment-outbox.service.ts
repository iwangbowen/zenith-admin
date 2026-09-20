/**
 * 支付事件 Outbox 服务。
 *
 * 解决「进程内事件总线在崩溃时丢失履约事件」的可靠性问题：
 * 支付/退款成功时，在更新订单/退款状态的**同一事务**内写入 outbox 事件（原子持久化），
 * 提交后立即 setImmediate 异步投递（低延迟）；若进程崩溃，cron `dispatchPaymentEvents`
 * 兜底补投 pending 事件。业务订阅者须自身幂等（可能被 outbox 与实时路径各投一次）。
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '../../db';
import { paymentEvents, type PaymentEventRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { paymentEventBus, type PaymentEvent, type PaymentEventType } from '../../lib/payment-event-bus';
import logger from '../../lib/logger';
import { formatDateTime } from '../../lib/datetime';
import { currentTraceId, currentParentRef } from '../../lib/context';
import { recordDomainEvent } from '../platform/relations/events.service';

const MAX_ATTEMPTS = 5;
const CLAIM_TIMEOUT_MS = 5 * 60_000;

export interface OutboxEventInput {
  type: PaymentEventType;
  orderNo: string;
  payload: Omit<PaymentEvent, 'eventId' | 'occurredAt'>;
  tenantId: number | null;
}

/** 在事务内插入 outbox 事件（与订单/退款状态更新同事务，保证原子持久化）。返回事件 id。 */
export async function recordEvent(tx: DbTransaction, input: OutboxEventInput): Promise<number> {
  if (!input.payload.subjectRefs?.length) throw new Error('Payment event requires explicit business subjects');
  if (input.tenantId === undefined || input.payload.tenantId !== input.tenantId) throw new Error('Payment event tenant must match its order');
  const [row] = await tx
    .insert(paymentEvents)
    .values({
      type: input.type,
      orderNo: input.orderNo,
      payload: JSON.stringify(input.payload),
      status: 'pending',
      tenantId: input.tenantId ?? null,
    })
    .returning({ id: paymentEvents.id });
  await recordDomainEvent(tx, {
    eventType: input.type,
    payload: input.payload,
    subjects: input.payload.subjectRefs,
    tenantId: input.tenantId,
    source: input.payload.subjectRefs.find((subject) => subject.role === 'primary') ?? input.payload.subjectRefs[0],
    traceId: currentTraceId(),
    parentRef: currentParentRef(),
    dedupeKey: `payment-outbox:${row.id}`,
  });
  return row.id;
}

async function dispatchRow(row: PaymentEventRow): Promise<void> {
  const payload = JSON.parse(row.payload) as Omit<PaymentEvent, 'eventId' | 'occurredAt'>;
  await paymentEventBus.dispatch({ ...payload, eventId: `payment-outbox-${row.id}`, occurredAt: formatDateTime(row.createdAt) });
}

/** 处理单个 outbox 事件：成功标记 done；失败累加 attempts 并记录错误（达上限置 failed）。 */
export async function processEvent(id: number): Promise<void> {
  const claimBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const [row] = await db
    .update(paymentEvents)
    .set({ processedAt: new Date() })
    .where(
      and(
        eq(paymentEvents.id, id),
        eq(paymentEvents.status, 'pending'),
        lt(paymentEvents.attempts, MAX_ATTEMPTS),
        or(isNull(paymentEvents.processedAt), lt(paymentEvents.processedAt, claimBefore)),
      ),
    )
    .returning();
  if (!row) return;
  try {
    await dispatchRow(row);
    await db.update(paymentEvents).set({ status: 'done', processedAt: new Date() }).where(eq(paymentEvents.id, id));
  } catch (err) {
    const attempts = row.attempts + 1;
    const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    const lastError = (err instanceof Error ? err.message : 'unknown').slice(0, 500);
    await db.update(paymentEvents).set({ attempts, status, lastError, processedAt: status === 'pending' ? null : new Date() }).where(eq(paymentEvents.id, id));
    logger.warn('[payment-outbox] dispatch failed', { id, attempts, err: lastError });
  }
}

/** Cron 兜底：补投所有 pending 且未超重试上限的事件（含进程崩溃遗留）。返回扫描条数。 */
export async function dispatchPendingPaymentEvents(): Promise<number> {
  const claimBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const rows = await db
    .select({ id: paymentEvents.id })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.status, 'pending'), lt(paymentEvents.attempts, MAX_ATTEMPTS), or(isNull(paymentEvents.processedAt), lt(paymentEvents.processedAt, claimBefore))))
    .limit(200);
  for (const row of rows) {
    await processEvent(row.id);
  }
  return rows.length;
}
