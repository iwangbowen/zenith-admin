# 数据管理

数据管理页面（`/analytics/data`，权限 `analytics:manage`）用于查阅原始埋点、治理事件字典、查看聚合并配置采集与保留策略。

## 事件明细

`GET /api/analytics/events` —— 原始事件分页列表，支持多维筛选：

- 事件类型、事件名、用户名、页面路径、设备类型
- **日期范围**（`startTime` / `endTime`，`YYYY-MM-DD HH:mm:ss`）

点击某条事件打开详情侧边栏（`GET /api/analytics/events/{id}`），展示完整字段：身份（distinctId / anonymousId）、属性袋 `properties`、来源（referrer / UTM）、环境（浏览器 / 系统 / 设备 / 分辨率 / 语言 / UA）、地域（IP / 国家 / 城市）、性能指标等。

### 数据清理

- 清除数据（权限 `analytics:clean`）：`DELETE /api/analytics/clean?days=N`（删除 N 天前数据，`days=0` 清空），同步清理会话。

## 事件字典（埋点治理）

`GET /api/analytics/event-meta` —— 事件元数据管理，登记每个 `eventName` 的显示名、分类、描述、属性 schema 与状态（启用 / 废弃 / 屏蔽），并统计触发次数与首次/最近时间；支持关键词、状态、分类筛选。

- 采集时自动登记带显式 `eventName` 的事件（`touchEventMeta`）。
- 支持手动 CRUD：`POST` / `PUT /{id}` / `DELETE /{id}`。
- 事件字典为**平台级全局分类**（事件名全局唯一，跨租户共享）；将事件置为/移出 `blocked`，以及删除已屏蔽事件，仅允许平台超级管理员。

## 数据聚合

`GET /api/analytics/rollup?days=N` —— 展示每日预聚合指标（PV / UV / 会话 / 事件 / 跳出会话 / 总停留时长），来自 `analytics_daily_rollup` 表。

- 定时任务 `analyticsRollupDaily`（每日 01:00）自动重建最近 2 个完整自然日的聚合。
- 可点击「重建聚合」手动触发 `POST /api/analytics/rollup/rebuild?days=N`。
- 趋势查询默认实时计算；聚合表用于长周期 / 大数据量提速。

## 采集设置

`GET` / `PUT /api/analytics/settings` —— 采集与保留配置，可调整：

| 配置 | 说明 |
|------|------|
| `enabled` | 采集总开关 |
| `sampleRate` | 采样率 0–1 |
| `trackPageviews` / `trackClicks` / `trackPerformance` / `trackErrors` / `trackApi` | 采集项配置 |
| `maskInputs` | 输入框脱敏 |
| `respectDnt` | 尊重浏览器 Do Not Track |
| `blacklistPaths` | 路径黑名单 |
| `retentionDays` / `errorRetentionDays` | 埋点 / 错误数据保留天数 |
| `sessionTimeoutMinutes` | 会话超时分钟配置 |

登录用户读取当前租户配置；匿名 SDK 使用平台级默认配置。设置保存后，已打开页面需刷新后重新拉取（运行时热更新在后续阶段实现）。

## 数据保留策略

定时任务 `analyticsRetention`（每日 02:00）逐租户读取 `retentionDays` / `errorRetentionDays`，分别清理各租户过期埋点、会话与错误数据，并删除已无事件的空错误分组。没有配置记录的租户使用 180 / 90 天默认值。

## 用户分群

权限 `analytics:manage`。用户分群用于圈定满足特定事件 / 属性条件的 `distinctId` 集合，供漏斗分析（`segmentId`）与事件分析工作台（`segmentId`）复用。

- `GET` / `POST /api/analytics/segments`：分群列表 / 创建；`GET` / `PUT` / `DELETE /api/analytics/segments/{id}`：详情 / 更新 / 删除。
- 规则 `rules: { operator: 'AND'|'OR', conditions: [...] }`，最多 10 条条件，仅支持两类条件：
  - **事件条件**（`type: 'event'`）：`eventName` + 观察窗口天数 + 最少发生次数 `minCount` + 属性过滤（同事件分析工作台的 `propertyFilters`）。
  - **属性条件**（`type: 'attribute'`）：针对 `analytics_user_profiles` 的 `identityType` / `userId` / `memberId` 或任意 `property.<key>`（`key` 经严格正则校验，禁止拼接任意列名）。
  - 不支持分群嵌套分群（规则条件中不能引用其他 `segmentId`），避免循环依赖与未受控的联表爆炸。
  - AND 语义使用 SQL `INTERSECT`、OR 语义使用 SQL `UNION` 合并各条件命中的 `distinctId` 集合，全程不在 Node 侧加载全量 ID 到内存后再比对。
- **物化**：`POST /api/analytics/segments/{id}/materialize` 通过任务中心异步执行（任务类型 `analytics-segment-materialize`，`allowConcurrent: false`，`maxAttempts: 2`），事务内先清空旧快照再 `INSERT ... SELECT` 写入新成员（含 `tenantId` / `identityType` / `userId` / `memberId`），完成后更新 `estimatedSize` 与 `snapshotAt`；同日重复提交由幂等键（`任务类型:分群ID:日期`）拦截，避免重复重算。任务执行时会重新校验分群仍属于创建者租户。
- `GET /api/analytics/segments/{id}/members`：分页查看物化后的成员快照。
- 前端「数据管理」页「用户分群」Tab：列表 + 状态/关键词搜索、创建/编辑弹窗（可视化规则编辑器，支持 AND/OR 与事件/属性两类条件的可视化拼装）、「重算成员」按钮（提交后跳转任务中心跟踪进度）、成员侧边栏。

## 报表中心复用

行为分析数据无需新建报表数据源或执行器：直接复用内置主库数据源（`datasourceId=1`），在种子数据 `SEED_REPORT_DATASETS` 中新增 3 个只读参数化 SQL 数据集（行为事件趋势 / 来源分布 / 埋点质量趋势），并提供配套「行为分析概览」看板（`SEED_REPORT_DASHBOARDS`），从而直接获得报表中心已有的分享、订阅、导出能力，无需为行为数据重复实现。

- 数据集 SQL 均通过系统参数 `${__tenantId}` 与 `(${__tenantId}::int IS NULL OR tenant_id = ${__tenantId})` 模式支持「平台超管全局视角（`__tenantId` 为 `NULL`）」与「租户视角（`__tenantId` 为具体租户 ID）」双重语义，与报表中心其余数据集写法保持一致。
- `report-dataset.service.ts` 的 `buildSystemParams` 通过 `getEffectiveTenantId(user)` 计算 `__tenantId`：平台超级管理员在切换租户视角浏览时，注入的是「当前选中的租户视角」而非管理员自身租户，避免视角切换时误泄露/误过滤其他租户数据。


## 站点管理与 site key

行为中心阶段 2 引入 `analytics_sites` 站点模型。站点使用服务端生成的 `siteKey`（格式 `zk_` + 32 位随机 hex）标识匿名采集来源，并绑定 `tenantId` 与 `appId`。平台级站点的 `tenantId` 为 `null`。

SDK 可在请求头 `X-Analytics-Site-Key`（或 `/api/analytics/config?siteKey=...`）携带 site key。匿名请求解析成功后，公开配置按站点租户读取并返回 `siteId/appId`；事件上报归属到站点租户，并强制使用站点 `appId`。登录态请求始终身份优先，会忽略 site key。

种子数据包含两个平台默认站点：管理后台（`appId=admin`，`zk_admin_default_0000000000000000`）和会员端（`appId=member`，`zk_member_default_000000000000000`）。

来源白名单 `allowedOrigins` 为空或 `null` 表示不限制；配置后仅匿名且命中 site key 的事件/错误上报会校验请求 `Origin`，按 trim、去尾斜杠、大小写不敏感后的 origin 精确匹配。缺失或不匹配会整批静默成功但拒收，并在埋点质量看板记录 `origin_rejected`。

日配额 `dailyEventQuota` 为空表示不限；配置后按应用时区自然日使用 Redis key 计数（`analytics:quota:{siteId}:{YYYYMMDD}`），事件采集在 Tracking Plan 治理后按实际新落库事件数消费配额。超限批次整批静默成功但拒收，并在埋点质量看板记录 `quota_exceeded`。站点列表展示 Redis 中的今日用量；Redis 不可用时采集 fail-open，避免影响业务。
