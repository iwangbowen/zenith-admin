/** Payment facts are persisted directly in the shared durable domain-event ledger. */
import { randomUUID } from 'node:crypto';
import type { DbTransaction } from '../../db/types';
import type { PaymentEvent, PaymentEventType } from '../../lib/payment-event';
import { currentParentRef, currentCorrelationId } from '../../lib/context';
import { publishEventInTx } from '../../lib/domain-events';
import { recordDomainEvent } from '../platform/relations/events.service';

export interface OutboxEventInput {
  type: PaymentEventType;
  orderNo: string;
  payload: Omit<PaymentEvent, 'eventId' | 'occurredAt'>;
  tenantId: number | null;
}

export async function recordEvent(tx: DbTransaction, input: OutboxEventInput): Promise<string> {
  if (!input.payload.subjectRefs?.length) throw new Error('Payment event requires explicit business subjects');
  if (input.tenantId === undefined || input.payload.tenantId !== input.tenantId) throw new Error('Payment event tenant must match its order');
  const eventId = randomUUID();
  await recordDomainEvent(tx, {
    eventType: input.type, payload: input.payload, subjects: input.payload.subjectRefs, tenantId: input.tenantId,
    source: input.payload.subjectRefs.find((subject) => subject.role === 'primary') ?? input.payload.subjectRefs[0],
    correlationId: currentCorrelationId(), parentRef: currentParentRef(), dedupeKey: `payment:${eventId}`,
  });
  await publishEventInTx(tx, {
    domain: 'payment', eventType: input.type, tenantId: input.tenantId,
    businessKey: eventId, orderingKey: `payment:${input.orderNo}`, eventId, occurredAt: new Date(),
    subjectRefs: input.payload.subjectRefs, payload: { ...input.payload, type: input.type },
  });
  return eventId;
}
