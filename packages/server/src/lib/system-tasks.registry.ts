import logger from './logger';
import { registerSystemRecurringJob } from './pg-boss-scheduler';

/**
 * 启动时注册的系统级周期任务入口。
 *
 * 新增系统后台任务时优先放在这里，页面会自动从 pg-boss-scheduler 的注册表读取。
 * 数据保留类清理统一由 `data-retention` 任务驱动，策略声明见 `lib/retention/policies.ts`，
 * 不要为单张日志表新增独立清理任务。
 */
export async function registerSystemTasks(): Promise<void> {
  const { registerRetentionPolicies, runAllPolicies } = await import('./retention');
  await registerRetentionPolicies();
  await registerSystemRecurringJob({
    name: 'data-retention',
    title: '数据保留清理',
    module: '系统管理',
    cronExpression: '0 3 * * *',
    description: '每天按「数据保留策略」逐表分批清理超期数据；保留天数为 0 的策略跳过。',
    allowManualRun: true,
    run: async () => {
      const results = await runAllPolicies();
      if (results.length === 0) return '无超期数据';
      const total = results.reduce((sum, item) => sum + item.deleted, 0);
      const detail = results.map((item) => `${item.title} ${item.deleted}`).join('、');
      return `清理 ${total} 行：${detail}`;
    },
  });

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

  const { rollupShortLinkDailyStats } = await import('../services/short-link/short-link-rollup.service');
  await registerSystemRecurringJob({
    name: 'short-link-daily-rollup',
    title: '短链访问日聚合',
    module: '短链服务',
    cronExpression: '30 2 * * *',
    description: '把今天之前的短链点击明细按日物化到 short_link_daily_stats（幂等 upsert），先于数据保留清理执行，保证明细裁剪后长周期趋势仍可用。',
    allowManualRun: true,
    run: async () => {
      const rows = await rollupShortLinkDailyStats();
      return `聚合更新 ${rows} 行日统计`;
    },
  });

  const { scanExpiringShortLinks } = await import('../services/short-link/short-link-notify.service');
  await registerSystemRecurringJob({
    name: 'short-link-expiry-scan',
    title: '短链过期提醒扫描',
    module: '短链服务',
    cronExpression: '0 9 * * *',
    description: '每天扫描 72 小时内到期且仍启用的短链，经通知中心提醒创建人（幂等去重，调整有效期后会重新提醒）。',
    allowManualRun: true,
    run: async () => {
      const notified = await scanExpiringShortLinks();
      return notified > 0 ? `已提醒 ${notified} 条即将过期的短链` : '无即将过期的短链';
    },
  });

  const { retryPendingQuotaAlerts } = await import('../services/open-platform/open-quota-alerts.service');
  await registerSystemRecurringJob({
    name: 'open-quota-alert-retry',
    title: '开放平台配额告警补偿',
    module: '开放平台',
    cronExpression: '* * * * *',
    description: '补偿因进程退出或临时故障而未完成的配额告警与 Webhook 事件。',
    allowManualRun: true,
    run: retryPendingQuotaAlerts,
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

  const { scanDueDirectorySyncSources } = await import('../services/identity/directory-sync-engine');
  await registerSystemRecurringJob({
    name: 'directory-sync-tick',
    title: '通讯录同步调度扫描',
    module: '通讯录同步',
    cronExpression: '* * * * *',
    description: '每分钟扫描到期且启用的通讯录同步源，按各源的 cron 表达式顺序执行同步。',
    allowManualRun: true,
    manualSingleton: true,
    run: scanDueDirectorySyncSources,
  });

  const { runWikiGovernanceTick } = await import('../services/wiki/governance.service');
  await registerSystemRecurringJob({
    name: 'wiki-governance-tick',
    title: '知识中心治理扫描',
    module: '知识中心',
    cronExpression: '30 8 * * *',
    description: '每天提醒过期/待复审文档的负责人，并按保留天数清理回收站超期文档。',
    allowManualRun: true,
    run: runWikiGovernanceTick,
  });

  const { registerWorkflowJobWorker, drainWorkflowJobs } = await import('./workflow-jobs');
  await registerWorkflowJobWorker();
  await registerSystemRecurringJob({
    name: 'workflow-jobs-drain',
    title: '工作流作业兜底扫描',
    module: '工作流',
    cronExpression: '* * * * *',
    description: '每分钟补投到期的工作流作业，并回收租约失效或超过执行时限的运行中作业。',
    allowManualRun: true,
    run: async () => {
      const r = await drainWorkflowJobs();
      return `工作流作业补投：回收 ${r.recovered}，已投递 ${r.requeued}，死信 ${r.dead}`;
    },
  });

  const { reconcileReportFillWorkflows } = await import('../services/report/report-fill-reconciliation.service');
  await registerSystemRecurringJob({
    name: 'report-fill-workflow-reconcile',
    title: '填报审批与消费对账',
    module: '报表填报',
    cronExpression: '*/5 * * * *',
    description: '有界对账填报工作流终态、缺失实例链接及已批准记录的消费同步任务。',
    allowManualRun: true,
    run: async () => {
      const result = await reconcileReportFillWorkflows(100);
      return `填报对账完成：终态 ${result.bridged}，恢复实例 ${result.resumed}，提交同步 ${result.syncSubmitted}`;
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

  const { rollupOpenApiCallLogs } = await import('../services/open-platform/open-api-maintenance.service');
  await registerSystemRecurringJob({
    name: 'open-api-call-log-rollup',
    title: '开放 API 调用日志聚合',
    module: '开放平台',
    cronExpression: '20 1 * * *',
    description: '补齐全部未聚合完整日期的开放 API 统计，并回收过期客户端旧密钥与已发送配额告警。',
    allowManualRun: true,
    run: async () => {
      const result = await rollupOpenApiCallLogs();
      return `已补齐至 ${result.statDate}`;
    },
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

  const { dispatchDueScheduledMessages } = await import('../services/chat/chat-scheduled.service');
  await registerSystemRecurringJob({
    name: 'chat-scheduled-dispatch',
    title: '聊天定时消息派发',
    module: '消息中心',
    cronExpression: '* * * * *',
    description: '每分钟派发到期的聊天定时消息（以发送者身份复用发送链路）。',
    allowManualRun: true,
    run: async () => {
      await dispatchDueScheduledMessages();
      return '聊天定时消息派发扫描完成';
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
    description: '每 5 分钟采集平台级流程引擎健康快照，驱动健康趋势图与引擎健康告警指标。',
    allowManualRun: true,
    run: runWorkflowEngineHealthCapture,
  });

  const { registerAsyncTaskWorker, drainAsyncTasks } = await import('./task-center');  await registerAsyncTaskWorker();
  await registerSystemRecurringJob({
    name: 'async-tasks-drain',
    title: '异步任务兜底扫描',
    module: '任务中心',
    cronExpression: '* * * * *',
    description: '每分钟回收心跳超时的卡死任务（崩溃/重启恢复，从断点续跑），并重投长时间未被领取的待执行任务。',
    allowManualRun: true,
    run: async () => {
      const r = await drainAsyncTasks();
      return `异步任务兜底：回收卡死 ${r.recovered}，重投 ${r.redispatched}${r.orphaned ? `，节点下线标记失败 ${r.orphaned}` : ''}`;
    },
  });

  const { gcDeadNodeQueues } = await import('./pg-boss-scheduler');
  await registerSystemRecurringJob({
    name: 'scheduler-node-queue-gc',
    title: '下线节点队列回收',
    module: '任务中心',
    cronExpression: '*/10 * * * *',
    description: '每 10 分钟回收已下线进程（超过 2 倍心跳过期时间无心跳）遗留的节点亲和队列；进程被强杀 / 崩溃时不会走优雅停机的队列删除。',
    allowManualRun: true,
    run: async () => {
      const purged = await gcDeadNodeQueues();
      return purged > 0 ? `回收 ${purged} 条下线节点队列` : '无下线节点队列';
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

  const { runLicenseInspection } = await import('../services/platform/licensing.service');
  await registerSystemRecurringJob({
    name: 'license-inspection',
    title: 'License 授权巡检',
    module: '系统设置',
    cronExpression: '10 1 * * *',
    description: '每天重新验签当前 License 并同步状态（宽限/过期迁移、时钟回拨检测），到期前 30/7/3/1 天及状态变化时通知平台超管。LICENSE_MODE=off 时自动跳过。',
    allowManualRun: true,
    run: runLicenseInspection,
  });

  const { runUserGroupRuleSync } = await import('../services/identity/user-group-rules.service');
  await registerSystemRecurringJob({
    name: 'user-group-rule-sync',
    title: '动态用户组成员校准',
    module: '系统管理',
    cronExpression: '50 1 * * *',
    description: '每天全量重算动态用户组的成员物化结果，修复错过实时同步触发点（身份源批量变更、异常中断等）造成的漂移。',
    allowManualRun: true,
    run: runUserGroupRuleSync,
  });

  const { runMemberHousekeeping } = await import('../services/member/member-housekeeping.service');
  await registerSystemRecurringJob({
    name: 'member-housekeeping',
    title: '会员数据例行维护',
    module: '会员中心',
    cronExpression: '10 2 * * *',
    description: '每天将到期未使用的优惠券置为已过期；按 member_point_expire_days 清零长期不活跃账户的积分（expire 流水可审计）；发放生日礼与到期提醒。',
    allowManualRun: true,
    run: runMemberHousekeeping,
  });

  const { dispatchDueReportDqRules } = await import('../services/report/report-dq.service');
  await registerSystemRecurringJob({
    name: 'report-dq-rule-scan',
    title: '报表数据质量规则扫描',
    module: '报表中心',
    cronExpression: '* * * * *',
    description: '每分钟扫描到期的数据质量规则并提交到任务中心。',
    allowManualRun: true,
    run: async () => {
      const result = await dispatchDueReportDqRules();
      return `数据质量扫描：检查 ${result.checked} 条，提交 ${result.submitted} 条`;
    },
  });

  const { dispatchDueReportSlaRules } = await import('../services/report/report-sla.service');
  await registerSystemRecurringJob({
    name: 'report-sla-rule-scan',
    title: '报表 SLA 规则扫描',
    module: '报表中心',
    cronExpression: '* * * * *',
    description: '每分钟扫描到期的 SLA 规则并提交到任务中心。',
    allowManualRun: true,
    run: async () => {
      const result = await dispatchDueReportSlaRules();
      return `SLA 扫描：检查 ${result.checked} 条，提交 ${result.submitted} 条`;
    },
  });

  const { cleanupStaleMaterializationSnapshots } = await import('../services/report/report-materialization.service');
  await registerSystemRecurringJob({
    name: 'report-materialization-snapshot-cleanup',
    title: '报表物化快照清理',
    module: '报表中心',
    cronExpression: '20 4 * * *',
    description: '每天清理已过期或超过保留期的持久化物化快照及托管文件。',
    allowManualRun: true,
    run: async () => {
      const count = await cleanupStaleMaterializationSnapshots();
      return `清理了 ${count} 个物化快照`;
    },
  });

  const { scanReportDeprecationSunsets } = await import('../services/report/report-asset.service');
  await registerSystemRecurringJob({
    name: 'report-asset-deprecation-scan',
    title: '报表资产弃用扫描',
    module: '报表中心',
    cronExpression: '5 * * * *',
    description: '每小时扫描已到生效时间的弃用公告；仅推进公告状态，不删除仍可能被血缘引用的资产。',
    allowManualRun: true,
    run: async () => {
      const count = await scanReportDeprecationSunsets();
      return `处理了 ${count} 条资产弃用公告`;
    },
  });

  const { publishScheduledCmsContents } = await import('../services/cms/cms-scheduled.service');
  await registerSystemRecurringJob({
    name: 'cms-scheduled-publish',
    title: 'CMS 定时发布',
    module: 'CMS内容管理',
    cronExpression: '* * * * *',
    description: '每分钟扫描到期的定时发布内容并自动发布（含增量静态化与搜索引擎推送）。',
    allowManualRun: true,
    run: publishScheduledCmsContents,
  });

  const { dispatchDueCmsDistributionRules } = await import('../services/cms/cms-distributions.service');
  await registerSystemRecurringJob({
    name: 'cms-distribution-schedule',
    title: 'CMS 定时内容分发',
    module: 'CMS内容管理',
    cronExpression: '* * * * *',
    description: '每分钟扫描到期的站群分发规则并提交可取消、可续跑的任务中心任务。',
    allowManualRun: true,
    run: dispatchDueCmsDistributionRules,
  });

  const { cleanupCmsRecycleBin } = await import('../services/cms/cms-contents.service');
  await registerSystemRecurringJob({
    name: 'cms-recycle-cleanup',
    title: 'CMS 回收站自动清理',
    module: 'CMS内容管理',
    cronExpression: '50 3 * * *',
    description: '每天按各站点「回收站保留天数」清理超期内容（彻底删除，含标签计数重算；0 天 = 永久保留）。',
    allowManualRun: true,
    run: async () => {
      const count = await cleanupCmsRecycleBin();
      return `清理了 ${count} 条回收站内容`;
    },
  });

  const { sweepIotOfflineAlarms } = await import('../services/iot/iot-alarms.service');
  const { sampleIotOnlineSnapshot } = await import('../services/iot/iot-rollup.service');
  await registerSystemRecurringJob({
    name: 'iot-offline-sweep',
    title: 'IoT 设备离线扫描',
    module: 'IoT 设备',
    cronExpression: '* * * * *',
    description: '每分钟收敛设备持久化在线标记（Redis TTL 对账 + 离线事件打点），按启用的离线告警规则触发告警，并顺带落一条在线率快照（仪表盘趋势数据源）。',
    allowManualRun: true,
    run: async () => {
      const result = await sweepIotOfflineAlarms();
      await sampleIotOnlineSnapshot();
      return result;
    },
  });

  const { rollupIotTelemetryHourly } = await import('../services/iot/iot-rollup.service');
  await registerSystemRecurringJob({
    name: 'iot-telemetry-rollup',
    title: 'IoT 遥测小时聚合',
    module: 'IoT 设备',
    cronExpression: '*/10 * * * *',
    description: '每 10 分钟重算最近两个小时桶的数值属性聚合（min/max/avg/last，upsert 幂等），长窗口图表与仪表盘查聚合而非扫明细，图表滞后不超过 10 分钟。',
    allowManualRun: true,
    run: rollupIotTelemetryHourly,
  });

  const { ensureIotTelemetryPartitions } = await import('../services/iot/iot-partitions.service');
  await registerSystemRecurringJob({
    name: 'iot-telemetry-partition-maintain',
    title: 'IoT 遥测分区维护',
    module: 'IoT 设备',
    cronExpression: '20 * * * *',
    description: '每小时滚动预建遥测明细表未来 7 天的日分区（写入命中缺失分区时也会按需补建）；超期分区由「数据保留清理」任务整表 DROP。',
    allowManualRun: true,
    run: () => ensureIotTelemetryPartitions(),
  });
  // 启动即补齐：迁移只建了迁移当日前后的分区，长期未启动的环境靠这里接上
  void ensureIotTelemetryPartitions().catch((err) => {
    logger.warn(`[iot] 启动预建遥测分区失败: ${(err as Error).message}`);
  });

  const { sweepIotOtaTimeouts } = await import('../services/iot/iot-ota.service');
  await registerSystemRecurringJob({
    name: 'iot-ota-timeout-sweep',
    title: 'IoT OTA 超时收敛',
    module: 'IoT 设备',
    cronExpression: '* * * * *',
    description: '每分钟把超过任务超时时长仍未终态的升级设备判为失败，全部终态后任务收敛为已完成。',
    allowManualRun: true,
    run: sweepIotOtaTimeouts,
  });

  const { sweepIotAlarmEscalations } = await import('../services/iot/iot-alarms.service');
  await registerSystemRecurringJob({
    name: 'iot-alarm-escalation-sweep',
    title: 'IoT 告警升级扫描',
    module: 'IoT 设备',
    cronExpression: '* * * * *',
    description: '每分钟扫描超过规则升级时长仍未认领/未恢复的告警，升级通知升级接收人（每条告警至多一次；维护窗口内跳过）。',
    allowManualRun: true,
    run: sweepIotAlarmEscalations,
  });

  const { dispatchDueIotSchedules } = await import('../services/iot/iot-schedules.service');
  await registerSystemRecurringJob({
    name: 'iot-schedule-dispatch',
    title: 'IoT 计划任务调度',
    module: 'IoT 设备',
    cronExpression: '* * * * *',
    description: '每分钟执行到期的设备计划任务（定时/周期性下发指令或期望属性），执行结果留痕。',
    allowManualRun: true,
    run: dispatchDueIotSchedules,
  });
}
