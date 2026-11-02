import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { eventConsumerDeliveries, eventOutbox } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { optionalExactTenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';

const EVENT_BACKLOG_GRACE_MS = 5 * 60_000;
const ACTIVE_STATUSES = ['pending', 'running', 'retrying'] as const;

export function stuckPaymentEventCondition(asOf = new Date()) {
  return and(eq(eventOutbox.domain, 'payment'), inArray(eventConsumerDeliveries.status, ACTIVE_STATUSES),
    lte(eventConsumerDeliveries.runAt, new Date(asOf.getTime() - EVENT_BACKLOG_GRACE_MS)));
}

/** undefined = all tenants, null = platform facts, number = one tenant. */
export async function getPaymentEventHealth(tenantId?: number | null): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const scope = buildWhere(eq(eventOutbox.domain, 'payment'), optionalExactTenantCondition(eventOutbox.tenantId, tenantId));
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} in ('pending','retrying'))::int`,
    running: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'running')::int`,
    stuck: sql<number>`count(*) filter (where ${stuckPaymentEventCondition(now)})::int`,
    dead: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'dead')::int`,
    failed24h: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'dead' and ${eventConsumerDeliveries.finishedAt} >= ${sql.param(since, eventConsumerDeliveries.finishedAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} in ('succeeded','skipped') and ${eventConsumerDeliveries.finishedAt} >= ${sql.param(since, eventConsumerDeliveries.finishedAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${eventConsumerDeliveries.status} = 'dead' and ${eventConsumerDeliveries.finishedAt} >= ${sql.param(hour, eventConsumerDeliveries.finishedAt)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${sql.param(now, eventConsumerDeliveries.runAt)}::timestamptz - min(${eventConsumerDeliveries.runAt}) filter (where ${eventConsumerDeliveries.status} in ('pending','running','retrying')))))::int`,
  }).from(eventConsumerDeliveries).innerJoin(eventOutbox, eq(eventOutbox.id, eventConsumerDeliveries.eventId)).where(scope);
  return { counts: { pending: row?.pending ?? 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: row?.dead ?? 0,
    failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 }, oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null,
    failed1h: row?.failed1h ?? 0, issues: [] };
}

export async function listStuckPaymentEvents(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: eventConsumerDeliveries.id, type: eventOutbox.eventType,
    orderNo: sql<string>`${eventOutbox.payload}->>'orderNo'`, consumerKey: eventConsumerDeliveries.consumerKey,
    createdAt: eventOutbox.occurredAt, runAt: eventConsumerDeliveries.runAt, lastError: eventConsumerDeliveries.lastError,
    status: eventConsumerDeliveries.status,
  }).from(eventConsumerDeliveries).innerJoin(eventOutbox, eq(eventOutbox.id, eventConsumerDeliveries.eventId))
    .where(or(stuckPaymentEventCondition(now), and(eq(eventOutbox.domain, 'payment'), eq(eventConsumerDeliveries.status, 'dead'))))
    .orderBy(asc(eventConsumerDeliveries.runAt), asc(eventConsumerDeliveries.id)).limit(limit);
  return rows.map((row) => ({ source: 'payment-event-outbox', refId: String(row.id), title: `${row.orderNo} / ${row.type} / ${row.consumerKey}`,
    status: row.status, startedAt: formatDateTime(row.createdAt), lastSeenAt: formatNullableDateTime(row.runAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - row.runAt.getTime()) / 1000)), nodeId: null, detail: row.lastError,
    drillDown: { path: `/payment/events?status=${row.status}`, label: '查看支付事件消费者' } }));
}
