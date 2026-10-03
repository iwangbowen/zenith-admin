import { getSchedulerRunHealth, listOverdueSchedulerRuns } from '../../services/tasks/system-scheduler.service';
import { getAsyncTaskHealth, listStuckAsyncTasks } from '../../services/tasks/async-tasks.service';
import { getExportJobHealth, listStuckExportJobs } from '../../services/tasks/export-jobs.service';
import { getCronJobHealth, listStuckCronRuns } from '../../services/tasks/cron-jobs.service';
import { getWorkflowJobHealth, listStuckWorkflowJobs } from '../../services/workflow/workflow-jobs.service';
import { getNotificationOutboxHealth, listStuckOutbox } from '../../services/messaging/notification-outbox.service';
import { getWebhookDeliveryHealth } from '../../services/open-platform/app-webhooks.service';
import { getDirectorySyncHealth, listStuckDirectorySyncRuns } from '../../services/identity/directory-sync.service';
import { getDbBackupHealth, listStuckDbBackups } from '../../services/ops/db-admin-backups.service';
import { getEntityWatchDeliveryHealth, listStuckEntityWatchEvents } from '../../services/platform/entity-watch-worker';
import { getCmsTelemetryOutboxHealth, listStuckCmsTelemetryOutbox } from '../../services/cms/cms-telemetry-deliveries.service';
import { getPaymentEventHealth, listStuckPaymentEvents } from '../../services/payment/payment-events.service';
import { getDriveRenditionHealth, listStuckDriveRenditions } from '../../services/drive/drive-renditions.service';
import { getDeployRunHealth, listStuckDeployRuns } from '../../services/ops/deploy-job-monitor.service';
import { getBroadcastHealth, listStuckBroadcasts } from '../../services/messaging/broadcast-job-monitor.service';
import { getCmsPipelineHealth, listStuckCmsPipelineJobs } from '../../services/cms/cms-pipeline-job-monitor.service';
import { getReportDeliveryHealth, listStuckReportDeliveryRuns } from '../../services/report/report-delivery.service';
import { getReportDqHealth, listStuckReportDqRuns } from '../../services/report/report-dq.service';
import { getPaymentReconHealth, listStuckPaymentReconRuns } from '../../services/payment/payment-recon-job-monitor.service';
import { getJobSource, registerJobSource } from './registry';

/** Called in every process role; repeated bootstrap calls do not duplicate declarations. */
export function registerJobSources() {
  const entries = [
    { key: 'scheduler-queue', title: '系统调度与队列', module: 'platform', order: 10, collect: getSchedulerRunHealth, listStuck: listOverdueSchedulerRuns, drillDown: { path: '/system/scheduler?tab=runs&status=running', label: '前往处理' } },
    { key: 'async-task', title: '异步任务（含导入）', module: 'tasks', order: 20, collect: getAsyncTaskHealth, listStuck: listStuckAsyncTasks, drillDown: { path: '/system/task-center?tab=tasks&status=failed', label: '前往处理' } },
    { key: 'export-job', title: '数据导出', module: 'tasks', order: 30, collect: getExportJobHealth, listStuck: listStuckExportJobs, drillDown: { path: '/system/export-jobs?status=failed', label: '前往处理' } },
    { key: 'cron-job', title: '自定义定时任务', module: 'platform', order: 40, collect: getCronJobHealth, listStuck: listStuckCronRuns, drillDown: { path: '/system/cron-jobs?tab=dashboard', label: '前往处理' } },
    { key: 'workflow-job', title: '工作流作业', module: 'workflow', order: 50, collect: getWorkflowJobHealth, listStuck: listStuckWorkflowJobs, drillDown: { path: '/workflow/monitor?tab=jobs&status=dead', label: '前往处理' } },
    { key: 'notification-outbox', category: 'delivery', title: '通知发件箱', module: 'messaging', order: 60, collect: getNotificationOutboxHealth, listStuck: listStuckOutbox },
    { key: 'webhook-delivery', category: 'delivery', title: '应用 Webhook 投递', module: 'open-platform', order: 70, collect: getWebhookDeliveryHealth, drillDown: { path: '/open-platform/webhooks', label: '前往处理' } },
    { key: 'directory-sync', title: '目录同步', module: 'identity', order: 80, collect: getDirectorySyncHealth, listStuck: listStuckDirectorySyncRuns, drillDown: { path: '/system/directory-sync/logs?status=running', label: '前往处理' } },
    { key: 'db-backup', title: '数据库备份', module: 'ops', order: 90, collect: getDbBackupHealth, listStuck: listStuckDbBackups, drillDown: { path: '/system/db-admin?tab=backups', label: '前往处理' } },
    { key: 'entity-watch-delivery', category: 'delivery', title: '对象关注通知', module: 'platform', order: 100, collect: getEntityWatchDeliveryHealth, listStuck: listStuckEntityWatchEvents },
    { key: 'cms-telemetry-outbox', category: 'delivery', title: 'CMS 转化事件投递', module: 'cms', order: 110, collect: getCmsTelemetryOutboxHealth, listStuck: listStuckCmsTelemetryOutbox },
    { key: 'payment-event-outbox', category: 'delivery', title: '支付事件派发', module: 'payment', order: 120, collect: getPaymentEventHealth, listStuck: listStuckPaymentEvents, drillDown: { path: '/payment/events?status=failed', label: '前往处理' } },
    { key: 'drive-rendition', category: 'delivery', totalsMode: 'stuck-only', title: '网盘渲染', module: 'drive', order: 130, collect: getDriveRenditionHealth, listStuck: listStuckDriveRenditions },
    { key: 'report-delivery', category: 'business', totalsMode: 'stuck-only', title: '报表投递', module: 'report', order: 140, collect: getReportDeliveryHealth, listStuck: listStuckReportDeliveryRuns, drillDown: { path: '/report/subscriptions?tab=runs&status=failed', label: '前往处理' } },
    { key: 'report-dq', category: 'business', totalsMode: 'stuck-only', title: '报表数据质量', module: 'report', order: 150, collect: getReportDqHealth, listStuck: listStuckReportDqRuns, drillDown: { path: '/report/quality?tab=runs&status=failed', label: '前往处理' } },
    { key: 'payment-recon', category: 'business', totalsMode: 'stuck-only', title: '支付对账', module: 'payment', order: 160, collect: getPaymentReconHealth, listStuck: listStuckPaymentReconRuns, drillDown: { path: '/payment/recon', label: '前往处理' } },
    { key: 'deploy-run', category: 'business', totalsMode: 'stuck-only', title: '应用部署', module: 'ops', order: 170, collect: getDeployRunHealth, listStuck: listStuckDeployRuns, drillDown: { path: '/system/deploy?tab=records&status=running', label: '前往处理' } },
    { key: 'broadcast', category: 'business', totalsMode: 'stuck-only', title: '运营群发', module: 'messaging', order: 180, collect: getBroadcastHealth, listStuck: listStuckBroadcasts, drillDown: { path: '/system/broadcasts?status=sending', label: '前往处理' } },
    { key: 'cms-pipeline', category: 'business', totalsMode: 'stuck-only', title: 'CMS 构建与发布', module: 'cms', order: 190, collect: getCmsPipelineHealth, listStuck: listStuckCmsPipelineJobs, drillDown: { path: '/cms/publishing', label: '前往处理' } },
  ] as const;
  for (const entry of entries) if (!getJobSource(entry.key)) registerJobSource(entry);
}
