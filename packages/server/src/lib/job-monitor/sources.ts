import { getSchedulerRunHealth, listOverdueSchedulerRuns } from '../../services/tasks/system-scheduler.service';
import { getAsyncTaskHealth, listStuckAsyncTasks } from '../../services/tasks/async-tasks.service';
import { getExportJobHealth, listStuckExportJobs } from '../../services/tasks/export-jobs.service';
import { getCronJobHealth, listStuckCronRuns } from '../../services/tasks/cron-jobs.service';
import { getWorkflowJobHealth, listStuckWorkflowJobs } from '../../services/workflow/workflow-jobs.service';
import { getNotificationOutboxHealth, listStuckOutbox } from '../../services/messaging/notification-outbox.service';
import { getWebhookDeliveryHealth } from '../../services/open-platform/app-webhooks.service';
import { getJobSource, registerJobSource } from './registry';

/** Called in every process role; repeated bootstrap calls do not duplicate declarations. */
export function registerJobSources() {
  const entries = [
    { key: 'scheduler-queue', title: '系统调度与队列', module: 'platform', order: 10, collect: getSchedulerRunHealth, listStuck: listOverdueSchedulerRuns, drillDown: { path: '/system/scheduler?tab=runs&status=running', label: '前往处理' } },
    { key: 'async-task', title: '异步任务（含导入）', module: 'tasks', order: 20, collect: getAsyncTaskHealth, listStuck: listStuckAsyncTasks, drillDown: { path: '/system/task-center?tab=tasks&status=failed', label: '前往处理' } },
    { key: 'export-job', title: '数据导出', module: 'tasks', order: 30, collect: getExportJobHealth, listStuck: listStuckExportJobs, drillDown: { path: '/system/export-jobs?status=failed', label: '前往处理' } },
    { key: 'cron-job', title: '自定义定时任务', module: 'platform', order: 40, collect: getCronJobHealth, listStuck: listStuckCronRuns, drillDown: { path: '/system/cron-jobs?tab=dashboard', label: '前往处理' } },
    { key: 'workflow-job', title: '工作流作业', module: 'workflow', order: 50, collect: getWorkflowJobHealth, listStuck: listStuckWorkflowJobs, drillDown: { path: '/workflow/monitor?tab=jobs&status=dead', label: '前往处理' } },
    { key: 'notification-outbox', title: '通知发件箱', module: 'messaging', order: 60, collect: getNotificationOutboxHealth, listStuck: listStuckOutbox },
    { key: 'webhook-delivery', title: '应用 Webhook 投递', module: 'open-platform', order: 70, collect: getWebhookDeliveryHealth, drillDown: { path: '/open-platform/webhooks', label: '前往处理' } },
  ] as const;
  for (const entry of entries) if (!getJobSource(entry.key)) registerJobSource(entry);
}
