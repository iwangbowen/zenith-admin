import { http, HttpResponse } from 'msw';
import type { SystemSchedulerRun, SystemSchedulerTask } from '@zenith/shared';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

function baseTask(extra: Partial<SystemSchedulerTask>): SystemSchedulerTask {
  return {
    name: '',
    title: '',
    module: '系统',
    description: null,
    taskType: 'recurring',
    cronExpression: '* * * * *',
    registeredAt: mockDateTimeOffset(-6 * 3600 * 1000),
    registeredNodeId: 'dev-host:3001',
    registeredHostname: 'dev-host',
    registeredPid: 3001,
    allowManualRun: false,
    logRetentionDays: 30,
    logRetentionRuns: 1000,
    timeoutMs: null,
    failureAlertThreshold: 1,
    alertEnabled: true,
    manualSingleton: true,
    nextRunAt: null,
    running: false,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    lastDurationMs: null,
    totalRuns: 0,
    successCount: 0,
    failedCount: 0,
    alertCount: 0,
    lastAlertAt: null,
    lastAlertMessage: null,
    queueQueuedCount: 0,
    queueActiveCount: 0,
    queueDeferredCount: 0,
    queueTotalCount: 0,
    queueFailedCount: 0,
    queueCompletedCount: 0,
    queueStateCounts: {},
    ...extra,
  };
}

const tasks: SystemSchedulerTask[] = [
  baseTask({
    name: 'export-file-cleanup',
    title: '导出文件自动清理',
    module: '导出中心',
    description: '每天清理已过期的导出文件，并把任务状态标记为 expired。',
    cronExpression: '0 3 * * *',
    allowManualRun: true,
    nextRunAt: '2026-06-28 03:00:00',
    lastRunAt: mockDateTimeOffset(-2 * 3600 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '清理了 2 个过期导出文件',
    lastDurationMs: 842,
    totalRuns: 12,
    successCount: 12,
  }),
  baseTask({
    name: 'system-scheduler-log-cleanup',
    title: '系统调度日志清理',
    module: '系统调度',
    description: '按任务策略清理系统调度运行日志。',
    cronExpression: '15 3 * * *',
    allowManualRun: true,
    nextRunAt: '2026-06-28 03:15:00',
    lastRunAt: mockDateTimeOffset(-24 * 3600 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '清理完成：按时间删除 5 条，按数量删除 0 条',
    lastDurationMs: 220,
    totalRuns: 3,
    successCount: 3,
  }),
  baseTask({
    name: 'workflow-delay-recovery',
    title: '工作流延时任务恢复',
    module: '工作流',
    description: '兜底扫描已到期的 delay 节点任务并恢复执行。',
    cronExpression: '* * * * *',
    allowManualRun: true,
    nextRunAt: mockDateTimeOffset(60 * 1000),
    lastRunAt: mockDateTimeOffset(-60 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '{"scanned":0,"resumed":0,"skipped":0,"failed":0}',
    lastDurationMs: 38,
    totalRuns: 240,
    successCount: 240,
  }),
  baseTask({
    name: 'export-jobs',
    title: '导出任务执行 Worker',
    module: '导出中心',
    description: '消费异步导出任务队列，生成 Excel/CSV 文件并更新导出中心任务状态。',
    taskType: 'queue',
    cronExpression: null,
    allowManualRun: false,
    nextRunAt: null,
    lastRunAt: mockDateTimeOffset(-30 * 60 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '导出任务 18 执行完成',
    lastDurationMs: 2350,
    totalRuns: 18,
    successCount: 17,
    failedCount: 1,
    queueQueuedCount: 2,
    queueActiveCount: 1,
    queueTotalCount: 3,
    queueCompletedCount: 18,
    queueStateCounts: { created: 2, active: 1, completed: 18 },
  }),
];

let nextRunId = 5;

function baseRun(extra: Partial<SystemSchedulerRun>): SystemSchedulerRun {
  return {
    id: 0,
    taskName: '',
    taskTitle: '',
    taskType: 'recurring',
    module: '系统',
    triggerType: 'schedule',
    status: 'success',
    jobId: null,
    nodeId: 'dev-host:3001',
    nodeHostname: 'dev-host',
    nodePid: 3001,
    triggeredBy: null,
    startedAt: mockDateTime(),
    endedAt: mockDateTime(),
    durationMs: 0,
    resultMessage: null,
    errorMessage: null,
    alertedAt: null,
    alertMessage: null,
    createdAt: mockDateTime(),
    ...extra,
  };
}

const runs: SystemSchedulerRun[] = [
  baseRun({
    id: 1,
    taskName: 'export-file-cleanup',
    taskTitle: '导出文件自动清理',
    module: '导出中心',
    startedAt: mockDateTimeOffset(-2 * 3600 * 1000),
    endedAt: mockDateTimeOffset(-2 * 3600 * 1000 + 842),
    durationMs: 842,
    resultMessage: '清理了 2 个过期导出文件',
    createdAt: mockDateTimeOffset(-2 * 3600 * 1000),
  }),
  baseRun({
    id: 2,
    taskName: 'workflow-delay-recovery',
    taskTitle: '工作流延时任务恢复',
    module: '工作流',
    startedAt: mockDateTimeOffset(-60 * 1000),
    endedAt: mockDateTimeOffset(-60 * 1000 + 38),
    durationMs: 38,
    resultMessage: '{"scanned":0,"resumed":0,"skipped":0,"failed":0}',
    createdAt: mockDateTimeOffset(-60 * 1000),
  }),
  baseRun({
    id: 3,
    taskName: 'export-jobs',
    taskTitle: '导出任务执行 Worker',
    taskType: 'queue',
    module: '导出中心',
    triggerType: 'queue',
    jobId: 'mock-job-18',
    startedAt: mockDateTimeOffset(-30 * 60 * 1000),
    endedAt: mockDateTimeOffset(-30 * 60 * 1000 + 2350),
    durationMs: 2350,
    resultMessage: '导出任务 18 执行完成',
    createdAt: mockDateTimeOffset(-30 * 60 * 1000),
  }),
  baseRun({
    id: 4,
    taskName: 'export-jobs',
    taskTitle: '导出任务执行 Worker',
    taskType: 'queue',
    module: '导出中心',
    triggerType: 'queue',
    status: 'failed',
    jobId: 'mock-job-19',
    startedAt: mockDateTimeOffset(-20 * 60 * 1000),
    endedAt: mockDateTimeOffset(-20 * 60 * 1000 + 900),
    durationMs: 900,
    errorMessage: '导出文件写入失败',
    alertedAt: mockDateTimeOffset(-20 * 60 * 1000 + 900),
    alertMessage: '连续失败 1 次：导出文件写入失败',
    createdAt: mockDateTimeOffset(-20 * 60 * 1000),
  }),
];

export const systemSchedulerHandlers = [
  http.get('/api/system-scheduler/tasks', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: tasks });
  }),

  http.get('/api/system-scheduler/runs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const taskName = url.searchParams.get('taskName') ?? '';
    const taskType = url.searchParams.get('taskType') ?? '';
    const triggerType = url.searchParams.get('triggerType') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const startTime = url.searchParams.get('startTime') ?? '';
    const endTime = url.searchParams.get('endTime') ?? '';

    const filtered = runs
      .filter((item) => !taskName || item.taskName === taskName)
      .filter((item) => !taskType || item.taskType === taskType)
      .filter((item) => !triggerType || item.triggerType === triggerType)
      .filter((item) => !status || item.status === status)
      .filter((item) => !startTime || item.startedAt >= startTime)
      .filter((item) => !endTime || item.startedAt <= endTime)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: filtered.length, page, pageSize } });
  }),

  http.post('/api/system-scheduler/tasks/:name/run', ({ params }) => {
    const name = String(params.name);
    const task = tasks.find((item) => item.name === name);
    if (!task) return HttpResponse.json({ code: 404, message: '系统周期任务不存在或尚未注册', data: null });
    if (!task.allowManualRun) return HttpResponse.json({ code: 400, message: '该系统周期任务不允许手动执行', data: null });
    if (task.running && task.manualSingleton) return HttpResponse.json({ code: 400, message: '该系统周期任务已有运行中的实例，请稍后再试', data: null });

    const startedAt = mockDateTime();
    const runId = nextRunId++;
    runs.unshift(baseRun({
      id: runId,
      taskName: task.name,
      taskTitle: task.title,
      taskType: task.taskType,
      module: task.module,
      triggerType: 'manual',
      status: 'running',
      jobId: `mock-manual-${runId}`,
      triggeredBy: 1,
      startedAt,
      endedAt: null,
      durationMs: null,
      resultMessage: '手动执行已投递，等待后台 worker 处理',
      createdAt: startedAt,
    }));
    task.running = true;
    task.lastRunAt = startedAt;
    task.lastRunStatus = 'running';
    task.lastRunMessage = '手动执行已投递，等待后台 worker 处理';
    task.lastDurationMs = null;
    task.totalRuns += 1;
    return HttpResponse.json({ code: 0, message: '执行完成', data: { message: `任务已投递后台执行，运行日志 #${runId} 可跟踪结果`, runId, jobId: `mock-manual-${runId}` } });
  }),

  http.put('/api/system-scheduler/tasks/:name/config', async ({ params, request }) => {
    const name = String(params.name);
    const task = tasks.find((item) => item.name === name);
    if (!task) return HttpResponse.json({ code: 404, message: '系统调度任务不存在或尚未注册', data: null });
    const body = await request.json() as Partial<SystemSchedulerTask>;
    task.logRetentionDays = Number(body.logRetentionDays ?? task.logRetentionDays);
    task.logRetentionRuns = Number(body.logRetentionRuns ?? task.logRetentionRuns);
    task.timeoutMs = body.timeoutMs == null ? null : Number(body.timeoutMs);
    task.failureAlertThreshold = Number(body.failureAlertThreshold ?? task.failureAlertThreshold);
    task.alertEnabled = Boolean(body.alertEnabled);
    task.manualSingleton = Boolean(body.manualSingleton);
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        taskName: task.name,
        logRetentionDays: task.logRetentionDays,
        logRetentionRuns: task.logRetentionRuns,
        timeoutMs: task.timeoutMs,
        failureAlertThreshold: task.failureAlertThreshold,
        alertEnabled: task.alertEnabled,
        manualSingleton: task.manualSingleton,
      },
    });
  }),

  http.post('/api/system-scheduler/runs/cleanup', ({ request }) => {
    const url = new URL(request.url);
    const taskName = url.searchParams.get('taskName') ?? '';
    const before = runs.length;
    if (taskName) {
      const keep = runs.filter((item) => item.taskName === taskName).slice(0, 10);
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        if (runs[i].taskName === taskName && !keep.includes(runs[i])) runs.splice(i, 1);
      }
    }
    return HttpResponse.json({
      code: 0,
      message: '清理完成',
      data: {
        message: `清理完成：按时间删除 ${before - runs.length} 条，按数量删除 0 条`,
        deletedByAge: before - runs.length,
        deletedByCount: 0,
        totalBefore: before,
        totalAfter: runs.length,
      },
    });
  }),
];
