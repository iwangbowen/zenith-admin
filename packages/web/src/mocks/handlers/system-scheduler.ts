import { http, HttpResponse } from 'msw';
import type { SystemSchedulerNode, SystemSchedulerRun, SystemSchedulerTask } from '@zenith/shared';
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
    enabled: true,
    logRetentionDays: 30,
    logRetentionRuns: 1000,
    timeoutMs: null,
    failureAlertThreshold: 1,
    alertEnabled: true,
    alertChannels: ['inapp'],
    alertUserIds: [],
    alertEmails: [],
    alertWebhookUrl: null,
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
    name: 'workflow-schedule-tick',
    title: '工作流定时发起扫描',
    module: '工作流',
    description: '每分钟扫描到期的工作流定时发起规则，并推进下一次执行时间。',
    cronExpression: '* * * * *',
    allowManualRun: true,
    nextRunAt: mockDateTimeOffset(60 * 1000),
    lastRunAt: mockDateTimeOffset(-60 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '工作流定时发起扫描完成',
    lastDurationMs: 21,
    totalRuns: 240,
    successCount: 240,
  }),
  baseTask({
    name: 'workflow-jobs-drain',
    title: '工作流作业兜底扫描',
    module: '工作流',
    description: '每分钟兜底领取到期的工作流作业并回收卡死的运行中作业。',
    cronExpression: '* * * * *',
    allowManualRun: true,
    nextRunAt: mockDateTimeOffset(60 * 1000),
    lastRunAt: mockDateTimeOffset(-60 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '工作流作业兜底：恢复卡死 0，处理到期 4',
    lastDurationMs: 38,
    totalRuns: 240,
    successCount: 240,
  }),
  baseTask({
    name: 'workflow-engine-health-capture',
    title: '流程引擎健康采集',
    module: '工作流',
    description: '每 5 分钟采集平台级流程引擎健康快照，驱动健康趋势图与引擎健康告警指标。',
    cronExpression: '*/5 * * * *',
    allowManualRun: true,
    nextRunAt: mockDateTimeOffset(3 * 60 * 1000),
    lastRunAt: mockDateTimeOffset(-5 * 60 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '流程引擎健康快照已采集',
    lastDurationMs: 107,
    totalRuns: 48,
    successCount: 48,
  }),
  baseTask({
    name: 'workflow-jobs',
    title: '工作流作业 Worker',
    module: '工作流',
    description: '消费工作流统一作业队列，处理延时唤醒、超时、触发器、子流程和事件派发。',
    taskType: 'queue',
    cronExpression: null,
    allowManualRun: false,
    nextRunAt: null,
    lastRunAt: mockDateTimeOffset(-15 * 60 * 1000),
    lastRunStatus: 'success',
    lastRunMessage: '工作流作业执行完成',
    lastDurationMs: 62,
    totalRuns: 86,
    successCount: 84,
    failedCount: 2,
    queueQueuedCount: 3,
    queueActiveCount: 1,
    queueTotalCount: 4,
    queueCompletedCount: 84,
    queueStateCounts: { created: 3, active: 1, completed: 84, failed: 2 },
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

const nodes: SystemSchedulerNode[] = [
  {
    nodeId: 'dev-host:3001',
    hostname: 'dev-host',
    pid: 3001,
    version: '0.72.0',
    startedAt: mockDateTimeOffset(-6 * 3600 * 1000),
    lastHeartbeatAt: mockDateTimeOffset(-15 * 1000),
    registeredTaskCount: 7,
    runningJobCount: 1,
    active: true,
    stale: false,
    metadata: { wip: [{ name: 'workflow-jobs', count: 1 }] },
    createdAt: mockDateTimeOffset(-6 * 3600 * 1000),
    updatedAt: mockDateTimeOffset(-15 * 1000),
  },
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
    alertSentAt: null,
    alertChannels: [],
    alertAckAt: null,
    alertAckBy: null,
    alertAckByName: null,
    alertAckNote: null,
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
    taskName: 'workflow-jobs-drain',
    taskTitle: '工作流作业兜底扫描',
    module: '工作流',
    startedAt: mockDateTimeOffset(-60 * 1000),
    endedAt: mockDateTimeOffset(-60 * 1000 + 38),
    durationMs: 38,
    resultMessage: '工作流作业兜底：恢复卡死 0，处理到期 4',
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
    alertSentAt: mockDateTimeOffset(-20 * 60 * 1000 + 900),
    alertChannels: ['inapp'],
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
    const alertStatus = url.searchParams.get('alertStatus') ?? '';
    const startTime = url.searchParams.get('startTime') ?? '';
    const endTime = url.searchParams.get('endTime') ?? '';

    const filtered = runs
      .filter((item) => !taskName || item.taskName === taskName)
      .filter((item) => !taskType || item.taskType === taskType)
      .filter((item) => !triggerType || item.triggerType === triggerType)
      .filter((item) => !status || item.status === status)
      .filter((item) => alertStatus !== 'alerted' || !!item.alertMessage)
      .filter((item) => alertStatus !== 'unacked' || (!!item.alertMessage && !item.alertAckAt))
      .filter((item) => !startTime || item.startedAt >= startTime)
      .filter((item) => !endTime || item.startedAt <= endTime)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: filtered.length, page, pageSize } });
  }),

  http.get('/api/system-scheduler/runs/:id', ({ params }) => {
    const id = Number(params.id);
    const run = runs.find((item) => item.id === id);
    if (!run) return HttpResponse.json({ code: 404, message: '运行日志不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: run });
  }),

  http.post('/api/system-scheduler/runs/:id/ack-alert', ({ params }) => {
    const id = Number(params.id);
    const run = runs.find((item) => item.id === id);
    if (!run) return HttpResponse.json({ code: 404, message: '运行日志不存在', data: null });
    if (!run.alertMessage) return HttpResponse.json({ code: 400, message: '该运行日志没有告警', data: null });
    run.alertAckAt = mockDateTime();
    run.alertAckBy = 1;
    run.alertAckByName = '管理员';
    run.alertAckNote = null;
    return HttpResponse.json({ code: 0, message: 'ok', data: run });
  }),

  http.get('/api/system-scheduler/nodes', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const list = nodes.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: nodes.length, page, pageSize } });
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
    task.enabled = task.taskType === 'queue' ? true : Boolean(body.enabled);
    task.logRetentionDays = Number(body.logRetentionDays ?? task.logRetentionDays);
    task.logRetentionRuns = Number(body.logRetentionRuns ?? task.logRetentionRuns);
    task.timeoutMs = body.timeoutMs == null ? null : Number(body.timeoutMs);
    task.failureAlertThreshold = Number(body.failureAlertThreshold ?? task.failureAlertThreshold);
    task.alertEnabled = Boolean(body.alertEnabled);
    task.alertChannels = body.alertChannels ?? task.alertChannels;
    task.alertUserIds = body.alertUserIds ?? task.alertUserIds;
    task.alertEmails = body.alertEmails ?? task.alertEmails;
    task.alertWebhookUrl = body.alertWebhookUrl ?? task.alertWebhookUrl;
    task.manualSingleton = Boolean(body.manualSingleton);
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        taskName: task.name,
        enabled: task.enabled,
        logRetentionDays: task.logRetentionDays,
        logRetentionRuns: task.logRetentionRuns,
        timeoutMs: task.timeoutMs,
        failureAlertThreshold: task.failureAlertThreshold,
        alertEnabled: task.alertEnabled,
        alertChannels: task.alertChannels,
        alertUserIds: task.alertUserIds,
        alertEmails: task.alertEmails,
        alertWebhookUrl: task.alertWebhookUrl,
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
