import { randomUUID } from 'node:crypto';
import { and, asc, eq, exists, gt, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { ENTITY_TIMELINE_EVENT_LABELS, isWatchableDomainEvent } from '@zenith/shared/platform';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { domainEvents, domainEventSubjects, entityWatches, entityWatchEvents } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import logger from '../../lib/logger';
import { authorizeWatchedEvent, getCurrentWatch } from './entity-watch-access';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { formatNullableDateTime } from '../../lib/datetime';
import type { JobStuckItem } from '@zenith/shared/platform';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';

const BATCH_SIZE = 20;
const LEASE_MS = 120_000;

export function stuckEntityWatchEventCondition(asOf = new Date()) {
  return lt(entityWatchEvents.claimedAt, new Date(asOf.getTime() - 2 * LEASE_MS));
}

/** 已完成关注事件从 outbox 删除；仅统计存量投递，不伪造成功/失败历史。 */
export async function getEntityWatchDeliveryHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - LEASE_MS);
  const due = and(lte(entityWatchEvents.nextAttemptAt, now), or(isNull(entityWatchEvents.claimedAt), lt(entityWatchEvents.claimedAt, leaseCutoff)));
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${due})::int`,
    running: sql<number>`count(*) filter (where ${entityWatchEvents.claimedAt} >= ${leaseCutoff})::int`,
    stuck: sql<number>`count(*) filter (where ${stuckEntityWatchEventCondition(now)})::int`,
    repeatedFailures: sql<number>`count(*) filter (where ${isNotNull(entityWatchEvents.lastError)} and ${gte(entityWatchEvents.attempts, 5)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${now}::timestamptz - min(${entityWatchEvents.nextAttemptAt}) filter (where ${due}))))::int`,
  }).from(entityWatchEvents);
  return {
    counts: { pending: row?.pending ?? 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: null, failed24h: 0, succeeded24h: 0 },
    oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null, failed1h: 0,
    issues: row?.repeatedFailures ? [{ level: 'warn', message: `${row.repeatedFailures} 个对象关注事件已连续尝试至少 5 次，仍在自动重试` }] : [],
  };
}

export async function listStuckEntityWatchEvents(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ eventId: entityWatchEvents.eventId, eventType: domainEvents.eventType,
    claimedAt: entityWatchEvents.claimedAt, lastError: entityWatchEvents.lastError, attempts: entityWatchEvents.attempts,
  }).from(entityWatchEvents).leftJoin(domainEvents, eq(domainEvents.id, entityWatchEvents.eventId))
    .where(stuckEntityWatchEventCondition(now)).orderBy(asc(entityWatchEvents.claimedAt), asc(entityWatchEvents.eventId)).limit(limit);
  return rows.map(row => ({
    source: 'entity-watch-delivery', refId: String(row.eventId), title: row.eventType ?? `对象关注事件 #${row.eventId}`, status: 'claimed',
    startedAt: formatNullableDateTime(row.claimedAt), lastSeenAt: formatNullableDateTime(row.claimedAt),
    ageSec: row.claimedAt ? Math.max(0, Math.floor((now.getTime() - row.claimedAt.getTime()) / 1000)) : 0,
    nodeId: null, detail: row.lastError ?? `已尝试 ${row.attempts} 次；完成后自动删除投递记录`, drillDown: null,
  }));
}

export function matchingWatchCondition(event: typeof domainEvents.$inferSelect) {
  return and(exactTenantCondition(entityWatches.tenantId, event.tenantId), lte(entityWatches.createdAt, event.occurredAt), or(
    and(eq(entityWatches.entityType, event.sourceType ?? ''), eq(entityWatches.entityKey, event.sourceKey ?? '')),
    exists(db.select({ id: domainEventSubjects.eventId }).from(domainEventSubjects).where(and(
      eq(domainEventSubjects.eventId, event.id), eq(domainEventSubjects.entityType, entityWatches.entityType),
      eq(domainEventSubjects.entityKey, entityWatches.entityKey), exactTenantCondition(domainEventSubjects.tenantId, event.tenantId)))),
  ));
}

async function claimEvent() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`);
    const now = new Date();
    const [candidate] = await tx.select({ id: entityWatchEvents.eventId }).from(entityWatchEvents).where(and(
      lte(entityWatchEvents.nextAttemptAt, now), or(isNull(entityWatchEvents.claimedAt), lt(entityWatchEvents.claimedAt, new Date(now.getTime() - LEASE_MS))),
    )).orderBy(asc(entityWatchEvents.nextAttemptAt), asc(entityWatchEvents.eventId)).limit(1).for('update', { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await tx.update(entityWatchEvents).set({ leaseToken: randomUUID(), claimedAt: now, attempts: sql`${entityWatchEvents.attempts} + 1` })
      .where(eq(entityWatchEvents.eventId, candidate.id)).returning();
    return claimed;
  });
}

/** The cursor advances in the same transaction as notification enqueue, including skipped/revoked subscriptions. */
async function processWatch(tx: DbTransaction, event: typeof domainEvents.$inferSelect, leaseToken: string, watchId: number) {
  const [pending] = await tx.select().from(entityWatchEvents).where(and(eq(entityWatchEvents.eventId, event.id), eq(entityWatchEvents.leaseToken, leaseToken)))
    .limit(1).for('update');
  if (!pending || pending.watcherCursor >= watchId) return;
  const watch = await getCurrentWatch(tx, watchId, event.tenantId);
  if (watch) {
    const authorized = await authorizeWatchedEvent(tx, watch, event);
    if (authorized) await notifyWithin(tx, 'platform.entity.changed', {
      recipients: [{ type: 'user', id: watch.userId }], tenantId: event.tenantId,
      vars: { watchId: watch.id, eventId: event.id, objectTitle: authorized.title.slice(0, 160),
        eventLabel: ENTITY_TIMELINE_EVENT_LABELS[event.eventType as keyof typeof ENTITY_TIMELINE_EVENT_LABELS] ?? '业务状态更新' },
      link: authorized.link, dedupeKey: `entity-watch:${event.id}:user:${watch.userId}`,
      subjectRefs: [{ ...authorized.watched, role: 'related' }, { ...authorized.source, role: 'source' }],
    });
  }
  await tx.update(entityWatchEvents).set({ watcherCursor: watchId, claimedAt: new Date(), lastError: null })
    .where(and(eq(entityWatchEvents.eventId, event.id), eq(entityWatchEvents.leaseToken, leaseToken)));
}

export async function drainEntityWatchEvents(): Promise<string> {
  const deadline = Date.now() + 40_000;
  let handled = 0;
  while (Date.now() < deadline && handled < 200) {
    const pending = await claimEvent();
    if (!pending?.leaseToken) break;
    const ownership = and(eq(entityWatchEvents.eventId, pending.eventId), eq(entityWatchEvents.leaseToken, pending.leaseToken));
    try {
      const [event] = await db.select().from(domainEvents).where(eq(domainEvents.id, pending.eventId)).limit(1);
      if (!event || !isWatchableDomainEvent(event.eventType)) {
        await db.delete(entityWatchEvents).where(ownership);
        handled++;
        continue;
      }
      const watchers = await db.select({ id: entityWatches.id }).from(entityWatches).where(and(matchingWatchCondition(event), gt(entityWatches.id, pending.watcherCursor)))
        .orderBy(asc(entityWatches.id)).limit(BATCH_SIZE);
      let processed = 0;
      for (const watch of watchers) {
        if (Date.now() >= deadline) break;
        await db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`);
          await processWatch(tx, event, pending.leaseToken!, watch.id);
        });
        processed++;
      }
      if (processed === watchers.length && watchers.length < BATCH_SIZE) await db.delete(entityWatchEvents).where(ownership);
      else await db.update(entityWatchEvents).set({ claimedAt: null, leaseToken: null, nextAttemptAt: new Date() }).where(ownership);
      handled++;
    } catch (error) {
      const delay = Math.min(300_000, 1000 * 2 ** Math.min(pending.attempts, 8));
      await db.update(entityWatchEvents).set({ claimedAt: null, leaseToken: null, nextAttemptAt: new Date(Date.now() + delay), lastError: '关注通知处理暂不可用，将自动重试' }).where(ownership);
      logger.error({ err: error, eventId: pending.eventId }, '[entity-watches] event delivery deferred');
    }
  }
  return `对象关注通知已处理 ${handled} 个事件批次`;
}
