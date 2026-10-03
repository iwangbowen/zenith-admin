import { MONITOR_HISTORY_RANGE_CONFIG, type JobMonitorOverview, type JobMonitorTrend, type JobMonitorTrendRange, type JobSourceKey, type JobSourceSummary, type JobStuckItem } from '@zenith/shared/platform';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { sumJobMonitorCounts } from '@zenith/shared/platform';
import { mockDirectorySyncRuns } from './directory-sync';
import { mockBackups } from './db-admin-backups';
import { isDirectorySyncRunStuck, isDbBackupStuck } from '@/utils/stuck-jobs';
import { parseDateTimeParam } from '@/utils/date';

const ageSec = (value: string | null) => Math.max(0, Math.floor((Date.now() - (parseDateTimeParam(value)?.getTime() ?? Date.now())) / 1000));

function source(summary: Pick<JobSourceSummary, 'key' | 'title' | 'module' | 'drillDown'> & Partial<JobSourceSummary>): JobSourceSummary {
  return {
    health: 'ok', reason: null, category: 'runtime',
    counts: { pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 },
    oldestPendingAgeSec: null, failureRate24h: null, issues: [], supportsStuckList: true,
    ...summary,
  };
}

export function createDemoStuckJobs(key: JobSourceKey): JobStuckItem[] {
  if (key === 'directory-sync') return mockDirectorySyncRuns.filter(run => isDirectorySyncRunStuck(run)).map(run => ({
    source: key, refId: String(run.id), title: run.sourceName ?? '目录同步', status: run.status, startedAt: run.startedAt,
    lastSeenAt: run.startedAt, ageSec: ageSec(run.startedAt), nodeId: null, detail: run.errorMessage,
    drillDown: { path: '/system/directory-sync/logs?status=running', label: '前往处理' },
  }));
  if (key === 'db-backup') return mockBackups.filter(run => isDbBackupStuck(run)).map(run => ({
    source: key, refId: String(run.id), title: run.name, status: run.status, startedAt: run.startedAt,
    lastSeenAt: run.updatedAt, ageSec: ageSec(run.startedAt ?? run.createdAt), nodeId: null, detail: run.errorMessage,
    drillDown: { path: `/system/db-admin?tab=backups&status=${run.status}`, label: '前往处理' },
  }));
  if (key === 'notification-outbox') return [{
    source: key, refId: 'outbox-91', title: '审批提醒派发', status: 'claimed', startedAt: mockDateTimeOffset(-600000),
    lastSeenAt: mockDateTimeOffset(-600000), ageSec: 600, nodeId: 'demo-worker-2', detail: '领取后超过两倍回收窗口仍未完成', drillDown: null,
  }];
  return key === 'async-task' ? [{
    source: key, refId: '731', title: '历史数据导入', status: 'running',
    startedAt: mockDateTimeOffset(-1200000), lastSeenAt: mockDateTimeOffset(-900000), ageSec: 1200,
    nodeId: 'demo-worker-2', detail: '超过心跳回收窗口，等待任务中心回收',
    drillDown: { path: '/system/task-center?tab=tasks&status=running&taskId=731', label: '前往处理' },
  }] : [];
}

export function createDemoJobMonitorOverview(): JobMonitorOverview {
  const sources = [
    source({ key: 'scheduler-queue', title: '系统调度队列', module: 'platform',
      counts: { pending: 12, running: 2, stuck: 0, dead: 0, failed24h: 1, succeeded24h: 99 }, oldestPendingAgeSec: 120, failureRate24h: 0.01,
      drillDown: { path: '/system/scheduler?tab=runs&status=running', label: '前往处理' } }),
    source({ key: 'async-task', title: '异步任务', module: 'platform', health: 'critical',
      counts: { pending: 4, running: 3, stuck: 1, dead: null, failed24h: 3, succeeded24h: 57 }, oldestPendingAgeSec: 80, failureRate24h: 0.05,
      issues: [{ level: 'critical', message: '1 个运行中任务超过心跳回收窗口仍未推进' }],
      drillDown: { path: '/system/task-center?tab=tasks&status=failed', label: '前往处理' } }),
    source({ key: 'export-job', title: '导出作业', module: 'platform',
      counts: { pending: 2, running: 1, stuck: 0, dead: null, failed24h: 0, succeeded24h: 18 }, oldestPendingAgeSec: 30, failureRate24h: 0,
      drillDown: { path: '/system/export-jobs?status=failed', label: '前往处理' } }),
    source({ key: 'cron-job', title: '定时任务', module: 'platform',
      counts: { pending: 0, running: 1, stuck: 0, dead: null, failed24h: 0, succeeded24h: 120 },
      failureRate24h: 0, drillDown: { path: '/system/cron-jobs?tab=dashboard', label: '前往处理' } }),
    source({ key: 'workflow-job', title: '流程作业', module: 'workflow', health: 'warn',
      counts: { pending: 3, running: 2, stuck: 0, dead: 2, failed24h: 4, succeeded24h: 196 }, oldestPendingAgeSec: 200, failureRate24h: 0.02,
      issues: [{ level: 'warn', message: '存在 2 个死信作业，请前往流程监控处理' }],
      drillDown: { path: '/workflow/monitor?tab=jobs&status=dead', label: '前往处理' } }),
    source({ key: 'notification-outbox', title: '通知派发 Outbox', category: 'delivery', module: 'messaging', health: 'unavailable', reason: '通知派发探测超时', drillDown: null }),
    source({ key: 'webhook-delivery', title: 'Webhook 投递', category: 'delivery', module: 'open-platform',
      counts: { pending: 2, running: 0, stuck: 0, dead: null, failed24h: 1, succeeded24h: 19 }, oldestPendingAgeSec: 45, failureRate24h: 0.05,
      supportsStuckList: false, drillDown: { path: '/open-platform/webhooks', label: '前往处理' } }),
    source({ key: 'directory-sync', title: '目录同步', module: 'identity', drillDown: { path: '/system/directory-sync/logs?status=running', label: '前往处理' } }),
    source({ key: 'db-backup', title: '数据库备份', module: 'ops', drillDown: { path: '/system/db-admin?tab=backups', label: '前往处理' } }),
    source({ key: 'entity-watch-delivery', title: '对象关注通知', category: 'delivery', module: 'platform', drillDown: null }),
    source({ key: 'cms-telemetry-outbox', title: 'CMS 转化事件投递', category: 'delivery', module: 'cms', drillDown: null }),
    source({ key: 'payment-event-outbox', title: '支付事件派发', category: 'delivery', module: 'payment', drillDown: { path: '/payment/events?status=failed', label: '前往处理' } }),
    source({ key: 'drive-rendition', title: '网盘渲染', category: 'delivery', module: 'drive', drillDown: null }),
  ];
  sources.find(item => item.key === 'async-task')!.breakdown = Array.from({ length: 6 }, (_, index) => ({
    key: `demo-type-${index}`, label: `演示任务类型 ${index + 1}`, pending: index === 0 ? 4 : 0,
    running: index === 0 ? 3 : 0, stuck: index === 0 ? 1 : 0, failed24h: index === 0 ? 3 : 0,
    drillDown: { path: `/system/task-center?tab=tasks&taskType=demo-type-${index}`, label: '查看任务' },
  }));
  const directory = sources.find(item => item.key === 'directory-sync')!;
  directory.counts.running = mockDirectorySyncRuns.filter(run => run.status === 'running').length;
  directory.counts.stuck = createDemoStuckJobs('directory-sync').length;
  directory.counts.failed24h = mockDirectorySyncRuns.filter(run => run.status === 'failed' && run.finishedAt && ageSec(run.finishedAt) < 86400).length;
  directory.health = directory.counts.stuck > 0 ? 'critical' : directory.counts.failed24h > 0 ? 'warn' : 'ok';
  const backup = sources.find(item => item.key === 'db-backup')!;
  backup.counts.pending = mockBackups.filter(run => run.status === 'pending').length;
  backup.counts.running = mockBackups.filter(run => run.status === 'running').length;
  backup.counts.stuck = createDemoStuckJobs('db-backup').length;
  backup.counts.failed24h = mockBackups.filter(run => run.status === 'failed' && run.completedAt && ageSec(run.completedAt) < 86400).length;
  backup.health = backup.counts.stuck > 0 ? 'critical' : backup.counts.failed24h > 0 ? 'warn' : 'ok';
  backup.oldestPendingAgeSec = mockBackups.filter(run => run.status === 'pending').reduce<number | null>((oldest, run) => Math.max(oldest ?? 0, ageSec(run.createdAt)), null);
  return {
    health: 'critical', generatedAt: mockDateTime(),
    totals: sumJobMonitorCounts(sources.map(item => ({ ...item, stuckOnly: item.key === 'drive-rendition' || item.category === 'business' }))),
    workers: { available: true, reason: null, data: {
      total: 3, active: 2, stale: 1, workerRoleActive: 1,
      nodes: [
        { nodeId: 'demo-worker-1', hostname: 'worker-primary', pid: 1420, roles: ['worker'], version: '2.63.0', lastHeartbeatAt: mockDateTimeOffset(-5000), runningJobCount: 7, stale: false },
        { nodeId: 'demo-api-1', hostname: 'api-primary', pid: 1410, roles: ['api'], version: '2.63.0', lastHeartbeatAt: mockDateTimeOffset(-8000), runningJobCount: 0, stale: false },
        { nodeId: 'demo-worker-2', hostname: 'worker-secondary', pid: 1430, roles: ['worker'], version: '2.63.0', lastHeartbeatAt: mockDateTimeOffset(-240000), runningJobCount: 2, stale: true },
      ],
    } },
    queues: { available: true, reason: null, data: [
      { name: 'async-tasks', title: '异步任务执行', module: 'platform', queued: 12, active: 7, deferred: 3, failed: 1 },
      { name: 'workflow-jobs', title: '流程作业执行', module: 'workflow', queued: 3, active: 2, deferred: 5, failed: 2 },
      { name: 'export-jobs', title: '导出执行', module: 'platform', queued: 2, active: 1, deferred: 0, failed: 0 },
    ] },
    sources,
  };
}

export function createDemoJobMonitorTrend(range: JobMonitorTrendRange): JobMonitorTrend {
  const { windowSec, bucketSec } = MONITOR_HISTORY_RANGE_CONFIG[range];
  const count = Math.min(120, Math.floor(windowSec / bucketSec));
  const step = windowSec * 1000 / count;
  return { points: Array.from({ length: count }, (_, index) => ({
    time: mockDateTimeOffset(-(count - 1 - index) * step),
    backlog: index === 10 ? null : Math.max(0, Math.round(22 + Math.sin(index / 6) * 14)),
    stuck: index === 10 ? null : (index > count / 2 ? 1 : 0),
    dead: index === 10 ? null : (index > count / 3 ? 2 : 0),
    failed1h: index === 10 ? null : Math.max(0, Math.round(2 + Math.cos(index / 10) * 2)),
  })) };
}
