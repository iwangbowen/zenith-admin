/**
 * 后台作业声明清单（所有角色一致）。
 *
 * 这里的每一项都是「声明」：把任务类型、系统队列、系统周期任务登记到注册表、落库默认策略、
 * 建好 pg-boss 队列与 schedule。api 角色也必须完整声明——它要校验提交的任务类型、投递作业、
 * 在后台改任务启停、展示执行概览。是否真正 work() / 跟随 cron 领取，由 lib/pg-boss-scheduler.ts
 * 内部按 config.roles 门控，本文件与各业务模块的 register* 不感知角色。
 *
 * 整块包在 try/catch 中——任一处失败只降级后台能力，不影响已启动的 HTTP 服务。
 * 与角色绑定的启动步骤不在此：终端会话持久化见 run-api.ts，孤儿对账 / 启动期补齐见 run-worker.ts。
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

/** 启动 pg-boss 并完成全部后台作业声明；返回是否成功（失败已记日志，调用方据此决定是否继续执行期收尾） */
export async function declareBackgroundJobs(): Promise<boolean> {
  try {
    await initCronScheduler();
    const { registerExportJobWorker } = await import('../services/tasks/export-jobs.service');
    const { registerSystemTasks } = await import('../lib/system-tasks.registry');
    registerTaskDemoHandlers(); // 演示任务类型需在任务中心 Worker 启动前注册
    const { registerDirectorySyncTaskHandlers } = await import('../services/identity/directory-sync-engine');
    registerDirectorySyncTaskHandlers(); // 通讯录同步 / 差异预览
    const { registerTerminalFileTaskHandlers } = await import('../services/ops/terminal-file-tasks');
    registerTerminalFileTaskHandlers(); // 文件压缩 / 解压（节点亲和：只在提交它的进程执行）
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
    await reloadCmsSearchDict(); // CMS 检索自定义词典（DB → jieba）：内容保存（api）与索引重建（worker）都要分词
    // AI 评测已迁移至 Mastra Datasets/Experiments(自带异步执行),不再挂任务中心
    registerReportDatasourceTaskHandlers();
    registerReportDatasetTaskHandlers();
    registerReportDeliveryTaskHandlers();
    registerReportDqTaskHandlers();
    registerReportSlaTaskHandlers();
    registerReportFillTasks();
    registerAnalyticsTaskHandlers();
    await registerExportJobWorker();
    await registerSystemTasks();
    return true;
  } catch (err) {
    logger.error('Failed to initialize background jobs', err);
    return false;
  }
}
