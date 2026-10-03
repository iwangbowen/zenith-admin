import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { JobSourceBreakdown, JobStuckItem } from '@zenith/shared/platform';
import { db, readSnapshot } from '../../db';
import { cmsDeliveryRuns, cmsDeployments, cmsMediaProcessing } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { ORPHAN_GRACE_MS, orphanRunCondition, orphanTaskCondition } from '../../lib/job-monitor/orphan';

/** A deployment is alive while any linked task is alive; old successful build attempts do not hide an orphan. */
export function stuckCmsDeploymentCondition(asOf = new Date()) {
  return and(eq(cmsDeployments.status, 'building'), lt(cmsDeployments.createdAt, new Date(asOf.getTime() - ORPHAN_GRACE_MS)),
    sql`not exists (select 1 from jsonb_array_elements_text(${cmsDeployments.taskIds}) as deployment_task(task_id)
      where not (${orphanTaskCondition(sql`deployment_task.task_id::int`, asOf)}))`);
}

export function stuckCmsDeliveryCondition(asOf = new Date()) {
  return and(eq(cmsDeliveryRuns.purgeStatus, 'pending'), orphanRunCondition({ table: cmsDeliveryRuns, statusColumn: cmsDeliveryRuns.status,
    activeStatuses: ['activated', 'cache_refreshing', 'checking'], taskIdColumn: cmsDeliveryRuns.taskId,
    startedAtColumn: sql`coalesce(${cmsDeliveryRuns.startedAt}, ${cmsDeliveryRuns.createdAt})`, asOf }));
}

export function stuckCmsMediaCondition(asOf = new Date()) {
  return orphanRunCondition({ table: cmsMediaProcessing, statusColumn: cmsMediaProcessing.status, activeStatuses: ['pending', 'running'],
    taskIdColumn: cmsMediaProcessing.taskId, startedAtColumn: cmsMediaProcessing.updatedAt, asOf });
}

const drillDown = { path: '/cms/publishing', label: '查看 CMS 发布' };

export async function getCmsPipelineHealth(): Promise<JobSourceRawSummary> {
  return readSnapshot(async executor => {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const deployments = await executor.select({ stuck: sql<number>`count(*) filter (where ${stuckCmsDeploymentCondition(now)})::int`,
      failed24h: sql<number>`count(*) filter (where ${cmsDeployments.status} = 'failed' and ${cmsDeployments.updatedAt} >= ${sql.param(since, cmsDeployments.updatedAt)})::int`,
      failed1h: sql<number>`count(*) filter (where ${cmsDeployments.status} = 'failed' and ${cmsDeployments.updatedAt} >= ${sql.param(hour, cmsDeployments.updatedAt)})::int`,
    }).from(cmsDeployments).where(or(eq(cmsDeployments.status, 'building'), gte(cmsDeployments.updatedAt, since)));
  const deliveries = await executor.select({ stuck: sql<number>`count(*) filter (where ${stuckCmsDeliveryCondition(now)})::int`,
      failed24h: sql<number>`count(*) filter (where ${cmsDeliveryRuns.status} = 'failed' and ${cmsDeliveryRuns.completedAt} >= ${sql.param(since, cmsDeliveryRuns.completedAt)})::int`,
      succeeded24h: sql<number>`count(*) filter (where ${cmsDeliveryRuns.status} = 'passed' and ${cmsDeliveryRuns.completedAt} >= ${sql.param(since, cmsDeliveryRuns.completedAt)})::int`,
      failed1h: sql<number>`count(*) filter (where ${cmsDeliveryRuns.status} = 'failed' and ${cmsDeliveryRuns.completedAt} >= ${sql.param(hour, cmsDeliveryRuns.completedAt)})::int`,
    }).from(cmsDeliveryRuns).where(or(inArray(cmsDeliveryRuns.status, ['activated', 'cache_refreshing', 'checking']), gte(cmsDeliveryRuns.completedAt, since)));
  const media = await executor.select({ stuck: sql<number>`count(*) filter (where ${stuckCmsMediaCondition(now)})::int`,
      failed24h: sql<number>`count(*) filter (where ${cmsMediaProcessing.status} = 'failed' and ${cmsMediaProcessing.updatedAt} >= ${sql.param(since, cmsMediaProcessing.updatedAt)})::int`,
      succeeded24h: sql<number>`count(*) filter (where ${cmsMediaProcessing.status} = 'success' and ${cmsMediaProcessing.updatedAt} >= ${sql.param(since, cmsMediaProcessing.updatedAt)})::int`,
      failed1h: sql<number>`count(*) filter (where ${cmsMediaProcessing.status} = 'failed' and ${cmsMediaProcessing.updatedAt} >= ${sql.param(hour, cmsMediaProcessing.updatedAt)})::int`,
    }).from(cmsMediaProcessing).where(or(inArray(cmsMediaProcessing.status, ['pending', 'running']), gte(cmsMediaProcessing.updatedAt, since)));
  const entries = [
    { key: 'build', label: '发布版本构建', row: deployments[0] },
    { key: 'delivery', label: '缓存刷新与交付验证', row: deliveries[0] },
    { key: 'media', label: '媒体处理', row: media[0] },
  ];
  const breakdown: JobSourceBreakdown[] = entries.map(({ key, label, row }) => ({ key, label, pending: 0, running: 0, stuck: row?.stuck ?? 0, failed24h: row?.failed24h ?? 0, drillDown }));
  return {
    counts: { pending: 0, running: 0, stuck: breakdown.reduce((total, row) => total + row.stuck, 0), dead: null,
      failed24h: breakdown.reduce((total, row) => total + row.failed24h, 0), succeeded24h: (deliveries[0]?.succeeded24h ?? 0) + (media[0]?.succeeded24h ?? 0) },
    oldestPendingAgeSec: null, failed1h: entries.reduce((total, { row }) => total + (row?.failed1h ?? 0), 0), issues: [], breakdown,
    // Build successes do not have a durable completion timestamp; mixing subtype denominators would overstate failure rate.
    failureRate24h: null,
  };
  });
}

export async function listStuckCmsPipelineJobs(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const [deployments, deliveries, media] = await Promise.all([
    db.select({ id: cmsDeployments.id, siteId: cmsDeployments.siteId, createdAt: cmsDeployments.createdAt, updatedAt: cmsDeployments.updatedAt, error: cmsDeployments.error })
      .from(cmsDeployments).where(stuckCmsDeploymentCondition(now)).orderBy(asc(cmsDeployments.createdAt), asc(cmsDeployments.id)).limit(limit),
    db.select({ id: cmsDeliveryRuns.id, siteId: cmsDeliveryRuns.siteId, status: cmsDeliveryRuns.status, startedAt: cmsDeliveryRuns.startedAt, createdAt: cmsDeliveryRuns.createdAt, updatedAt: cmsDeliveryRuns.updatedAt, error: cmsDeliveryRuns.error })
      .from(cmsDeliveryRuns).where(stuckCmsDeliveryCondition(now)).orderBy(asc(cmsDeliveryRuns.createdAt), asc(cmsDeliveryRuns.id)).limit(limit),
    db.select({ id: cmsMediaProcessing.id, createdAt: cmsMediaProcessing.createdAt, updatedAt: cmsMediaProcessing.updatedAt, status: cmsMediaProcessing.status, errorMessage: cmsMediaProcessing.errorMessage })
      .from(cmsMediaProcessing).where(stuckCmsMediaCondition(now)).orderBy(asc(cmsMediaProcessing.updatedAt), asc(cmsMediaProcessing.id)).limit(limit),
  ]);
  const age = (at: Date) => Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  const items: JobStuckItem[] = [
    ...deployments.map(row => ({ source: 'cms-pipeline' as const, refId: `build:${row.id}`, title: `站点 #${row.siteId} / 发布版本构建 #${row.id}`, status: 'building',
      startedAt: formatDateTime(row.createdAt), lastSeenAt: formatDateTime(row.updatedAt), ageSec: age(row.createdAt), nodeId: null, detail: row.error ?? '所有关联构建任务均已结束或失联', drillDown })),
    ...deliveries.map(row => ({ source: 'cms-pipeline' as const, refId: `delivery:${row.id}`, title: `站点 #${row.siteId} / 交付验证 #${row.id}`, status: row.status,
      startedAt: formatNullableDateTime(row.startedAt), lastSeenAt: formatDateTime(row.updatedAt), ageSec: age(row.startedAt ?? row.createdAt), nodeId: null, detail: row.error ?? '缓存刷新仍待处理，关联任务已结束或失联', drillDown })),
    ...media.map(row => ({ source: 'cms-pipeline' as const, refId: `media:${row.id}`, title: `媒体处理 #${row.id}`, status: row.status,
      startedAt: formatDateTime(row.createdAt), lastSeenAt: formatDateTime(row.updatedAt), ageSec: age(row.updatedAt), nodeId: null, detail: row.errorMessage ?? '关联媒体处理任务已结束或失联', drillDown })),
  ];
  return items.sort((a, b) => b.ageSec - a.ageSec || a.refId.localeCompare(b.refId)).slice(0, limit);
}
