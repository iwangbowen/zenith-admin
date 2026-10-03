import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { paymentEvents } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { optionalExactTenantCondition } from '../../lib/tenant';

const EVENT_BACKLOG_GRACE_MS = 5 * 60_000;

export function stuckPaymentEventCondition(asOf = new Date()) {
  return and(eq(paymentEvents.status, 'pending'), lte(paymentEvents.createdAt, new Date(asOf.getTime() - EVENT_BACKLOG_GRACE_MS)));
}

/** undefined 表示全平台，null 表示平台自有数据，数字表示单租户；调用方显式保持各自 scope。 */
export async function getPaymentEventHealth(tenantId?: number | null): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${paymentEvents.status} = 'pending')::int`,
    stuck: sql<number>`count(*) filter (where ${stuckPaymentEventCondition(now)})::int`,
    dead: sql<number>`count(*) filter (where ${paymentEvents.status} = 'failed')::int`,
    failed24h: sql<number>`count(*) filter (where ${paymentEvents.status} = 'failed' and ${paymentEvents.processedAt} >= ${sql.param(since, paymentEvents.processedAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${paymentEvents.status} = 'done' and ${paymentEvents.processedAt} >= ${sql.param(since, paymentEvents.processedAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${paymentEvents.status} = 'failed' and ${paymentEvents.processedAt} >= ${sql.param(hour, paymentEvents.processedAt)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${sql.param(now, paymentEvents.processedAt)}::timestamptz - min(${paymentEvents.createdAt}) filter (where ${paymentEvents.status} = 'pending'))))::int`,
  }).from(paymentEvents).where(and(optionalExactTenantCondition(paymentEvents.tenantId, tenantId),
    or(inArray(paymentEvents.status, ['pending', 'failed']), and(eq(paymentEvents.status, 'done'), gte(paymentEvents.processedAt, since)))));
  return {
    counts: { pending: row?.pending ?? 0, running: 0, stuck: row?.stuck ?? 0, dead: row?.dead ?? 0, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null, failed1h: row?.failed1h ?? 0, issues: [],
  };
}

export async function listStuckPaymentEvents(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: paymentEvents.id, type: paymentEvents.type, orderNo: paymentEvents.orderNo,
    createdAt: paymentEvents.createdAt, processedAt: paymentEvents.processedAt, lastError: paymentEvents.lastError,
  }).from(paymentEvents).where(stuckPaymentEventCondition(now)).orderBy(asc(paymentEvents.createdAt), asc(paymentEvents.id)).limit(limit);
  return rows.map(row => ({
    source: 'payment-event-outbox', refId: String(row.id), title: `${row.orderNo} / ${row.type}`, status: 'pending',
    startedAt: formatDateTime(row.createdAt), lastSeenAt: formatNullableDateTime(row.processedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 1000)),
    nodeId: null, detail: row.lastError, drillDown: { path: '/payment/events?status=pending', label: '查看支付事件' },
  }));
}
