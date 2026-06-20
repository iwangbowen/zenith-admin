# 数据管理

数据管理页面（`/analytics/data`，权限 `analytics:manage`）用于查阅原始埋点、治理事件字典、查看聚合并配置采集与保留策略。

## 事件明细

`GET /api/analytics/events` —— 原始事件分页列表，支持多维筛选：

- 事件类型、事件名、用户名、页面路径、设备类型
- **日期范围**（`startTime` / `endTime`，`YYYY-MM-DD HH:mm:ss`）

点击某条事件打开详情侧边栏（`GET /api/analytics/events/{id}`），展示完整字段：身份（distinctId / anonymousId）、属性袋 `properties`、来源（referrer / UTM）、环境（浏览器 / 系统 / 设备 / 分辨率 / 语言 / UA）、地域（IP / 国家 / 城市）、性能指标等。

### 导出与清理

- 导出 Excel：`GET /api/analytics/events/export`；导出 CSV：`GET /api/analytics/events/export/csv`（权限 `analytics:export`），沿用事件列表筛选条件。
- 清除数据：`DELETE /api/analytics/clean?days=N`（删除 N 天前数据，`days=0` 清空），同步清理会话。

## 事件字典（埋点治理）

`GET /api/analytics/event-meta` —— 事件元数据管理，登记每个 `eventName` 的显示名、分类、描述、属性 schema 与状态（启用 / 废弃 / 屏蔽），并统计触发次数与首次/最近时间；支持关键词、状态、分类筛选。

- 采集时自动登记带显式 `eventName` 的事件（`touchEventMeta`）。
- 支持手动 CRUD：`POST` / `PUT /{id}` / `DELETE /{id}`。
- 事件字典为**平台级全局分类**（事件名全局唯一，跨租户共享）。

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
| `trackPageviews` / `trackClicks` / `trackPerformance` / `trackErrors` / `trackApi` | 分项采集开关 |
| `maskInputs` | 输入框脱敏 |
| `respectDnt` | 尊重浏览器 Do Not Track |
| `blacklistPaths` | 路径黑名单 |
| `retentionDays` / `errorRetentionDays` | 埋点 / 错误数据保留天数 |
| `sessionTimeoutMinutes` | 会话闲置超时 |

## 数据保留策略

定时任务 `analyticsRetention`（每日 02:00）按 `retentionDays` / `errorRetentionDays` 自动清理过期埋点、会话与错误数据，并删除已无事件的空错误分组。
