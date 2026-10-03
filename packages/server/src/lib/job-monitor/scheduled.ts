import { asc, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import { JOB_MONITOR_SCHEDULE_GRACE_MS, type JobDrillDown, type JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { formatDateTime } from '../datetime';
import type { JobSourceRawSummary } from './registry';

/** Domain services own the condition; this helper only composes inexpensive counts and projections. */
export interface ScheduledMonitorQuery {
  key: string; label: string; table: AnyPgTable;
  due(asOf: Date): SQL | undefined;
  id: AnyPgColumn; title: AnyPgColumn | SQL; status: AnyPgColumn | SQL;
  dueAt: AnyPgColumn | SQL; dateColumn: AnyPgColumn; drillDown: JobDrillDown;
}

export async function collectScheduledJobs(options: ScheduledMonitorQuery): Promise<JobSourceRawSummary> {
  const now = new Date();
  const grace = new Date(now.getTime() - JOB_MONITOR_SCHEDULE_GRACE_MS);
  const [row] = await db.select({
    pending: sql<number>`count(*)::int`,
    stuck: sql<number>`count(*) filter (where ${options.due(grace)})::int`,
    oldestPendingAgeSec: sql<number | null>`greatest(0, floor(${now.getTime() / 1000} - extract(epoch from min(${options.dueAt}))))::int`,
  }).from(options.table).where(options.due(now));
  return {
    counts: { pending: row?.pending ?? 0, running: 0, stuck: row?.stuck ?? 0, dead: null, failed24h: 0, succeeded24h: 0 },
    oldestPendingAgeSec: row?.pending ? row.oldestPendingAgeSec : null, failed1h: 0, issues: [],
  };
}

export async function listOverdueScheduledJobs(options: ScheduledMonitorQuery, limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: options.id, title: options.title, status: options.status,
    dueAt: sql<Date>`${options.dueAt}`.mapWith((value: unknown) => options.dateColumn.mapFromDriverValue(value) as Date),
  }).from(options.table).where(options.due(new Date(now.getTime() - JOB_MONITOR_SCHEDULE_GRACE_MS)))
    .orderBy(asc(options.dueAt), asc(options.id)).limit(limit);
  return rows.map(row => ({ source: 'scheduled-dispatch', refId: `${options.key}:${row.id}`, title: String(row.title ?? options.label), status: String(row.status),
    startedAt: null, lastSeenAt: formatDateTime(row.dueAt), ageSec: Math.max(0, Math.floor((now.getTime() - row.dueAt.getTime()) / 1000)),
    nodeId: null, detail: '已到期超过调度宽限期，尚未被处理', drillDown: options.drillDown,
  }));
}
