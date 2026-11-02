import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { eventConsumerDeliveries, eventOutbox } from '../../db/schema/event-outbox';
import { formatDateTime, formatNullableDateTime } from '../datetime';
import type { JobSourceRawSummary } from '../job-monitor/registry';

const STUCK_AFTER_MS = 5 * 60_000;
const ACTIVE = ['pending', 'running', 'retrying'] as const;

function stuckCondition(asOf = new Date()) {
  return and(inArray(eventConsumerDeliveries.status, ACTIVE), lte(eventConsumerDeliveries.runAt, new Date(asOf.getTime() - STUCK_AFTER_MS)));
}

export async function getDomainEventConsumerHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} in ('pending','retrying'))::int`,
    running: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'running')::int`,
    stuck: sql<number>`count(*) filter (where ${stuckCondition(now)})::int`,
    dead: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'dead')::int`,
    failed24h: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'dead' and ${eventConsumerDeliveries.finishedAt} >= ${sql.param(since, eventConsumerDeliveries.finishedAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} in ('succeeded','skipped') and ${eventConsumerDeliveries.finishedAt} >= ${sql.param(since, eventConsumerDeliveries.finishedAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'dead' and ${eventConsumerDeliveries.finishedAt} >= ${sql.param(hour, eventConsumerDeliveries.finishedAt)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${sql.param(now, eventConsumerDeliveries.runAt)}::timestamptz - min(${eventConsumerDeliveries.runAt}) filter (where ${eventConsumerDeliveries.status} in ('pending','running','retrying'))))::int`,
  }).from(eventConsumerDeliveries).where(or(inArray(eventConsumerDeliveries.status, [...ACTIVE, 'dead']),
    and(inArray(eventConsumerDeliveries.status, ['succeeded', 'skipped']), gte(eventConsumerDeliveries.finishedAt, since))));
  return { counts: { pending: row?.pending ?? 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: row?.dead ?? 0,
    failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 }, oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null,
    failed1h: row?.failed1h ?? 0, issues: [] };
}

export async function listStuckDomainEventConsumers(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: eventConsumerDeliveries.id, consumerKey: eventConsumerDeliveries.consumerKey,
    status: eventConsumerDeliveries.status, runAt: eventConsumerDeliveries.runAt, lastError: eventConsumerDeliveries.lastError,
    eventType: eventOutbox.eventType, domain: eventOutbox.domain, occurredAt: eventOutbox.occurredAt,
  }).from(eventConsumerDeliveries).innerJoin(eventOutbox, eq(eventOutbox.id, eventConsumerDeliveries.eventId))
    .where(or(stuckCondition(now), eq(eventConsumerDeliveries.status, 'dead')))
    .orderBy(asc(eventConsumerDeliveries.runAt), asc(eventConsumerDeliveries.id)).limit(limit);
  return rows.map((row) => ({ source: 'domain-event-consumer', refId: String(row.id), title: `${row.consumerKey} / ${row.eventType}`,
    status: row.status, startedAt: formatDateTime(row.occurredAt), lastSeenAt: formatNullableDateTime(row.runAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - row.runAt.getTime()) / 1000)), nodeId: null,
    detail: row.lastError ?? `domain=${row.domain}`, drillDown: { path: '/workflow/monitor?tab=engine', label: '查看领域事件消费者' } }));
}
