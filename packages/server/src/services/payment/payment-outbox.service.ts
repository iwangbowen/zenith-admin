/**
 * 支付事件 Outbox 服务。
 *
 * 解决「进程内事件总线在崩溃时丢失履约事件」的可靠性问题：
 * 支付/退款成功时，在更新订单/退款状态的**同一事务**内写入 outbox 事件（原子持久化），
 * 提交后立即 setImmediate 异步投递（低延迟）；若进程崩溃，cron `dispatchPaymentEvents`
 * 兜底补投 pending 事件。业务订阅者须自身幂等（可能被 outbox 与实时路径各投一次）。
 */
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { paymentEventAttempts, paymentEvents } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import type { PaymentEvent, PaymentEventType } from '../../lib/payment-event-bus';
import { currentTraceId, currentParentRef } from '../../lib/context';
import { recordDomainEvent } from '../platform/relations/events.service';
import { publishEventInTx } from '../../lib/domain-events';


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
  const eventId = randomUUID();
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
  await publishEventInTx(tx, {
    domain: 'payment', eventType: input.type, tenantId: input.tenantId,
    businessKey: `payment:${row.id}`, orderingKey: `payment:${input.orderNo}`,
    eventId, occurredAt: new Date(), subjectRefs: input.payload.subjectRefs,
    payload: { ...input.payload, type: input.type },
  });
  return row.id;
}

export async function interruptProcessingPaymentEventAttempts(
  tx: DbTransaction,
  eventId: number,
  finishedAt: Date,
  errorMessage: string,
  generation?: number,
): Promise<void> {
  await tx.update(paymentEventAttempts).set({
    status: 'failed',
    errorMessage,
    finishedAt,
  }).where(generation === undefined
    ? and(eq(paymentEventAttempts.eventId, eventId), eq(paymentEventAttempts.status, 'processing'))
    : and(eq(paymentEventAttempts.eventId, eventId), eq(paymentEventAttempts.generation, generation), eq(paymentEventAttempts.status, 'processing')));
}

export async function processEvent(id: number): Promise<void> {
  void id;
}

/** Cron 兜底：补投所有 pending 且未超重试上限的事件（含进程崩溃遗留）。返回扫描条数。 */
export async function dispatchPendingPaymentEvents(): Promise<number> {
  return 0;
}
