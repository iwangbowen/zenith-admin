import { registerSystemRecurringJob } from './pg-boss-scheduler';
import { cleanupSystemSchedulerRuns } from '../services/system-scheduler.service';

/**
 * 启动时注册的系统级周期任务入口。
 *
 * 新增系统后台任务时优先放在这里，页面会自动从 pg-boss-scheduler 的注册表读取。
 */
export async function registerSystemTasks(): Promise<void> {
  const { cleanupExpiredExportFiles } = await import('../services/export-jobs.service');
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

  const { runDueWorkflowSchedules } = await import('../services/workflow-schedules.service');
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

  const { retryWorkflowEventDeliveries } = await import('./workflow-subscribers/webhook');
  await registerSystemRecurringJob({
    name: 'workflow-event-delivery-retry',
    title: '工作流事件投递重试',
    module: '工作流',
    cronExpression: '*/5 * * * *',
    description: '定期重试工作流 Webhook 事件投递。',
    allowManualRun: true,
    run: retryWorkflowEventDeliveries,
  });

  const { retryAppWebhookDeliveries } = await import('../services/app-webhooks.service');
  await registerSystemRecurringJob({
    name: 'app-webhook-delivery-retry',
    title: '开放应用 Webhook 重试',
    module: '开放平台',
    cronExpression: '*/5 * * * *',
    description: '定期重试开放应用 Webhook 投递。',
    allowManualRun: true,
    run: retryAppWebhookDeliveries,
  });

  const { replayWorkflowEventOutbox } = await import('./workflow-event-bus');
  await registerSystemRecurringJob({
    name: 'workflow-event-outbox-replay',
    title: '工作流事件 Outbox 重放',
    module: '工作流',
    cronExpression: '* * * * *',
    description: '每分钟重放待处理的工作流事件 Outbox，保证事件最终投递。',
    allowManualRun: true,
    run: replayWorkflowEventOutbox,
  });

  const { recoverDueDelayTasks } = await import('../services/workflow-resume.service');
  await registerSystemRecurringJob({
    name: 'workflow-delay-recovery',
    title: '工作流延时任务恢复',
    module: '工作流',
    cronExpression: '* * * * *',
    description: '兜底扫描已到期的 delay 节点任务并恢复执行。',
    allowManualRun: true,
    run: recoverDueDelayTasks,
  });

  const { publishDueScheduledMessages } = await import('../services/channel.service');
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

  const { runMpKfSessionTimeouts } = await import('../services/mp-kf-session.service');
  await registerSystemRecurringJob({
    name: 'mp-kf-session-tick',
    title: '公众号客服会话维护',
    module: '公众号',
    cronExpression: '* * * * *',
    description: '每分钟处理公众号客服会话超时、转接和自动关闭。',
    allowManualRun: true,
    run: runMpKfSessionTimeouts,
  });

  const { runDueMpBroadcasts } = await import('../services/mp-broadcast.service');
  await registerSystemRecurringJob({
    name: 'mp-broadcast-tick',
    title: '公众号群发任务扫描',
    module: '公众号',
    cronExpression: '* * * * *',
    description: '每分钟扫描并发送到期的公众号群发任务。',
    allowManualRun: true,
    run: runDueMpBroadcasts,
  });
}
