# 监控与告警

监控与告警位于 platform 路由域，面向服务运行态、历史趋势、WebSocket 连接、告警规则、告警事件与通知闭环。

---

## 服务监控

「服务监控」（`/system/monitor`）接口前缀为 `/api/monitor`，权限码为 `system:monitor:view`。

| 接口 | 说明 |
| --- | --- |
| `GET /api/monitor` | 当前监控快照 |
| `GET /api/monitor/timeseries` | 进程内最近 1 小时时序数据 |
| `GET /api/monitor/history?range=...` | 持久化历史趋势，按时间范围分桶聚合 |
| `GET /api/monitor/ws` | WebSocket 实时连接指标 |
| `GET /api/monitor/stream` | SSE 实时推送监控指标 |

SSE 首帧推送完整 `metrics`、全量 `series` 和 `ws` 指标；后续采样 tick 推送 `metrics:diff`、`series:point` 与 `ws`。客户端按差量深合并，避免整页轮询。

`system_metric_samples` 存储基础设施指标采样点，采样任务默认每分钟落库。`/history` 支持 `1h`、`6h`、`24h`、`7d`、`30d` 范围，每个范围使用不同分桶粒度并返回均值与峰值。

## 指标口径

| 分组 | 指标 | 口径 | 单位 |
| --- | --- | --- | --- |
| 基础设施 | CPU / 内存 / 磁盘 / Swap / 负载 / 进程 CPU / 堆内存 / 事件循环延迟 / QPS / HTTP 错误率 / 网络上下行 / 磁盘读写 | 宿主机与进程采样器即时值 | % · 字节/秒 · ms |
| 基础设施 | 日志 ERROR 频率 / 日志 WARN 频率 | 近 5 分钟应用日志对应级别平均每分钟条数 | 条/分钟 |
| 后台调度 | 后台 worker 进程数 / 后台作业积压 | 近 90 秒内有心跳的 worker 角色进程数；全部 pg-boss 队列中已到执行时间、等待领取的作业总数（不含延后执行） | 个 · 项 |
| 流程引擎 | 健康分 / 队列积压 / 死信数 / 失败率 / 卡死数 | 工作流引擎运维指标 | 分 · 项 · % |
| 支付 | 支付失败率 / 支付卡单数 / 对账差异待处理 / 支付事件积压 / 支付回调失败率 | 支付域告警指标源实时聚合 | % · 项 |
| 开放平台 | 开放 API 错误率 / 单应用最高错误率 / 应用 Webhook 失败率 / 自动停用订阅数 | 开放平台告警指标源实时聚合 | % · 项 |

`MONITOR_METRIC_META` 声明每个指标的 `scope`：`global` 指宿主机或平台级口径，`tenant` 指按规则所属租户过滤。评估器按规则涉及的租户集合分组取快照。

## 日志级别频率指标

日志 ERROR / WARN 频率在 logger 的 logMethod hook 写入点由 `lib/log-metrics.ts` 计数，不扫描日志文件。实现特性：

- 不依赖文件 I/O，不受日志轮转影响；
- 按 epoch 分钟分桶保留近 5 个桶，读写时惰性淘汰；
- 与 QPS、HTTP 错误率一样是进程内口径，多实例部署时各实例统计自身；
- 计数失败不影响日志写入。

内置规则包括 ERROR ≥ 10 条/分持续 3 分钟（严重）和 WARN ≥ 30 条/分持续 5 分钟（警告）。此类告警事件操作列提供「查看日志」（需 `system:log:files`），跳转到 `/system/log-files?file=app.YYYY-MM-DD.1.log&level=error`。

## 告警中心

告警中心使用独立顶级菜单，不归属于「系统运维」目录。接口前缀为 `/api/monitor-alerts`，告警引擎由定时任务（`evaluateMonitorAlerts`，运行在 worker 角色）评估启用规则。规则达阈触发，指标恢复后自动解除；支持持续 N 分钟超阈、静默期、邮件 / Webhook / 站内信三渠道派发。

「后台 worker 进程数」这一指标是例外：worker 全部下线时评估器本身已停，因此 api 进程每分钟自查 worker 心跳，仅在为 0 时以该指标子集调用同一个评估器（`lib/worker-watchdog.ts`），规则、收件人、静默期与事件落库与其他告警一致；worker 恢复后由其自身的评估把规则置回 `ok` 并发恢复通知。种子规则「后台 worker 进程缺失」（`< 1`，持续 2 分钟）与「后台作业持续积压」（`≥ 200`，持续 5 分钟）默认启用。

规则的“告警状态”表示当前是否已触发：`ok` 在页面显示“未触发”，`firing` 显示“告警中”；“启用状态”独立控制规则是否参与评估。停用规则会关闭该规则尚未恢复的告警事件，并清除触发态与持续超阈计时。

| 页面 | 路径 | 权限 |
| --- | --- | --- |
| 告警概览 | `/alerts/overview` | `alert:overview:list` |
| 告警规则 | `/alerts/rules` | `alert:rule:list`、`alert:rule:create`、`alert:rule:update`、`alert:rule:delete`、`alert:rule:test` |
| 告警事件 | `/alerts/events` | `alert:event:list`、`alert:event:handle`、`alert:event:export` |

## 通知与处理闭环

接收目标拆为 `recipientUserIds` 与 `recipientEmails`。系统用户通过稳定用户 ID 投递站内信；邮件渠道在派发时读取用户当前邮箱；`recipientEmails` 保存群组邮箱或外部联系人地址，并与用户邮箱去重。

`dispatchAlertChannels` 将真实投递结果回写到事件行的 `notify_status` / `notify_channels` / `notify_error` / `notified_at`。通知状态包括：

| 状态 | 含义 |
| --- | --- |
| `skipped` | 规则没有配置任何可派发渠道 |
| `success` | 所有已配置渠道均投递成功 |
| `partial` | 部分渠道失败 |
| `failed` | 全部渠道失败 |

事件的 `handle_status`（`pending` / `acknowledged` / `closed`）与系统判定的 `status`（`firing` / `resolved`）相互独立。认领会写入处理人和确认时间；标记已处理置为 `closed`；撤销认领置回 `pending` 并清空处理备注与确认时间。`acknowledged_at` 只在首次响应时写入。

## 筛选、批量与试发

规则列表支持按名称关键词、指标、级别、启用状态与告警状态筛选，事件列表支持关键词、指标、级别、告警状态、通知状态、处理状态、规则 ID 与触发时间范围筛选。规则支持批量删除与批量启停；事件支持单条与批量处理。告警规则的「查看事件」跳转到 `/alerts/events?ruleId=N`。

`POST /api/monitor-alerts/{id}/test`（权限 `alert:rule:test`）按规则当前渠道与接收人发送测试消息，返回派发结果；该操作不写事件表、不改规则运行态与 `last_triggered_at`。

`SEED_MONITOR_ALERT_RULES` 预置基础设施容量、日志异常频率、支付、开放平台与流程引擎关键失效信号，默认走站内信发给管理员用户 ID 1。
