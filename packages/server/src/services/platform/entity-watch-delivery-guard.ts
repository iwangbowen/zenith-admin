import { and, eq, sql } from 'drizzle-orm';
import type { NotificationRecipient } from '@zenith/shared/messaging';
import { ENTITY_TIMELINE_EVENT_LABELS, isWatchableDomainEvent } from '@zenith/shared/platform';
import { SUBJECT_REF_LIMIT } from '@zenith/shared/core';
import { db } from '../../db';
import { domainEvents, entityWatches, type NotificationOutboxRow } from '../../db/schema';
import { createConcurrencyLimiter } from '../../lib/concurrency';
import { authorizeWatchedEvent } from './entity-watch-access';
import { matchingWatchCondition } from './entity-watch-worker';

const guardLimiter = createConcurrencyLimiter(4);

/** Called immediately before the channel sends, also for quiet-hour/digest delayed outbox rows. */
export async function authorizeEntityWatchDelivery(row: NotificationOutboxRow, recipient: NotificationRecipient) {
  if (recipient.type !== 'user' || !Number.isSafeInteger(row.vars.eventId) || Number(row.vars.eventId) < 1) return null;
  return guardLimiter.run(() => db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`);
    const [event] = await tx.select().from(domainEvents).where(eq(domainEvents.id, Number(row.vars.eventId))).limit(1);
    if (!event || event.tenantId !== row.tenantId || !isWatchableDomainEvent(event.eventType)) return null;
    // One event/user notification can be backed by several watched subjects. Cancellation of the last matching edge suppresses it.
    const watches = await tx.select().from(entityWatches).where(and(eq(entityWatches.userId, recipient.id), matchingWatchCondition(event)))
      .limit(SUBJECT_REF_LIMIT + 1);
    for (const watch of watches) {
      const authorized = await authorizeWatchedEvent(tx, watch, event);
      if (authorized) {
        const label = ENTITY_TIMELINE_EVENT_LABELS[event.eventType as keyof typeof ENTITY_TIMELINE_EVENT_LABELS] ?? '业务状态更新';
        return { vars: { watchId: watch.id, eventId: event.id, objectTitle: authorized.title.slice(0, 160), eventLabel: label }, link: authorized.link };
      }
    }
    return null;
  }));
}
