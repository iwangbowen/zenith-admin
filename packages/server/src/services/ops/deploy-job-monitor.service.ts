import { and, asc, eq, exists, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { deployRunHosts, deployRuns } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { orphanRunCondition } from '../../lib/job-monitor/orphan';

/** A correlated EXISTS counts one deployment even when several hosts have timed out. */
export function overdueDeployHostCondition(asOf = new Date()) {
  return exists(db.select({ id: deployRunHosts.id }).from(deployRunHosts).where(and(
    eq(deployRunHosts.runId, deployRuns.id), eq(deployRunHosts.status, 'running'),
    lt(deployRunHosts.startedAt, new Date(asOf.getTime() - 30 * 60_000)),
  )));
}

export function stuckDeployRunCondition(asOf = new Date()) {
  return or(orphanRunCondition({ table: deployRuns, statusColumn: deployRuns.status, activeStatuses: ['pending', 'running'],
    taskIdColumn: deployRuns.asyncTaskId, startedAtColumn: sql`coalesce(${deployRuns.startedAt}, ${deployRuns.createdAt})`, asOf }), overdueDeployHostCondition(asOf));
}

export async function getDeployRunHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const stuck = stuckDeployRunCondition(now);
  const [row] = await db.select({
    stuck: sql<number>`count(*) filter (where ${stuck})::int`,
    failed24h: sql<number>`count(*) filter (where ${deployRuns.status} = 'failed' and ${deployRuns.finishedAt} >= ${sql.param(since, deployRuns.finishedAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${deployRuns.status} = 'succeeded' and ${deployRuns.finishedAt} >= ${sql.param(since, deployRuns.finishedAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${deployRuns.status} = 'failed' and ${deployRuns.finishedAt} >= ${sql.param(hour, deployRuns.finishedAt)})::int`,
    partial24h: sql<number>`count(*) filter (where ${deployRuns.status} = 'partial' and ${deployRuns.finishedAt} >= ${sql.param(since, deployRuns.finishedAt)})::int`,
  }).from(deployRuns).where(or(inArray(deployRuns.status, ['pending', 'running']), gte(deployRuns.finishedAt, since), overdueDeployHostCondition(now)));
  return {
    counts: { pending: 0, running: 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: null, failed1h: row?.failed1h ?? 0,
    issues: row?.partial24h ? [{ level: 'warn', message: `近 24 小时有 ${row.partial24h} 次应用部署仅部分主机成功` }] : [],
  };
}

export async function listStuckDeployRuns(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: deployRuns.id, kind: deployRuns.kind, version: deployRuns.version, status: deployRuns.status,
    startedAt: deployRuns.startedAt, createdAt: deployRuns.createdAt, updatedAt: deployRuns.updatedAt, error: deployRuns.error,
  }).from(deployRuns).where(stuckDeployRunCondition(now)).orderBy(asc(deployRuns.createdAt), asc(deployRuns.id)).limit(limit);
  return rows.map(row => ({
    source: 'deploy-run', refId: String(row.id), title: `${row.kind} / ${row.version ?? `部署 #${row.id}`}`, status: row.status,
    startedAt: formatNullableDateTime(row.startedAt), lastSeenAt: formatDateTime(row.updatedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - (row.startedAt ?? row.createdAt).getTime()) / 1000)),
    nodeId: null, detail: row.error ?? '关联任务已失联或至少一台主机运行超过 30 分钟',
    drillDown: { path: `/system/deploy?tab=records&status=${row.status}`, label: '查看部署记录' },
  }));
}
