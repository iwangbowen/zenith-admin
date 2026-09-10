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
| `GET` | `/{id}/stats?days=14` | `system:cronjob:list` | 单任务下钻：周期汇总与环比、每日趋势、耗时散点、调度延迟分布、最近失败 / 超时、未来 10 次执行 |

任务字段包括 `name`、`cronExpression`、`handler`、`params`、`status`、`retryCount`、`retryInterval`、`retryBackoff`、`monitorTimeout`（秒）和最近运行结果。

`cron_job_logs` 每条执行记录除状态 / 耗时 / 输出外，还记录执行上下文：

| 列 | 含义 |
| --- | --- |
| `trigger` | 触发方式：`schedule` 计划 / `manual` 手动 / `retry` pg-boss 失败重试 |
| `attempt` | 重试序号，0 = 首次 |
| `scheduled_at` / `latency_ms` | 计划触发时刻与调度延迟（生成列 = `started_at − scheduled_at`） |
| `error_message` | 失败 / 超时原因（与正常 `output` 分离，供失败原因聚合） |
| `node_id` | 执行节点 `hostname:pid` |
| `triggered_by` | 手动执行的操作人 |

状态含 `timeout`：worker 按任务 `monitorTimeout`（秒）计时，到点未完成即记为超时并抛错交给 pg-boss 重试策略；
调度器启动时会把不属于任何在线节点的 `running` 记录关闭为失败（进程崩溃遗留）。

执行概览的健康判定阈值（连续失败次数、成功率下限、P95 / 平均倍数、接近超时比例、未按计划执行容差）
统一定义在 `packages/shared/src/platform/cron-health.ts`，服务端聚合与 Demo Mock 共用。

### 在 pg-boss 上的映射

业务定时任务与系统级周期任务各占**一条**调度队列，规则相同（`packages/server/src/lib/pg-boss-scheduler.ts`）：

| 概念 | 实现 |
| --- | --- |
| 队列 | `cron-jobs`（业务定时任务）与 `system-recurring`（系统级周期任务），policy `stately`，`heartbeatSeconds: 60`，排队保留 7 天、完成后 1 天删除（执行历史以 `cron_job_logs` / `system_scheduler_runs` 为准），积压超过 200 条触发 `queue_backlog` 警告 |
| 任务 → schedule | 每个启用任务是所属队列上的一条 keyed schedule（业务任务 `key = jobId`，系统任务 `key = 任务名`），`schedule()` 按 (队列, key) 幂等 upsert；停用 / 删除时 `unschedule(key)` 并取消其尚未开始的作业 |
| 不重叠执行 | 作业带 `singletonKey = key`，`stately` 保证同一任务最多「1 条排队 + 1 条执行中」：执行时间超过周期只补跑一次，不会无限积压 |
| 重试 / 超时 | 作业级参数显式下发，不依赖队列默认值：业务任务按自身 `retryLimit` / `retryDelay` / `retryBackoff`（含 `retryLimit: 0`），系统任务固定 `retryLimit: 0`（幂等扫描，等下一周期）；超时由 worker 内按 `monitorTimeout` 判定并记为 `timeout`，pg-boss 的 `expireInSeconds` 只作兜底（`monitorTimeout + 30s`，未配置超时时取上限 24 小时，避免默认 15 分钟过期把正常执行的作业判死后重叠执行） |
| worker | 每个进程对每条队列只 `work()` 一次，`localConcurrency: 8`（8 个轮询 worker 各取 1 条），worker 在执行期间自动续心跳；进程崩溃后作业在 60 秒内被判定失联并按重试策略处理 |
| 手动执行 | `send()` 同 key 作业 + `notifyWorker()` 立刻取用；该任务已有排队作业时本次触发与之合并，只返回提示 |
| 启动对账 | pg-boss 里只允许存在代码声明的队列（两条调度队列 + 已注册的队列型 worker），未声明的队列连同 schedule、作业一起删除；两条调度队列上的 schedule 与启用任务一一对应，多余的删除；队列 policy 与代码不一致时重建 |

**Cron 表达式精度**：pg-boss 每 30 秒评估一次 schedule，只支持分钟级。管理端保存的 6 段表达式（含秒位）
在注册到 pg-boss 与计算「下次执行 / 未按计划执行」时统一经 `toMinuteCron()` 去掉秒位
（`packages/shared/src/platform/cron-expression.ts`），秒位非 0 的任务会在列表中提示「秒位不生效」。
需要秒级节奏的工作应交给任务中心或专用 worker，定时任务只负责分钟级触发。

### 调度器健康

`GET /stats` 的 `scheduler` 段除节点心跳、WIP 与 pg-boss 运维警告外，还包含：

| 字段 | 来源 |
| --- | --- |
| `schemaVersion` / `schemaDriftOk` / `schemaDriftIssues` | `boss.schemaVersion()` + `boss.detectSchemaDrift()`，启动时检查并随心跳每 10 分钟复检；有漂移时进 `schema_drift` 警告 |
| `maintaining` | `boss.isMaintaining()`，本节点是否正在执行维护 |
| `bamPending` / `bamFailed` | `boss.getBamStatus()` 后台异步迁移（大索引重建等）计数；失败进 `bam_failed` 警告 |
| `scheduleMissing` / `scheduleOrphans` | 只读对账 `cron_jobs` 与 `getSchedules('cron-jobs')`：启用却无 schedule 的任务、有 schedule 却已停用 / 不存在的 key |

运维警告（`boss.on('warning')`，含 `queue_backlog` / `xmin_horizon` / `index_bloat` 等）同时开启 `persistWarnings`
落到 `pgboss.warning` 表保留 7 天，各节点最近 20 条随心跳写入 `system_scheduler_nodes.metadata`，概览合并所有在线节点展示。

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

系统任务分两类，都在启动时由代码注册，运行日志写入 `system_scheduler_runs`，节点心跳写入 `system_scheduler_nodes`：

| 类型 | 注册方式 | pg-boss 载体 | 说明 |
| --- | --- | --- | --- |
| 周期任务（recurring） | `registerSystemRecurringJob()`，入口 `packages/server/src/lib/system-tasks.registry.ts`，网盘 / 文件等模块在各自 service 内注册 | `system-recurring` 队列上 `key = 任务名` 的 schedule | 5 段 cron，`retryLimit: 0`，`stately` 不重叠；`timeoutMs` 是耗时告警阈值，不打断执行；`manualSingleton` 控制有运行中实例时是否接受手动触发 |
| 队列型 worker（queue） | `registerSystemQueueWorker()` | 以任务名命名的独立队列，参数由注册方 `queueOptions` 声明 | 由业务代码 `sendSystemJob()` 投递，例如导出任务、工作流作业、异步任务 |

页面上每个任务的「待 / 跑 / 延 / 败」读数来自 pg-boss 作业表：周期任务按 `system-recurring` 队列内的 `singletonKey`
统计，队列型任务按队列名统计。

注册的周期任务：

| name | 标题 | 模块 | cron |
| --- | --- | --- | --- |
| `data-retention` | 数据保留清理 | 系统管理 | `0 3 * * *` |
| `user-group-rule-sync` | 动态用户组成员校准 | 系统管理 | `50 1 * * *` |
| `license-inspection` | License 授权巡检 | 系统设置 | `10 1 * * *` |
| `tenant-expiry-check` | 租户到期巡检 | 租户管理 | `30 1 * * *` |
| `files-gc` | 托管文件孤儿对象回收 | 文件与存储 | `15 * * * *` |
| `export-file-cleanup` | 导出文件自动清理 | 导出中心 | `0 3 * * *` |
| `async-tasks-drain` | 异步任务兜底扫描 | 任务中心 | `* * * * *` |
| `workflow-schedule-tick` | 工作流定时发起扫描 | 工作流 | `* * * * *` |
| `workflow-jobs-drain` | 工作流作业兜底扫描 | 工作流 | `* * * * *` |
| `workflow-engine-health-capture` | 流程引擎健康采集 | 工作流 | `*/5 * * * *` |
| `directory-sync-tick` | 通讯录同步调度扫描 | 通讯录同步 | `* * * * *` |
| `member-housekeeping` | 会员数据例行维护 | 会员中心 | `10 2 * * *` |
| `channel-scheduled-publish` | 频道定时消息发布 | 消息渠道 | `* * * * *` |
| `chat-scheduled-dispatch` | 聊天定时消息派发 | 消息中心 | `* * * * *` |
| `mp-kf-session-tick` | 公众号客服会话维护 | 公众号 | `* * * * *` |
| `mp-broadcast-tick` | 公众号群发任务扫描 | 公众号 | `* * * * *` |
| `wiki-governance-tick` | 知识中心治理扫描 | 知识中心 | `30 8 * * *` |
| `cms-scheduled-publish` | CMS 定时发布 | CMS 内容管理 | `* * * * *` |
| `cms-distribution-schedule` | CMS 定时内容分发 | CMS 内容管理 | `* * * * *` |
| `cms-recycle-cleanup` | CMS 回收站自动清理 | CMS 内容管理 | `50 3 * * *` |
| `drive-subscription-changes` | 网盘关注变更通知 | 企业网盘 | `* * * * *` |
| `drive-renditions-reconcile` | 网盘渲染任务补投 | 企业网盘 | `*/5 * * * *` |
| `drive-security-alerts` | 网盘异常行为告警 | 企业网盘 | `*/5 * * * *` |
| `drive-log-partitions` | 网盘日志分区维护 | 企业网盘 | `5 * * * *` |
| `drive-expiry-reminders` | 网盘外链 / 临时授权到期提醒 | 企业网盘 | `15 * * * *` |
| `short-link-daily-rollup` | 短链访问日聚合 | 短链服务 | `30 2 * * *` |
| `short-link-expiry-scan` | 短链过期提醒扫描 | 短链服务 | `0 9 * * *` |
| `open-quota-alert-retry` | 开放平台配额告警补偿 | 开放平台 | `* * * * *` |
| `app-webhook-delivery-retry` | 开放应用 Webhook 重试 | 开放平台 | `*/5 * * * *` |
| `open-api-call-log-rollup` | 开放 API 调用日志聚合 | 开放平台 | `20 1 * * *` |
| `report-dq-rule-scan` | 报表数据质量规则扫描 | 报表中心 | `* * * * *` |
| `report-sla-rule-scan` | 报表 SLA 规则扫描 | 报表中心 | `* * * * *` |
| `report-asset-deprecation-scan` | 报表资产弃用扫描 | 报表中心 | `5 * * * *` |
| `report-materialization-snapshot-cleanup` | 报表物化快照清理 | 报表中心 | `20 4 * * *` |
| `report-fill-workflow-reconcile` | 填报审批与消费对账 | 报表填报 | `*/5 * * * *` |
| `iot-offline-sweep` | IoT 设备离线扫描 | IoT 设备 | `* * * * *` |
| `iot-alarm-escalation-sweep` | IoT 告警升级扫描 | IoT 设备 | `* * * * *` |
| `iot-ota-timeout-sweep` | IoT OTA 超时收敛 | IoT 设备 | `* * * * *` |
| `iot-schedule-dispatch` | IoT 计划任务调度 | IoT 设备 | `* * * * *` |
| `iot-telemetry-rollup` | IoT 遥测小时聚合 | IoT 设备 | `*/10 * * * *` |
| `iot-telemetry-partition-maintain` | IoT 遥测分区维护 | IoT 设备 | `20 * * * *` |

注册的队列型 worker：

| name | 标题 | 模块 |
| --- | --- | --- |
| `async-tasks` | 异步任务执行 Worker | 任务中心 |
| `export-jobs` | 导出任务执行 Worker | 导出中心 |
| `workflow-jobs` | 工作流作业 Worker | 工作流 |
| `drive-renditions` | 网盘渲染产物 | 企业网盘 |
| `drive-open-events` | 网盘开放事件外推 | 企业网盘 |
## 开发建议

- 新增业务可配置任务时，先注册 handler，再通过种子或管理端创建 `cron_jobs`。
- 新增平台级固定任务时，使用 `registerSystemRecurringJob()`；只有需要由业务代码按需投递作业的场景才用 `registerSystemQueueWorker()` 建独立队列。
- 长耗时、可重试、需要进度的批处理优先接入任务中心；定时任务只负责触发。
- 不要为周期任务另建 pg-boss 队列或直接调用 `work()`：全部走两条调度队列的 keyed schedule，
  每个进程对每条队列只有一个 worker；队列参数（心跳、保留期、policy）只在 `pg-boss-scheduler.ts` 中声明，
  启动对账会删除代码未声明的队列。
- Cron 表达式按分钟设计；同一分钟触发的任务会并发执行（`localConcurrency: 8`），有先后依赖的工作应合并为一个 handler 或交给工作流。
