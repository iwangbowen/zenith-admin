import type { JobMonitorOverview, JobSourceKey, JobSourceSummary, JobStuckItem } from '@zenith/shared/platform';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

function source(summary: Pick<JobSourceSummary, 'key' | 'title' | 'module' | 'drillDown'> & Partial<JobSourceSummary>): JobSourceSummary {
  return {
    health: 'ok', reason: null,
    counts: { pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 },
    oldestPendingAgeSec: null, failureRate24h: null, issues: [], supportsStuckList: true,
    ...summary,
  };
}

export function createDemoStuckJobs(key: JobSourceKey): JobStuckItem[] {
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
  ];
  return {
    health: 'critical', generatedAt: mockDateTime(),
    totals: { backlog: 21, running: 9, stuck: 1, dead: 2, failed24h: 8 },
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
