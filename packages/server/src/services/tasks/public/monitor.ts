import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db, readSnapshot } from '../../../db';
import { asyncTasks } from '../../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../../lib/datetime';
import type { JobSourceRawSummary } from '../../../lib/job-monitor/registry';
import { getTaskTypeMeta } from '../../../lib/task-center/registry';
import { HEARTBEAT_STALE_MS } from '../../../lib/task-center/types';

/** 超过正常心跳回收窗口后仍运行，才作为监控卡死上报。 */
export function stuckAsyncTaskCondition(asOf = new Date()) {
  const cutoff = new Date(asOf.getTime() - 2 * HEARTBEAT_STALE_MS);
  return and(eq(asyncTasks.status, 'running'), or(
    lt(asyncTasks.heartbeatAt, cutoff),
    and(isNull(asyncTasks.heartbeatAt), lt(asyncTasks.updatedAt, cutoff)),
  ));
}

/** 平台作业监控：仅统计已到期任务，重试退避期间不算积压。 */
export async function getAsyncTaskHealth(): Promise<JobSourceRawSummary> {
  return readSnapshot(async executor => {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const due = and(eq(asyncTasks.status, 'pending'), or(isNull(asyncTasks.nextRunAt), lte(asyncTasks.nextRunAt, now)));
  const scope = or(inArray(asyncTasks.status, ['pending', 'running']), and(inArray(asyncTasks.status, ['success', 'failed']), gte(asyncTasks.completedAt, since)));
  const [row] = await executor.select({
    pending: sql<number>`count(*) filter (where ${due})::int`,
    running: sql<number>`count(*) filter (where ${asyncTasks.status} = 'running')::int`,
    stuck: sql<number>`count(*) filter (where ${stuckAsyncTaskCondition(now)})::int`,
    failed24h: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed' and ${asyncTasks.completedAt} >= ${sql.param(since, asyncTasks.createdAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${asyncTasks.status} = 'success' and ${asyncTasks.completedAt} >= ${sql.param(since, asyncTasks.createdAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed' and ${asyncTasks.completedAt} >= ${sql.param(hour, asyncTasks.createdAt)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${sql.param(now, asyncTasks.createdAt)}::timestamptz - min(coalesce(${asyncTasks.nextRunAt}, ${asyncTasks.createdAt})) filter (where ${due}))))::int`,
  }).from(asyncTasks).where(scope);
  const breakdown = await executor.select({
    taskType: asyncTasks.taskType,
    pending: sql<number>`count(*) filter (where ${due})::int`,
    running: sql<number>`count(*) filter (where ${asyncTasks.status} = 'running')::int`,
    stuck: sql<number>`count(*) filter (where ${stuckAsyncTaskCondition(now)})::int`,
    failed24h: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed' and ${asyncTasks.completedAt} >= ${sql.param(since, asyncTasks.createdAt)})::int`,
  }).from(asyncTasks).where(scope).groupBy(asyncTasks.taskType)
    .orderBy(sql`count(*) filter (where ${stuckAsyncTaskCondition(now)}) desc`, sql`count(*) filter (where ${due} or ${asyncTasks.status} = 'running') desc`, asyncTasks.taskType).limit(10);
  return {
    counts: { pending: row?.pending ?? 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null,
    failed1h: row?.failed1h ?? 0,
    issues: [],
    breakdown: breakdown.map(item => {
      const meta = getTaskTypeMeta(item.taskType);
      return { key: item.taskType, label: meta ? `${meta.module} / ${meta.title}` : item.taskType,
        pending: item.pending, running: item.running, stuck: item.stuck, failed24h: item.failed24h,
        drillDown: { path: `/system/task-center?tab=tasks&taskType=${encodeURIComponent(item.taskType)}`, label: '查看任务类型' } };
    }),
  };
  });
}

export async function listStuckAsyncTasks(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({
    id: asyncTasks.id, title: asyncTasks.title, status: asyncTasks.status,
    startedAt: asyncTasks.startedAt, createdAt: asyncTasks.createdAt,
    heartbeatAt: asyncTasks.heartbeatAt, updatedAt: asyncTasks.updatedAt,
    nodeId: asyncTasks.nodeId, errorMessage: asyncTasks.errorMessage, progressNote: asyncTasks.progressNote,
  }).from(asyncTasks).where(stuckAsyncTaskCondition(now))
    .orderBy(sql`coalesce(${asyncTasks.heartbeatAt}, ${asyncTasks.updatedAt})`, asyncTasks.id).limit(limit);
  return rows.map((row) => ({
    source: 'async-task', refId: String(row.id), title: row.title, status: row.status,
    startedAt: formatNullableDateTime(row.startedAt), lastSeenAt: formatDateTime(row.heartbeatAt ?? row.updatedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - (row.startedAt ?? row.createdAt).getTime()) / 1000)),
    nodeId: row.nodeId, detail: row.errorMessage ?? row.progressNote,
    drillDown: { path: `/system/task-center?tab=tasks&status=running&taskId=${row.id}`, label: '查看任务' },
  }));
}
