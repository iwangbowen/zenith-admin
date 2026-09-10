# 定时任务

系统包含两套调度能力：业务可配置定时任务 `cron_jobs`，以及启动时注册的系统级调度任务 `system-scheduler`。两者均基于后端进程与 PgBoss 相关运行时集成。

## 业务定时任务

数据表：

- `cron_jobs`
- `cron_job_logs`

路由挂载在 `/api/cron-jobs`，实现文件为 `packages/server/src/routes/tasks/cron-jobs.ts`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/` | `system:cronjob:list` | 分页查询 |
| `GET` | `/{id}` | `system:cronjob:list` | 详情 |
| `POST` | `/` | `system:cronjob:create` | 创建 |
| `PUT` | `/{id}` | `system:cronjob:update` | 更新 |
| `DELETE` | `/{id}` | `system:cronjob:delete` | 删除 |
| `POST` | `/{id}/run` | `system:cronjob:execute` | 手动执行 |
| `GET` | `/{id}/logs` | `system:cronjob:list` | 单任务执行日志 |
| `GET` | `/logs` | `system:cronjob:list` | 全部执行日志，支持 `jobId` / `status` / `keyword` / `startTime` / `endTime` 筛选 |
| `GET` | `/stats?days=14` | `system:cronjob:list` | 执行概览统计：今日 / 昨日同时段 / 周期与上一周期汇总、调度器状态、健康提醒、逐任务指标、每日趋势、星期 × 小时分布、失败原因聚合、下次执行 |

任务字段包括 `name`、`cronExpression`、`handler`、`params`、`status`、`retryCount`、`retryInterval`、`retryBackoff`、`monitorTimeout`（秒）和最近运行结果。

执行概览的健康判定阈值（连续失败次数、成功率下限、P95 / 平均倍数、接近超时比例、未按计划执行容差）
统一定义在 `packages/shared/src/platform/cron-health.ts`，服务端聚合与 Demo Mock 共用。

## Handler Registry

`packages/server/src/lib/pg-boss-scheduler.ts` 注册可被 `cron_jobs.handler` 引用的处理器：

- `cleanExpiredCaptchas`
- `echo`
- `databaseBackup`
- `publishScheduledAnnouncements`
- `cleanupTerminalRecordings`
- `closeExpiredPaymentOrders`
- `executeDueDeductions`
- `syncPaymentDisputes`
- `paymentReconciliation`
- `dispatchPaymentEvents`
- `dispatchNotifications`
- `aggregateNotificationDigests`
- `retryFailedSharing`
- `generateDailySettlements`
- `syncPaymentTransfers`
- `autoPaymentRecon`
- `analyticsRollupDaily`
- `analyticsSegmentRefresh`
- `evaluateErrorAlerts`
- `sampleSystemMetrics`
- `evaluateMonitorAlerts`
- `dispatchReportSubscriptions`
- `refreshReportMaterializations`
- `dispatchReportAlerts`

## 系统级调度任务

系统调度路由挂载在 `/api/system-scheduler`，实现文件为 `packages/server/src/routes/tasks/system-scheduler.ts`。权限：

- `system:scheduler:view`
- `system:scheduler:run`
- `system:scheduler:config`
- `system:scheduler:cleanup`
- `system:scheduler:alert`

系统任务在 `packages/server/src/lib/system-tasks.registry.ts` 中注册，运行日志写入 `system_scheduler_runs`，节点心跳写入 `system_scheduler_nodes`。

注册的 recurring 任务包括：

| name | 标题 | cron |
| --- | --- | --- |
| `data-retention` | 数据保留清理 | `0 3 * * *` |
| `export-file-cleanup` | 导出文件自动清理 | `0 3 * * *` |
| `open-quota-alert-retry` | 开放平台配额告警补偿 | `* * * * *` |
| `workflow-schedule-tick` | 工作流定时发起扫描 | `* * * * *` |
| `directory-sync-tick` | 通讯录同步调度扫描 | `* * * * *` |
| `wiki-governance-tick` | 知识中心治理扫描 | `30 8 * * *` |
| `workflow-jobs-drain` | 工作流作业兜底扫描 | `* * * * *` |
| `report-fill-workflow-reconcile` | 填报审批与消费对账 | `*/5 * * * *` |
| `app-webhook-delivery-retry` | 开放应用 Webhook 重试 | `*/5 * * * *` |
| `open-api-call-log-rollup` | 开放 API 调用日志聚合 | `20 1 * * *` |
| `channel-scheduled-publish` | 频道定时消息发布 | `* * * * *` |
| `chat-scheduled-dispatch` | 聊天定时消息派发 | `* * * * *` |
| `mp-kf-session-tick` | 公众号客服会话维护 | `* * * * *` |
| `mp-broadcast-tick` | 公众号群发任务扫描 | `* * * * *` |
| `workflow-engine-health-capture` | 流程引擎健康采集 | `*/5 * * * *` |
| `async-tasks-drain` | 异步任务兜底扫描 | `* * * * *` |
| `tenant-expiry-check` | 租户到期巡检 | `30 1 * * *` |
| `license-inspection` | License 授权巡检 | `10 1 * * *` |
| `user-group-rule-sync` | 动态用户组成员校准 | `50 1 * * *` |
| `member-housekeeping` | 会员数据例行维护 | `10 2 * * *` |
| `report-dq-rule-scan` | 报表数据质量规则扫描 | `* * * * *` |
| `report-sla-rule-scan` | 报表 SLA 规则扫描 | `* * * * *` |
| `report-materialization-snapshot-cleanup` | 报表物化快照清理 | `20 4 * * *` |
| `report-asset-deprecation-scan` | 报表资产弃用扫描 | `5 * * * *` |
| `cms-scheduled-publish` | CMS 定时发布 | `* * * * *` |
| `cms-distribution-schedule` | CMS 定时内容分发 | `* * * * *` |
| `cms-recycle-cleanup` | CMS 回收站自动清理 | `50 3 * * *` |

## 开发建议

- 新增业务可配置任务时，先注册 handler，再通过种子或管理端创建 `cron_jobs`。
- 新增平台级固定任务时，使用 `registerSystemRecurringJob()`。
- 长耗时、可重试、需要进度的批处理优先接入任务中心；定时任务只负责触发。
