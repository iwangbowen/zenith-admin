import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { eventConsumerAttempts, eventConsumerDeliveries as deliveries, eventOutbox, type ConsumerDeliveryRow } from '../../db/schema/event-outbox';
import type { DbTransaction } from '../../db/types';
import { registerSystemLedgerWorker } from '../pg-boss-scheduler';
import { flushTransactionEffects } from '../transaction-effects';
import logger from '../logger';
import { runWithTraceId, runWithParentRef } from '../context';
import { EventLeaseLostError, getEventConsumer, PermanentEventError } from './registry';
import { EVENT_OUTBOX_QUEUE } from './publication';
import { runInEventConsumer } from './context';

const now = sql`clock_timestamp()`;
const leaseMs = 30_000;
const clearLease = { leaseToken: null, leaseUntil: null };
function owned(delivery: ConsumerDeliveryRow) {
  return and(eq(deliveries.id, delivery.id), eq(deliveries.status, 'running'),
    eq(deliveries.generation, delivery.generation), eq(deliveries.leaseToken, delivery.leaseToken!), gt(deliveries.leaseUntil, now));
}

export async function claimEventConsumers(available: number, lane: 'business' | 'analytics' = 'business'): Promise<ConsumerDeliveryRow[]> {
  if (available <= 0) return [];
  return db.transaction(async (tx) => {
    const expired = await tx.update(deliveries).set({
      status: sql`case when attempts >= max_attempts then 'dead' else 'retrying' end`,
      lastError: 'Consumer lease expired before confirmation', runAt: sql`clock_timestamp() + interval '1 second'`, ...clearLease,
    }).where(sql`id in (select id from event_consumer_deliveries where lane = ${lane} and status = 'running'
      and lease_until <= clock_timestamp() order by id limit 100 for update skip locked)`).returning({ id: deliveries.id, generation: deliveries.generation });
    for (const expiredDelivery of expired) await tx.update(eventConsumerAttempts).set({ status: 'failed', finishedAt: now, error: 'Consumer lease expired before confirmation' })
      .where(and(eq(eventConsumerAttempts.deliveryId, expiredDelivery.id), eq(eventConsumerAttempts.generation, expiredDelivery.generation), eq(eventConsumerAttempts.status, 'running')));
    const claimed = await tx.update(deliveries).set({ status: 'running', attempts: sql`attempts + 1`, generation: sql`generation + 1`,
      leaseToken: randomUUID(), leaseUntil: sql`clock_timestamp() + ${leaseMs} * interval '1 millisecond'`,
    }).where(sql`id in (
      select d.id from event_consumer_deliveries d
      where d.lane = ${lane} and d.status in ('pending','retrying') and d.run_at <= clock_timestamp() and d.attempts < d.max_attempts
      and not exists (select 1 from event_consumer_deliveries older
        where older.consumer_key = d.consumer_key and older.ordering_key = d.ordering_key and older.event_id < d.event_id
        and older.status not in ('succeeded','skipped'))
      and not exists (select 1 from jsonb_array_elements_text(d.after) dependency(key)
        where not exists (select 1 from event_consumer_deliveries prerequisite
          where prerequisite.event_id = d.event_id and prerequisite.consumer_key = dependency.key
          and prerequisite.status in ('succeeded','skipped')))
      order by d.run_at,d.id limit ${Math.min(available, 32)} for update of d skip locked
    )`).returning();
    if (claimed.length) await tx.insert(eventConsumerAttempts).values(claimed.map((delivery) => ({
      deliveryId: delivery.id, generation: delivery.generation, attempt: delivery.attempts, leaseToken: delivery.leaseToken!,
    })));
    return claimed;
  });
}

/** A failed lease confirmation rolls back the effect as well as the receipt. */
export async function executeEventConsumer(delivery: ConsumerDeliveryRow): Promise<void> {
  let committed: DbTransaction | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '15s'`);
      await tx.execute(sql`set local lock_timeout = '5s'`);
      const [current] = await tx.select().from(deliveries).where(owned(delivery)).for('update');
      if (!current) throw new EventLeaseLostError();
      const [event] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, current.eventId));
      if (!event) throw new PermanentEventError('Event fact is missing');
      const consumer = getEventConsumer(current.consumerKey);
      const result = await runWithTraceId(event.traceId ?? event.eventId, () =>
        runWithParentRef(`event:${event.eventId}`, () => runInEventConsumer(current.consumerKey, () => consumer.handle(tx, event, current))));
      const status = result.outcome === 'skipped' ? 'skipped' : 'succeeded';
      const confirmed = await tx.update(deliveries).set({ status, result: { ...result }, finishedAt: now, lastError: null, ...clearLease })
        .where(owned(delivery)).returning({ id: deliveries.id });
      if (!confirmed.length) throw new EventLeaseLostError();
      await tx.update(eventConsumerAttempts).set({ status, finishedAt: now })
        .where(and(eq(eventConsumerAttempts.deliveryId, delivery.id), eq(eventConsumerAttempts.generation, delivery.generation)));
      committed = tx;
    });
    if (committed) await flushTransactionEffects(committed);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2048);
    await db.transaction(async (tx) => {
      const dead = error instanceof PermanentEventError || delivery.attempts >= delivery.maxAttempts;
      const changed = await tx.update(deliveries).set({ status: dead ? 'dead' : 'retrying', lastError: message,
        runAt: sql`clock_timestamp() + ${Math.min(300_000, 1000 * 2 ** Math.min(delivery.attempts, 8))} * interval '1 millisecond'`,
        finishedAt: dead ? now : null, ...clearLease,
      }).where(owned(delivery)).returning({ id: deliveries.id });
      if (changed.length) await tx.update(eventConsumerAttempts).set({ status: 'failed', error: message, finishedAt: now })
        .where(and(eq(eventConsumerAttempts.deliveryId, delivery.id), eq(eventConsumerAttempts.generation, delivery.generation)));
    });
    logger.warn('[domain-events] consumer did not confirm', { consumer: delivery.consumerKey, deliveryId: delivery.id, error: message });
  }
}

/** Failed consumer only; successful siblings and immutable facts are never reset. */
export async function retryEventConsumer(id: number): Promise<boolean> {
  const [row] = await db.update(deliveries).set({ status: 'pending', attempts: 0, generation: sql`generation + 1`,
    runAt: now, finishedAt: null, lastError: null, ...clearLease,
  }).where(and(eq(deliveries.id, id), inArray(deliveries.status, ['dead', 'retrying']))).returning({ id: deliveries.id });
  return !!row;
}

export async function registerDomainEventWorker(): Promise<void> {
  for (const lane of ['business', 'analytics'] as const) await registerSystemLedgerWorker<ConsumerDeliveryRow>({
    name: lane === 'business' ? EVENT_OUTBOX_QUEUE : `${EVENT_OUTBOX_QUEUE}-analytics`, title: lane === 'business' ? '领域事件派发' : '权威事件分析',
    module: '平台', description: '事务事件账本：有界认领、独立消费者回执与故障恢复', concurrency: lane === 'business' ? 4 : 1,
    pollingIntervalMs: 2000, claim: (available) => claimEventConsumers(available, lane), execute: executeEventConsumer,
    onError: (error) => logger.error('[domain-events] worker error', { error }),
  });
}
