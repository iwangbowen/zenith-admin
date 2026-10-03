import { HTTPException } from 'hono/http-exception';
import { sumJobMonitorCounts } from '@zenith/shared/platform';
import type { JobMonitorOverview, JobSourceSummary, JobQueueRow, JobSourceKey } from '@zenith/shared/platform';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { section } from '../../lib/probe-section';
import { deriveOverallHealth, deriveSourceHealth } from '../../lib/job-monitor/health';
import { getJobSource, listJobSources, type JobSourceRegistration } from '../../lib/job-monitor/registry';
import { listSystemSchedulerNodes, listSystemSchedulerTasks } from '../tasks/system-scheduler.service';
import { getMonitorHistory } from './monitor-history.service';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { jobMonitorContract } from '@zenith/shared/platform';

export function requireJobMonitorPlatformUser() {
  if (currentUser().tenantId != null) throw new HTTPException(403, { message: '作业监控仅限平台用户访问' });
}

export async function collectJobSource(source: JobSourceRegistration): Promise<JobSourceSummary> {
  const result = await section(source.collect);
  const raw = result.data;
  const sample = raw ? raw.counts.failed24h + raw.counts.succeeded24h : 0;
  return {
    key: source.key, title: source.title, module: source.module,
    category: source.category ?? 'runtime', breakdown: raw?.breakdown,
    health: raw ? deriveSourceHealth(raw, source.thresholds) : 'unavailable', reason: result.reason,
    counts: raw?.counts ?? { pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 },
    oldestPendingAgeSec: raw?.oldestPendingAgeSec ?? null,
    failureRate24h: raw && sample > 0 ? raw.counts.failed24h / sample : null,
    issues: raw?.issues ?? [], drillDown: source.drillDown ?? null, supportsStuckList: source.listStuck != null,
  };
}

async function collectWorkers(): Promise<NonNullable<JobMonitorOverview['workers']['data']>> {
  const nodes: Awaited<ReturnType<typeof listSystemSchedulerNodes>>['list'] = [];
  let page = 1;
  let total: number;
  do {
    const result = await listSystemSchedulerNodes({ page, pageSize: 200 });
    nodes.push(...result.list);
    total = result.total;
    page++;
    if (result.list.length === 0) break;
  } while (nodes.length < total);
  const activeNodes = nodes.filter(n => n.active && !n.stale);
  return {
    total, active: activeNodes.length, stale: nodes.filter(n => n.stale).length,
    workerRoleActive: activeNodes.filter(n => n.roles.includes('worker')).length,
    nodes: nodes.map(({ nodeId, hostname, pid, roles, version, lastHeartbeatAt, runningJobCount, stale }) => ({ nodeId, hostname, pid, roles, version, lastHeartbeatAt, runningJobCount, stale })),
  };
}

async function collectQueues(): Promise<JobQueueRow[]> {
  const tasks = await listSystemSchedulerTasks();
  return tasks.filter(task => task.taskType === 'queue').map(task => ({
    name: task.name, title: task.title, module: task.module,
    queued: Math.max(0, task.queueQueuedCount - task.queueDeferredCount), active: task.queueActiveCount,
    deferred: task.queueDeferredCount, failed: task.queueFailedCount,
  })).sort((a, b) => b.queued - a.queued || b.deferred - a.deferred || a.name.localeCompare(b.name));
}

export async function getJobMonitorOverview(): Promise<JobMonitorOverview> {
  requireJobMonitorPlatformUser();
  const [workers, queues, sources] = await Promise.all([
    section(collectWorkers), section(collectQueues), Promise.all(listJobSources().map(collectJobSource)),
  ]);
  const totals = sumJobMonitorCounts(sources.map(source => ({ ...source, stuckOnly: getJobSource(source.key)?.totalsMode === 'stuck-only' })));
  return { health: deriveOverallHealth(sources, workers), generatedAt: formatDateTime(new Date()), totals, workers, queues, sources };
}

export async function listJobMonitorStuck(key: JobSourceKey, limit: number) {
  requireJobMonitorPlatformUser();
  const source = getJobSource(key);
  if (!source?.listStuck) throw new HTTPException(400, { message: '该作业源不支持卡死明细' });
  return source.listStuck(limit);
}

export async function getJobMonitorTrend(range: QueryOutputOf<typeof jobMonitorContract.trend>['range']) {
  requireJobMonitorPlatformUser();
  const history = await getMonitorHistory(range);
  return { points: history.points.map(point => ({ time: point.t, backlog: point.jobsBacklog, stuck: point.jobsStuck, dead: point.jobsDead, failed1h: point.jobsFailed1h })) };
}
