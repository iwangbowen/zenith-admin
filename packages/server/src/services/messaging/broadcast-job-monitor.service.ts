import { and, asc, eq, exists, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { ASYNC_TASK_TERMINAL_STATUSES } from '@zenith/shared/tasks';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { asyncTasks, broadcastCampaigns } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { ORPHAN_GRACE_MS, orphanRunCondition } from '../../lib/job-monitor/orphan';

export function incompleteBroadcastCondition(asOf = new Date()) {
  return and(eq(broadcastCampaigns.status, 'sending'), lt(broadcastCampaigns.updatedAt, new Date(asOf.getTime() - ORPHAN_GRACE_MS)),
    lt(broadcastCampaigns.enqueuedCount, broadcastCampaigns.totalRecipients),
    exists(db.select({ id: asyncTasks.id }).from(asyncTasks).where(and(eq(asyncTasks.id, broadcastCampaigns.taskId), inArray(asyncTasks.status, [...ASYNC_TASK_TERMINAL_STATUSES])))));
}

export function stuckBroadcastCondition(asOf = new Date()) {
  return or(orphanRunCondition({ table: broadcastCampaigns, statusColumn: broadcastCampaigns.status, activeStatuses: ['sending'],
    taskIdColumn: broadcastCampaigns.taskId, startedAtColumn: broadcastCampaigns.updatedAt, asOf }), incompleteBroadcastCondition(asOf));
}

export async function getBroadcastHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const [row] = await db.select({
    stuck: sql<number>`count(*) filter (where ${stuckBroadcastCondition(now)})::int`,
    incomplete: sql<number>`count(*) filter (where ${incompleteBroadcastCondition(now)})::int`,
    failed24h: sql<number>`count(*) filter (where ${broadcastCampaigns.status} = 'failed' and ${broadcastCampaigns.updatedAt} >= ${sql.param(since, broadcastCampaigns.updatedAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${broadcastCampaigns.status} = 'sent' and ${broadcastCampaigns.sentAt} >= ${sql.param(since, broadcastCampaigns.updatedAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${broadcastCampaigns.status} = 'failed' and ${broadcastCampaigns.updatedAt} >= ${sql.param(hour, broadcastCampaigns.updatedAt)})::int`,
  }).from(broadcastCampaigns).where(or(eq(broadcastCampaigns.status, 'sending'), gte(broadcastCampaigns.updatedAt, since)));
  return {
    counts: { pending: 0, running: 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: null, failed1h: row?.failed1h ?? 0,
    issues: row?.incomplete ? [{ level: 'warn', message: `${row.incomplete} 个群发任务已结束，但受众尚未全部入队` }] : [],
  };
}

export async function listStuckBroadcasts(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: broadcastCampaigns.id, title: broadcastCampaigns.title,
    createdAt: broadcastCampaigns.createdAt, updatedAt: broadcastCampaigns.updatedAt, totalRecipients: broadcastCampaigns.totalRecipients, enqueuedCount: broadcastCampaigns.enqueuedCount,
  }).from(broadcastCampaigns).where(stuckBroadcastCondition(now)).orderBy(asc(broadcastCampaigns.updatedAt), asc(broadcastCampaigns.id)).limit(limit);
  return rows.map(row => ({
    source: 'broadcast', refId: String(row.id), title: row.title, status: 'sending', startedAt: formatDateTime(row.createdAt), lastSeenAt: formatDateTime(row.updatedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - row.updatedAt.getTime()) / 1000)), nodeId: null,
    detail: `关联任务未能继续推进；已入队 ${row.enqueuedCount}/${row.totalRecipients ?? '待解析'} 个受众`,
    drillDown: { path: '/system/broadcasts?status=sending', label: '查看群发活动' },
  }));
}
