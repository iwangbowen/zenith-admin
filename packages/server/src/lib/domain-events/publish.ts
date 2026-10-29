import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { stableStringify, type SubjectRef } from '@zenith/shared/core';
import type { DbTransaction } from '../../db/types';
import { eventOutbox, eventConsumerDeliveries } from '../../db/schema/event-outbox';
import { exactTenantCondition } from '../tenant';
import { currentTraceId, currentParentRef } from '../context';
import { matchingEventConsumers } from './registry';
import { rememberEventPickup } from './publication';

export interface PublishEventInput {
  domain: string; eventType: string; tenantId: number | null;
  businessKey: string; orderingKey: string; subjectRefs: readonly SubjectRef[];
  payload: Record<string, unknown>; scope?: Record<string, unknown>; occurredAt?: Date; eventId?: string;
}
/** Caller must own the source aggregate lock and await this write before committing. */
export async function publishEventInTx(tx: DbTransaction, input: PublishEventInput) {
  if (input.tenantId === undefined || !input.domain || !input.eventType || !input.businessKey || !input.orderingKey || !input.subjectRefs.length) {
    throw new Error('Event requires explicit tenant, type, business key, ordering key and subjects');
  }
  const signature = stableStringify({ payload: input.payload, scope: input.scope ?? {}, subjects: input.subjectRefs, orderingKey: input.orderingKey });
  if (Buffer.byteLength(signature) > 262144) throw new Error('Event snapshot exceeds 256 KiB');
  const payloadHash = createHash('sha256').update(signature).digest('hex');
  const matched = matchingEventConsumers(input);
  const [inserted] = await tx.insert(eventOutbox).values({ ...input, scope: input.scope ?? {},
    eventId: input.eventId ?? randomUUID(), payloadHash, traceId: currentTraceId(), parentRef: currentParentRef(),
  }).onConflictDoNothing().returning();
  if (!inserted) {
    const [existing] = await tx.select().from(eventOutbox).where(and(
      exactTenantCondition(eventOutbox.tenantId, input.tenantId), eq(eventOutbox.eventType, input.eventType), eq(eventOutbox.businessKey, input.businessKey),
    )).limit(1);
    if (!existing || existing.payloadHash !== payloadHash) throw new Error('Event business key conflicts with a different fact');
    return existing;
  }
  if (matched.length) await tx.insert(eventConsumerDeliveries).values(matched.map((consumer) => ({
    eventId: inserted.id, consumerKey: consumer.key, orderingKey: input.orderingKey, after: [...consumer.after ?? []], lane: consumer.lane ?? 'business', runAt: sql`clock_timestamp()`,
  })));
  rememberEventPickup(tx);
  return inserted;
}
