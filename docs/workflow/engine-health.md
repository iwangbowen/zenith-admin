# 引擎诊断、健康与运行配置

工作流提供三个相互补充的观测入口：实例诊断解释单个实例的任务与执行路径，健康巡检定位异常实例，引擎诊断查看组件、队列、趋势与恢复动作。单个实例的诊断操作见[流程监控与分析](./monitoring-operations.md)，后台执行能力见[作业执行与恢复](./jobs.md)。

## 健康巡检

页面入口为 `工作流引擎 → 运维与集成 → 健康巡检`。接口缺省卡滞阈值为 30 分钟，可传 1–1440 分钟；页面提供 10 分钟至 1 天的常用选项。巡检按当前身份的可见租户读取实例、任务与作业，识别以下问题：

| 问题类型 | 级别 | 说明 |
| --- | --- | --- |
| `token_task_mismatch` | critical | 超阈值活动任务所在节点无 active Token，任务无法正常提交，指向强制跳转修复 |
| `external_dispatch_failed` | critical | 外部审批分派失败 |
| `external_dispatch_pending` | warning | 外部审批等待超阈值仍未派发 |
| `trigger_execution_failed` | critical | 触发器作业最终失败 |
| `trigger_waiting_no_execution` | critical | 触发器等待超阈值且无执行记录 |
| `subprocess_waiting` | warning | 父任务等待子流程超阈值 |
| `delay_missing_wake_job` | critical | 延迟任务缺少唤醒作业 |
| `delay_overdue` | critical | 延迟到期但尚未唤醒 |
| `task_timeout_overdue` | warning | 超时作业到期但尚未处理 |
| `waiting_task_stuck` | warning | 普通人工待办超阈值，需催办、转办或配置超时策略 |
| `workflow_event_outbox_failed` / `workflow_event_outbox_pending` | critical / warning | 事件分发失败或积压 |
| `instance_stalled` | critical | 运行中实例既无待办 / 等待任务也无在途作业 |

每条任务只报告最高优先级问题，优先考虑 Token 缺失、作业异常，再考虑滞留，避免重复计数。人工审批等待时间和自动作业排队时间应分别判断。

## 引擎内省

页面入口为 `工作流引擎 → 运维与集成 → 流程监控 → 引擎诊断`。内省汇总流程定义合法性、运行中实例和任务、执行 Token、延时 / 超时、触发器、外部审批、子流程、事件派发、事件监听器与调度器状态，并展示异常清单和实例诊断入口。

队列分布描述各类运行对象的 ready、running、delayed、failed 状态，也包含人工待办与等待对象；它与[作业账本运行状态](./jobs.md#运行状态面板)的到期 pending 积压是不同口径。调度器观测会结合已注册工作流执行池、存活节点、到期作业量、最老排队时长和排队 P95/P99，辅助区分人工等待、执行器缺失与后台积压。

事件遥测包含近一小时 / 24 小时成功失败量、上一周期对比、平均延迟、P95/P99、延迟分桶与 Apdex；健康分结合异常和队列状态生成。页面还提供平台健康趋势，便于观察持续故障。

## 健康阈值与趋势

`系统设置 → 系统设置 → 工作流引擎` 运行时设置模块管理平台级诊断阈值，读取使用 `system:setting:view`，修改使用 `system:setting:update`。各流程定义的节点超时策略仍在设计器中配置。

| 设置 | 缺省值 | 用途 |
| --- | --- | --- |
| `engine.healthWarn` / `healthCritical` | 90 / 70 | 健康分预警与严重分档 |
| `engine.backlogWarn` / `backlogCritical` | 50 / 200 | 队列积压分档 |
| `engine.errorRateWarn` / `errorRateCritical` | 0.05 / 0.15 | 错误率分档，以 0–1 比例配置 |
| `engine.apdexThresholdMs` | 100 | Apdex 满意时长；容忍范围至该值的 4 倍 |

系统任务 `workflow-engine-health-capture` 每 5 分钟采集一次平台整体内省，写入 `workflow_engine_health_snapshots`。每个快照保存健康分、严重程度、队列汇总、事件错误率、严重 / 警告问题数和运行中实例数。健康趋势缺省读取近 24 小时，可查询至 30 天，最多返回 5000 个点；返回的阈值是当前生效设置。

快照的 backlog 汇总内省各队列 ready、running、delayed、failed 数量，可能包含人工待办和等待对象。事件错误率基于事件分发数据，作业失败率则基于执行尝试；不能用快照 backlog 或事件错误率代替账本的到期积压和作业失败率。

## 恢复动作

恢复动作按类型圈定账本作业，处理到期 pending 和失效租约 running，跳过未到期计划。动作支持实例、入库时长和处理上限筛选，缺省上限 200、最大 500，可先预览数量与样本。

| 动作 | API action | 作业类型 |
| --- | --- | --- |
| 重放事件派发 | `replay-outbox` | `event_dispatch` |
| 恢复触发器重派 | `recover-triggers` | `trigger_dispatch` |
| 恢复延时任务 | `recover-delays` | `delay_wake` |
| 处理超时任务 | `process-timeouts` | `task_timeout` |
| 恢复子流程 | `recover-subprocess` | `subprocess_spawn` / `subprocess_join` |
| 恢复 Webhook 投递 | `recover-webhooks` | `webhook_delivery` |

动作结果中的 `recovered` 是回收的失效租约数，`requeued` 是已提交唤醒提示覆盖的作业数，`dead` 是回收时因尝试耗尽或外部结果不明进入死信的数量。它们表示恢复扫描与补投结果，业务执行仍由 worker 领取账本完成。

这些动作不会直接重试 dead / failed 作业。死信需要先核对错误和外部结果，再使用[作业重试与条件重放](./jobs.md#查询、重试与重放)。`automation_action`、`schedule_launch`、外部审批和补偿动作也可在作业账本按类型查询与处置。

## 系统告警

`告警中心 → 告警规则` 使用统一规则、持续时长抑制、静默和通知派发；`告警中心 → 告警事件` 跟踪告警处理。工作流指标的来源如下：

| 指标 | 来源与口径 |
| --- | --- |
| 流程引擎健康分 `workflowHealth` | 最新平台健康快照的综合分 |
| 流程引擎队列积压 `workflowBacklog` | 最新快照的各队列汇总，含 ready / running / delayed / failed |
| 流程作业死信数 `workflowDeadLetter` | 实时读取 `dead` 作业数 |
| 流程作业失败率 `workflowFailureRate` | 近一小时创建的执行尝试中 failed 的百分比 |
| 流程作业卡死数 `workflowStuckRunning` | 实时读取租约失效或超过执行截止时间的 running 数 |

告警评估器缺省每分钟读取指标，但健康分和引擎队列积压仍受 5 分钟快照节奏影响。没有快照时这两项返回 100 / 0；应同时检查采集任务与快照时间，避免把缺采样当成已经完成巡检。上述指标为平台整体口径，通知渠道和告警权限见[监控与告警](../ops/observability.md)。

## 运行配置

进程与网络配置来自 `packages/server/.env` 或部署环境；可在后台修改的健康阈值来自上面的运行时设置模块。完整配置与多实例部署见[部署说明](../guide/deployment.md#后端部署)。

| 配置 | 工作流中的作用 |
| --- | --- |
| `ZENITH_ROLES` | `api` 提供 API、回调和 WebSocket 入口；`worker` 执行作业池、调度扫描、事件分发与归档队列；`all` 同时运行两种角色。仅开发环境允许缺省 all，其余环境必须显式设置 |
| `WORKER_HEALTH_PORT` | 纯 worker 的 `/health`、`/ready`、`/metrics` 端口，缺省 3301；纯 worker 不提供业务 HTTP 路由 |
| `WORKFLOW_OUTBOUND_ALLOWED_HOSTS` | 为确需访问内网的工作流出站目标设置精确允许清单，逗号分隔，支持 host、`*.suffix` 与 CIDR；缺省不放行内网，保存和执行时都继续校验 |
| `PUBLIC_BASE_URL` | 对外可达的服务基址，缺省 `http://localhost:3300`；用于触发器回调 URL、审批单验真链接等公开地址，必须与接收方 / 扫码者实际可访问的入口一致 |

API 与 worker 共享同一数据库，后台事件产生的 WebSocket 推送经 Redis 扇出到 API 节点。只有 API 可用不能证明工作流后台执行正常，应同时检查 worker 就绪探针、已注册执行池心跳与[作业运行状态](./jobs.md#运行状态面板)。出站允许清单不替代连接器同源约束、DNS 固定校验和禁止重定向，详见[出站安全](./connectors.md#出站安全)。

## 数据保留

每日 `data-retention` 按数据保留策略清理观测与运行数据。终态实例的 `workflow_tokens` 缺省保留 90 天，只处理通过、驳回、撤回、取消实例；超过保留期后，Token 轨迹不再完整。`system_scheduler_nodes` 按最后心跳清理，缺省保留 7 天；近 10 分钟的 Worker 可见窗口是运行面板口径，与物理保留期独立。健康快照的保留同样由数据保留策略管理。

## API 与权限

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/api/workflows/health` | `workflow:health:view` |
| `GET` | `/api/workflows/engine/introspection` | `workflow:instance:monitor` |
| `GET` | `/api/workflows/engine/health-history` | `workflow:instance:monitor` |
| `POST` | `/api/workflows/engine/actions/{action}/preview` | `workflow:instance:monitor` |
| `POST` | `/api/workflows/engine/actions/{action}` | `workflow:engine:operate`，写操作审计 |

实例诊断、挂起 / 恢复、强制跳转和 Token 干预的权限见[权限与范围控制](./permissions.md)。
