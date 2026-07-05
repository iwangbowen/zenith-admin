import { registerSystemRecurringJob } from './pg-boss-scheduler';
import { cleanupSystemSchedulerRuns } from '../services/tasks/system-scheduler.service';

/**
 * 启动时注册的系统级周期任务入口。
 *
 * 新增系统后台任务时优先放在这里，页面会自动从 pg-boss-scheduler 的注册表读取。
 */
export async function registerSystemTasks(): Promise<void> {
  const { cleanupExpiredExportFiles } = await import('../services/tasks/export-jobs.service');
  await registerSystemRecurringJob({
    name: 'export-file-cleanup',
    title: '导出文件自动清理',
    module: '导出中心',
    cronExpression: '0 3 * * *',
    description: '每天清理已过期的导出文件，并把任务状态标记为 expired。',
    allowManualRun: true,
    run: async () => {
      const cleaned = await cleanupExpiredExportFiles();
      return `清理了 ${cleaned} 个过期导出文件`;
    },
  });

  await registerSystemRecurringJob({
    name: 'system-scheduler-log-cleanup',
    title: '系统调度日志清理',
    module: '系统调度',
    cronExpression: '15 3 * * *',
    description: '按任务策略清理系统调度运行日志，避免运行记录无限增长。',
    allowManualRun: true,
    logRetentionDays: 30,
    logRetentionRuns: 1000,
    run: cleanupSystemSchedulerRuns,
  });

  const { runDueWorkflowSchedules } = await import('../services/workflow/workflow-schedules.service');
  await registerSystemRecurringJob({
    name: 'workflow-schedule-tick',
    title: '工作流定时发起扫描',
    module: '工作流',
    cronExpression: '* * * * *',
    description: '每分钟扫描到期的工作流定时发起规则，并推进下一次执行时间。',
    allowManualRun: true,
    run: async () => {
      await runDueWorkflowSchedules();
      return '工作流定时发起扫描完成';
    },
  });

  const { registerWorkflowJobWorker, drainWorkflowJobs } = await import('./workflow-jobs');
  await registerWorkflowJobWorker();
  await registerSystemRecurringJob({
    name: 'workflow-jobs-drain',
    title: '工作流作业兜底扫描',
    module: '工作流',
    cronExpression: '* * * * *',
    description: '每分钟兜底领取到期的工作流作业并回收卡死的运行中作业（统一作业账本的崩溃恢复）。',
    allowManualRun: true,
    run: async () => {
      const r = await drainWorkflowJobs();
      return `工作流作业兜底：恢复卡死 ${r.recovered}，处理到期 ${r.processed}`;
    },
  });

  const { retryAppWebhookDeliveries } = await import('../services/open-platform/app-webhooks.service');
  await registerSystemRecurringJob({
    name: 'app-webhook-delivery-retry',
    title: '开放应用 Webhook 重试',
    module: '开放平台',
    cronExpression: '*/5 * * * *',
    description: '定期重试开放应用 Webhook 投递。',
    allowManualRun: true,
    run: retryAppWebhookDeliveries,
  });

  const { publishDueScheduledMessages } = await import('../services/messaging/channel.service');
  await registerSystemRecurringJob({
    name: 'channel-scheduled-publish',
    title: '频道定时消息发布',
    module: '消息渠道',
    cronExpression: '* * * * *',
    description: '每分钟发布到期的频道定时消息。',
    allowManualRun: true,
    run: async () => {
      await publishDueScheduledMessages();
      return '频道定时消息发布扫描完成';
    },
  });

  const { runMpKfSessionTimeouts } = await import('../services/mp/mp-kf-session.service');
  await registerSystemRecurringJob({
    name: 'mp-kf-session-tick',
    title: '公众号客服会话维护',
    module: '公众号',
    cronExpression: '* * * * *',
    description: '每分钟处理公众号客服会话超时、转接和自动关闭。',
    allowManualRun: true,
    run: runMpKfSessionTimeouts,
  });

  const { runDueMpBroadcasts } = await import('../services/mp/mp-broadcast.service');
  await registerSystemRecurringJob({
    name: 'mp-broadcast-tick',
    title: '公众号群发任务扫描',
    module: '公众号',
    cronExpression: '* * * * *',
    description: '每分钟扫描并发送到期的公众号群发任务。',
    allowManualRun: true,
    run: runDueMpBroadcasts,
  });

  const { runWorkflowEngineHealthCapture } = await import('../services/workflow/workflow-engine-ops.service');
  await registerSystemRecurringJob({
    name: 'workflow-engine-health-capture',
    title: '流程引擎健康采集',
    module: '工作流',
    cronExpression: '*/5 * * * *',
    description: '每 5 分钟采集平台级流程引擎健康快照，驱动健康趋势图与引擎健康告警指标，并清理超期快照。',
    allowManualRun: true,
    run: runWorkflowEngineHealthCapture,
  });

  const { registerAsyncTaskWorker, drainAsyncTasks, cleanupAsyncTasks } = await import('./task-center');  await registerAsyncTaskWorker();
  await registerSystemRecurringJob({
    name: 'async-tasks-drain',
    title: '异步任务兜底扫描',
    module: '任务中心',
    cronExpression: '* * * * *',
    description: '每分钟回收心跳超时的卡死任务（崩溃/重启恢复，从断点续跑），并重投长时间未被领取的待执行任务。',
    allowManualRun: true,
    run: async () => {
      const r = await drainAsyncTasks();
      return `异步任务兜底：回收卡死 ${r.recovered}，重投待执行 ${r.redispatched}`;
    },
  });
  await registerSystemRecurringJob({
    name: 'async-tasks-cleanup',
    title: '异步任务记录清理',
    module: '任务中心',
    cronExpression: '30 3 * * *',
    description: '每天清理超过 30 天保留期的已结束任务记录（成功/失败/已取消）。',
    allowManualRun: true,
    run: async () => {
      const cleaned = await cleanupAsyncTasks();
      return `清理了 ${cleaned} 条已结束任务记录`;
    },
  });

  const { runTenantExpiryCheck } = await import('../services/identity/tenant-lifecycle.service');
  await registerSystemRecurringJob({
    name: 'tenant-expiry-check',
    title: '租户到期巡检',
    module: '租户管理',
    cronExpression: '30 1 * * *',
    description: '每天自动停用已过期租户（并吊销其用户会话），到期前 7/3/1 天向租户管理员与平台超管发送站内信提醒。',
    allowManualRun: true,
    run: runTenantExpiryCheck,
  });
}
