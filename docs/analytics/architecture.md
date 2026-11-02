# 架构与数据模型

## 数据表（23 张）

### 行为采集与分析

| 表 | 说明 |
|----|------|
| `user_events` | 原始事件流（幂等 `eventId` 唯一索引、`properties` JSONB、UTM、身份、设备、地域、性能指标、多端平台字段 `source`/`appId`/`environment`/`sdkVersion`；包含时间、租户、事件名、来源、性能与 JSONB 属性等查询索引） |
| `analytics_identity_map` | 匿名 `anonymousId` 到权威 `distinctId` 的首绑映射，支撑匿名批次前向合并与 `$identify` 后的历史回溯合并 |
| `analytics_sessions` | 会话聚合（时长 / 页数 / 事件数 / 入口出口页 / 是否跳出 / 设备与地域） |
| `analytics_daily_rollup` | 每日预聚合，维度化窄表（`tenantId` + `statDate` + `metric` + `dimType` + `dimValue` + `value`）：`dimType='overall'` 存整体 PV/UV/会话/事件/跳出/停留总量，另按 `browser` / `os` / `device` / `region` / `page` 五个低基数维度分别聚合 |
| `analytics_user_profiles` | 用户画像（`distinctId` 主键式唯一、`identityType`、`userId` / `memberId`、首末次活跃、属性袋），采集事务内 upsert，支撑分群属性条件 |
| `analytics_saved_reports` | 保存的分析报表配置（当前支持漏斗 `type='funnel'`，按创建人隔离） |

### 埋点治理

| 表 | 说明 |
|----|------|
| `analytics_event_meta` | 事件字典 / Tracking Plan（事件名全局唯一、`version` 结构性变更自动递增、负责人、`strictMode`、属性 schema 含 `required`/`enumValues`/`pii`） |
| `analytics_event_overrides` | 租户级事件启停覆盖（`tenantId` + `eventName` 唯一） |
| `analytics_event_quality_daily` | 埋点质量问题日聚合（6 种 `issueType`，样例仅存脱敏元信息） |
| `analytics_settings` | 按租户唯一的采集、隐私与保留策略（含 `configVersion` 用于 SDK 热更新） |
| `analytics_sites` | 匿名采集站点（`siteKey` 唯一、`appId`、来源白名单 `allowedOrigins`、日配额 `dailyEventQuota`） |

### 分群 / 实验 / 触达

| 表 | 说明 |
|----|------|
| `analytics_user_segments` | 用户分群定义（AND/OR 规则 JSONB、估算规模、快照时间） |
| `analytics_segment_members` | 分群成员物化快照（`segmentId` + `distinctId` 唯一） |
| `analytics_experiments` | A/B 实验（`expKey` 唯一、变体与权重、参与流量、转化指标、状态机） |
| `analytics_segment_campaigns` | 分群触达活动（渠道 / 内容 / 发送统计 / 状态） |

### 错误监控

| 表 | 说明 |
|----|------|
| `error_groups` | 错误分组（Issue，`fingerprint` 全局唯一索引，状态 / 指派 / 备注） |
| `error_events` | 单次错误事件（堆栈 / 面包屑 / 上下文 / 解析后 UA / HTTP 详情 / 回放关联 `replay_id`） |
| `error_group_identities` | 错误分组影响身份去重表（`groupId` + `identity` 主键），用于增量维护 `affectedUsers` |
| `error_alert_rules` | 错误告警规则（条件、阈值、时间窗口、渠道、收件人、`lastTriggeredAt` 去抖） |
| `error_alert_logs` | 告警触发历史（规则快照、命中详情、投递渠道） |
| `source_maps` | 上传的 Source Map（堆栈还原，`release` + 文件名 replace 语义） |

### 会话回放

| 表 | 说明 |
|----|------|
| `replay_sessions` | 回放会话（客户端 UUID 主键幂等、录制模式 / 状态机 `recording→completed/expired`、触发器 JSONB 数组、聚合列：分片数 / 字节 / 错误 / 翻页 / 点击、平台与身份字段） |
| `replay_segments` | 录像分片（`(replayId, seq)` 唯一重传幂等、rrweb 事件 gzip 后 bytea 直存、时间范围与全量快照标记；随会话级联删除） |

> 修改这些表后需 `npm run db:generate && npm run db:migrate`，并在 `packages/shared/src/seed/{业务域}.ts` 同步菜单/权限。

## 服务端实现

### 路由（`routes/analytics/`）

| 文件 | 挂载点 | 职责 |
|------|--------|------|
| `analytics.ts` | `/api/analytics` | 采集、公开配置、全部分析查询（含对比轴、下钻、获客归因）、事件明细、字典、覆盖、质量、调试、设置、聚合、分群 |
| `analytics-sites.ts` | `/api/analytics` | 站点 CRUD 与 `siteKey` 重新生成 |
| `analytics-experiments.ts` | `/api/analytics` | A/B 实验 CRUD、状态流转、报告、公开分流端点 |
| `analytics-campaigns.ts` | `/api/analytics` | 分群触达活动 CRUD 与执行 |
| `frontend-errors.ts` | `/api/frontend-errors` | 错误上报、Issue 管理、Source Map、告警规则与触发历史 |
| `session-replays.ts` | `/api/session-replays` | 回放分片 ingest、列表 / 详情 / 分片拉流 / 存储统计 / 批量删除 |
| `dashboard.ts` | `/api/dashboard` | 首页工作台的统计卡片与图表（仅登录校验，不属于分析权限体系） |

### Service（`services/analytics/`）

| 文件 | 职责 |
|------|------|
| `analytics.service.ts` | 采集主流程（治理 → 事务写入 → 会话/画像 upsert）与大部分统计查询 |
| `analytics-identity.service.ts` | 匿名身份映射、前向合并与 `$identify` 后历史事件 / 会话 / 画像回溯合并 |
| `analytics-conversion.service.ts` | 漏斗（有序转化）与留存（双口径 + 日/周/月粒度 + 对比轴） |
| `analytics-breakdown.ts` | 统一对比轴：维度 → SQL 表达式白名单、渠道派生、序列解析（漏斗/留存/下钻共用） |
| `analytics-drill.service.ts` | 图表下钻：漏斗步骤 / 留存周期坐标 → 用户名单 |
| `analytics-acquisition.service.ts` | 获客渠道与首次/末次触点归因报表 |
| `analytics-event-query.service.ts` | 通用事件分析查询（白名单维度 + 参数化属性过滤） |
| `analytics-property-filter.ts` | `properties` 属性过滤的 SQL 构造（漏斗 / 事件分析 / 分群共用） |
| `analytics-governance.service.ts` | Tracking Plan 采集治理（屏蔽 / 租户覆盖 / 严格模式 / 质量记录） |
| `analytics-quality.service.ts` | 埋点质量看板与实时事件调试流 |
| `analytics-quota.service.ts` | 站点日配额（Redis 计数，故障 fail-open） |
| `analytics-sites.service.ts` | 站点 CRUD、`siteKey` 解析缓存、来源白名单校验 |
| `analytics-event-meta.service.ts` | 事件字典 / Tracking Plan CRUD 与自动登记 |
| `analytics-event-overrides.service.ts` | 租户级事件启停覆盖 CRUD |
| `analytics-settings.service.ts` | 采集设置读写、`/config` 公开配置解析、配置版本广播 |
| `analytics-rollup.service.ts` | 每日聚合重建（整体 + 维度）与聚合查询 |
| `analytics-segments.service.ts` | 用户分群 CRUD、规则编译（INTERSECT/UNION）、成员物化 |
| `analytics-experiments.service.ts` | A/B 实验 CRUD、SHA-256 确定性分流、实验报告 |
| `analytics-experiment-stats.ts` | 实验统计推断：双比例 Z 检验、SRM 卡方检验、样本量估算（纯函数） |
| `analytics-campaigns.service.ts` | 分群触达活动 CRUD 与提交执行 |
| `analytics-tasks.ts` | 任务中心 handler：聚合重建 / 分群物化 / 触达执行 |
| `analytics-profile.service.ts` | 用户画像 upsert 公共 helper |
| `analytics-server-events.service.ts` | 服务端权威事件写入（`trackServerEvent`） |
| `analytics-server-event-subscribers.ts` | 支付 / 工作流事件总线 → 权威事件桥接 |
| `frontend-errors.service.ts` | 错误上报（指纹分组 / 回归重开 / 回放计数回填）、Issue 查询与管理、Source Map |
| `error-alert.service.ts` | 告警规则 CRUD、评估（定时 + 实时）、去抖、渠道分发、触发日志 |
| `session-replays.service.ts` | 回放分片 ingest（upsert 会话 + 幂等分片 + 聚合累加）、查询 / 拉流、存储配额治理（滚动淘汰 / 硬顶熔断）、僵尸会话收尾、容量统计与告警指标 |
| `dashboard.service.ts` | 首页工作台统计 |

### 公共库与契约

- `lib/analytics-helpers.ts`：UA 解析（ua-parser-js）、错误指纹、Web Vitals 评级、多端平台字段推断。
- `lib/source-map-symbolicate.ts`：堆栈还原（source-map 库）。
- `lib/export-center/definitions/analytics-events.ts`：事件明细导出定义（entity `analytics.events`）。
- 契约（实体 schema 与操作）在 `packages/shared/src/analytics/contracts/`，校验 schema 在 `validation.ts`，枚举常量在 `constants.ts`。

### 关键实现要点

- 采集 / 错误上报 / 实验分流 / 回放分片四个公开端点使用 `optionalAuthMiddleware`，支持匿名上报，分别受 `analytics-ingest` / `error-report` / `analytics-ingest` / `replay-ingest` IP 限流保护；其余端点均在 `authMiddleware` + `guard()` 之后。
- UA 解析复用 `ua-parser-js`，IP → 地域复用离线库 `node-ip2region`，无需外部服务。
- 行为事件、会话、画像在同一事务中写入；错误 Issue 与错误事件写入亦在事务中完成；SDK 事件通过 `eventId` 唯一索引实现重试幂等（`ON CONFLICT DO NOTHING`）。
- 生产环境建议配置 `REQUEST_BODY_LIMIT=23068672`（22MiB）：可容纳 20MB Source Map 与 JSON 包装开销，同时给匿名采集入口设置全局请求体上限。
- **服务端权威事件**（`source='server'`）不经 HTTP，由支付持久化领域事件消费者（`payment.analytics`）、`workflowEventBus` 订阅与会员业务 Service 调用点直接写入 `user_events`，与 SDK 采集共用同一张表、同一套治理与查询/漏斗/事件分析能力。详见 [埋点采集 SDK · 服务端权威事件](./tracking#服务端权威事件-source-server)。

## 数据链路

```text
tracker.ts / error-reporter.ts / replay.ts（@zenith/analytics-sdk）
  ↓ POST /api/analytics/events 或 POST /api/frontend-errors 或 POST /api/session-replays/segments
routes/analytics/analytics.ts / frontend-errors.ts / session-replays.ts
  ↓ 站点 siteKey 解析（匿名）→ 来源白名单校验
  ↓ Tracking Plan 治理（屏蔽 / 租户覆盖 / 严格模式，质量问题落 analytics_event_quality_daily）
  ↓ 事务写入：user_events（eventId 幂等）→ 站点日配额消费（Redis）→ analytics_sessions → analytics_user_profiles
  ↓ $identify best-effort：analytics_identity_map → 历史匿名事件 / 会话 / 画像合并
  ↓ 回放分片：配额检查（滚动淘汰 / 硬顶）→ upsert replay_sessions → replay_segments（bytea）→ 聚合累加
  ↓ WebSocket analytics:ingest 节流广播（5s），前端实时 Tab 收到后刷新
user_events / analytics_sessions / analytics_user_profiles / error_groups / error_events / replay_sessions / replay_segments
  ↓ 查询接口实时聚合，定时任务维护 analytics_daily_rollup 与保留清理
packages/web/src/pages/analytics/*

支付领域事件消费者 payment.analytics / workflowEventBus / 会员 Service 调用点（成功后 best-effort）
  ↓ analytics-server-event-subscribers.ts（持久化消费者 / 总线 onAny 映射）或直接调用
services/analytics/analytics-server-events.service.ts::trackServerEvent()
  ↓ queueMicrotask 异步、治理复用、eventId 幂等（ON CONFLICT DO NOTHING）
user_events（source='server'，不创建 analytics_sessions）
  ↓ 与 SDK 事件混合参与既有查询 / 漏斗 / 事件分析接口，无需新增 API
```

### WebSocket 事件

| 事件 | 触发点 | 消费方 |
|------|--------|--------|
| `analytics:ingest` | 事件批量落库后按租户 5 秒节流广播 | 行为分析页「实时」Tab 收到后立即刷新实时数据 |
| `analytics:config-updated` | 采集设置保存后广播 `tenantId`（不下发配置内容） | `AdminLayout` 匹配当前租户视角后调用 `reloadTrackerConfig()` 热更新 SDK |

## 定时任务与异步任务

### pg-boss 定时任务

| Handler | 频率 | 作用 |
|---------|------|------|
| `analyticsRollupDaily` | 每日 01:00 | 重建最近 2 个完整自然日的每日聚合（整体 + 维度） |
| `data-retention`（系统任务） | 每日 03:00 | 平台统一数据保留清理：逐租户按 `retentionDays` / `errorRetentionDays` / `replayRetentionDays` 清理过期埋点、会话、错误、埋点质量日聚合与会话回放（回收空错误分组、录像分片级联删除） |
| `analyticsSegmentRefresh` | 每日 03:30 | 重算全部启用中的用户分群成员快照（单个分群失败不阻塞整批） |
| `evaluateErrorAlerts` | 每 5 分钟 | 评估错误告警规则并通知（`new_error` 条件另有错误上报时的实时评估） |
| `finalizeStaleReplays` | 每 5 分钟 | 把断流超 10 分钟的 `recording` 回放会话标记为已超时（标签页被杀等场景收尾） |

注册于 `lib/pg-boss-scheduler.ts` 与 `lib/system-tasks.registry.ts`，种子数据见 `packages/shared/src/seed/platform.ts` 的 `SEED_CRON_JOBS`。

### 任务中心异步任务（`analytics-tasks.ts`）

| 任务类型 | 触发入口 | 说明 |
|----------|----------|------|
| `analytics-rollup-rebuild` | `POST /api/analytics/rollup/rebuild` | 手动重建近 N 天聚合；幂等键含用户与日期，同日重复提交被拦截 |
| `analytics-segment-materialize` | `POST /api/analytics/segments/{id}/materialize` | 分群成员重算；幂等键含规则版本与分钟桶 |
| `analytics-campaign-execute` | `POST /api/analytics/campaigns/{id}/execute` | 分群触达执行（email / 站内信 / webhook），`maxAttempts: 1` 不自动重试 |

## 权限码

| 权限码 | 含义 |
|--------|------|
| `analytics:view` | 行为分析查询（概览 / 趋势 / 漏斗 / 留存 / 实验报告 / 保存报表等） |
| `analytics:manage` | 数据管理：事件明细 / 字典 / 覆盖 / 质量 / 调试 / 设置 / 聚合 / 分群 / 站点 / 实验与触达管理 |
| `analytics:clean` | 清理埋点数据 |
| `analytics:export` | 导出埋点事件（走导出中心） |
| `monitor:error:list` | 查看错误监控 |
| `monitor:error:manage` | 处理 / 删除错误、上传与删除 Source Map、清除错误数据 |
| `monitor:alert:list` | 查看告警规则与触发历史 |
| `monitor:alert:manage` | 管理告警规则、测试发送 |
| `monitor:replay:list` | 查看会话回放（列表 / 详情 / 播放 / 存储统计） |
| `monitor:replay:manage` | 删除回放 |

## 多租户隔离

- 行为事件、会话、画像、分群、实验、触达、错误分组、错误事件、Source Map、告警规则与会话回放按 `tenantId` 隔离；分析查询和存在性校验使用 `tenantScope()`。
- 登录态 SDK 配置与 IP 匿名化策略按当前租户读取；匿名请求按站点 `siteKey` 解析归属租户，无站点时使用平台级（`tenantId=null`）默认配置。
- 数据保留任务逐租户执行，未配置的租户使用埋点 180 天、错误 90 天默认值。
- 错误指纹含 `tenantId` 因子，不同租户的相同错误分属不同 Issue。
- 事件字典为平台级全局分类（事件名跨租户共享）；屏蔽、解除屏蔽或删除已屏蔽事件仅允许平台超级管理员。租户如需停用某事件，使用租户级事件覆盖（`analytics_event_overrides`）。
- 服务端权威事件（`source='server'`）同样携带来源业务的 `tenantId`（支付/工作流事件复用总线事件自带的 `tenantId`；会员事件取会员/操作上下文的 `tenantId`，当前会员体系未启用多租户时为 `null`），与 SDK 事件遵循相同的 `tenantScope()` 过滤规则，不单独绕过隔离。
