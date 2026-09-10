/**
 * 后台 worker / 任务处理器注册。
 *
 * 从 src/index.ts 抽出：这些注册依赖 pg-boss 调度器，与 HTTP 应用装配无关，
 * 且整块包在 try/catch 中——任一处失败只降级后台能力，不影响已启动的 HTTP 服务。
 */
import logger from '../lib/logger';
import { initCronScheduler } from '../lib/pg-boss-scheduler';
import { registerTaskDemoHandlers } from '../routes/tasks/task-demo';
import { registerAnalyticsTaskHandlers } from '../services/analytics/analytics-tasks';
import { registerCmsTaskHandlers } from '../services/cms/cms-tasks';
import { registerReportDatasetTaskHandlers } from '../services/report/report-dataset-tasks';
import { registerReportDatasourceTaskHandlers } from '../services/report/report-datasource-tasks';
import { registerReportDeliveryTaskHandlers } from '../services/report/report-delivery-tasks';
import { registerReportDqTaskHandlers } from '../services/report/report-dq-tasks';
import { registerReportFillTasks } from '../services/report/report-fill-task.service';
import { registerReportSlaTaskHandlers } from '../services/report/report-sla-tasks';

export async function registerBackgroundWorkers(): Promise<void> {
  // 终端会话持久化：先接生命周期回调，再结算上一轮遗留记录，最后启动活跃时间回写。
  // 与 pg-boss 无关，独立 try/catch 以免任一失败牵连另一方。
  try {
    const { registerTerminalSessionPersistence, reconcileTerminalSessionsOnStartup, startTerminalSessionReaper } =
      await import('../services/ops/terminal-sessions.service');
    registerTerminalSessionPersistence();
    await reconcileTerminalSessionsOnStartup();
    startTerminalSessionReaper();
  } catch (err) {
    logger.error('Failed to initialize terminal session persistence', err);
  }

  try {
    await initCronScheduler();
    const { registerExportJobWorker } = await import('../services/tasks/export-jobs.service');
    const { registerSystemTasks } = await import('../lib/system-tasks.registry');
    registerTaskDemoHandlers(); // 演示任务类型需在任务中心 Worker 启动前注册
    const { registerDirectorySyncTaskHandlers } = await import('../services/identity/directory-sync-engine');
    registerDirectorySyncTaskHandlers(); // 通讯录同步 / 差异预览
    const { registerTerminalFileTaskHandlers } = await import('../services/ops/terminal-file-tasks');
    registerTerminalFileTaskHandlers(); // 文件压缩 / 解压
    registerCmsTaskHandlers(); // CMS 全站静态化 / 检索索引重建 / 死链检测
    const { registerBroadcastTaskHandlers } = await import('../services/messaging/broadcast-tasks');
    registerBroadcastTaskHandlers(); // 运营群发分批派发
    const { registerIotBatchTaskHandlers } = await import('../services/iot/iot-batch-tasks');
    registerIotBatchTaskHandlers(); // IoT 批量指令 / 批量期望属性
    const { registerDriveTaskHandlers } = await import('../services/drive/drive-tasks.service');
    registerDriveTaskHandlers(); // 企业网盘打包下载 / 批量复制 / 容量重算 / 索引补建 / 回收站清理
    const { registerDriveRenditionWorker } = await import('../services/drive/drive-renditions.service');
    await registerDriveRenditionWorker(); // 网盘缩略图 / 正文抽取等渲染产物队列
    const { registerDrivePartitionJob } = await import('../services/drive/drive-partitions.service');
    await registerDrivePartitionJob(); // 网盘动态 / 外链访问日志月分区滚动预建
    const { registerManagedFileGcJob } = await import('../services/files/file-gc.service');
    await registerManagedFileGcJob(); // 托管文件孤儿对象延迟回收
    const { registerDriveCollaborationJob } = await import('../services/drive/drive-collaboration.service');
    await registerDriveCollaborationJob();
    const { registerDriveExpiryReminderJob } = await import('../services/drive/drive-reminders.service');
    await registerDriveExpiryReminderJob(); // 网盘外链 / 临时授权到期提醒
    const { registerDriveSecurityAlertJob } = await import('../services/drive/drive-security-alerts.service');
    await registerDriveSecurityAlertJob(); // 网盘异常行为告警（批量下载 / 外链爆破）
    const { registerDriveOpenEventWorker } = await import('../services/drive/drive-open-events.service');
    await registerDriveOpenEventWorker(); // 网盘文件变更 → 开放平台 Webhook 事件
    const { reloadCmsSearchDict } = await import('../services/cms/cms-search.service');
    await reloadCmsSearchDict(); // CMS 检索自定义词典（DB → jieba）
    // AI 评测已迁移至 Mastra Datasets/Experiments(自带异步执行),不再挂任务中心
    registerReportDatasourceTaskHandlers();
    registerReportDatasetTaskHandlers();
    registerReportDeliveryTaskHandlers();
    registerReportDqTaskHandlers();
    registerReportSlaTaskHandlers();
    registerReportFillTasks();
    registerAnalyticsTaskHandlers();
    // 埋点聚合断档自愈：上次每日聚合与昨日之间的缺口在启动时补齐（best-effort）
    const { catchUpRollupGaps } = await import('../services/analytics/analytics-rollup.service');
    void catchUpRollupGaps()
      .then((n) => { if (n > 0) logger.info(`[analytics] rollup catch-up rebuilt ${n} rows`); })
      .catch((err) => logger.warn('[analytics] rollup catch-up failed', err));
    await registerExportJobWorker();
    await registerSystemTasks();
    // 全部系统任务注册完毕后对账：清理代码中已移除任务的残留，并让 pg-boss 队列 / schedule 与代码声明一致
    const { purgeOrphanSystemTasks } = await import('../lib/pg-boss-scheduler');
    await purgeOrphanSystemTasks();
    // 主题代码指纹检测：变更自动重建受影响站点静态页（零维护，详见 cms-theme-watch.service）
    const { checkThemeChangesAndRebuild } = await import('../services/cms/cms-theme-watch.service');
    void checkThemeChangesAndRebuild();
  } catch (err) {
    logger.error('Failed to initialize cron scheduler', err);
  }
}
