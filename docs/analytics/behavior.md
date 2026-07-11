# 行为分析

行为分析页面（`/analytics/behavior`，权限 `analytics:view`）以 Tab 形式提供多维度的用户行为洞察，并以折线、面积、柱状、饼图等图表呈现。多数统计接口支持 `days` / `limit` 查询，页面提供近 7 / 30 / 90 天切换；会话列表支持用户名与设备筛选，维度分布支持浏览器、操作系统、设备、地域、来源、引荐与页面维度。

## 概览

`GET /api/analytics/overview?days=N` —— 核心 KPI 卡片，含环比：

- 浏览量 PV、访客数 UV、会话数、事件数、新增用户
- 平均会话时长、跳出率、人均页数
- 实时在线（近 5 分钟活跃访客）
- PV / UV / 会话 / 跳出率的环比涨跌（▲/▼）

下方 `GET /api/analytics/trends?days=N` 渲染 PV/UV/会话/事件的多折线趋势图，支持近 7 / 30 / 90 天切换。

## 实时

`GET /api/analytics/realtime`（每 10 秒轮询）：

- 实时在线、近 30 分钟浏览、近 1 分钟事件
- 近 30 分钟逐分钟事件面积图
- 当前热门页面、最近事件流

## 页面停留

`GET /api/analytics/page-stats` —— 各页面访问次数、平均停留、中位数、P90（基于 `page_leave` 的 `durationMs` 百分位）。

## 功能使用

`GET /api/analytics/feature-stats` —— 功能点击排行（`elementKey` / `elementLabel` / 区域 / 所在页面 / 使用次数）。数据来自 autocapture + 手动 `trackFeature`。

## 会话分析

`GET /api/analytics/sessions` —— 会话列表：用户、入口/出口页、页数、事件数、时长、设备/浏览器/系统、地域、是否跳出。支持按用户名、设备类型筛选。

## 漏斗分析

`POST /api/analytics/funnel` —— 自定义多步**有序**转化漏斗。每步可按 `eventType` / `eventName` / `pagePath` / `elementKey` 定义，并可附加最多 5 条属性过滤（`properties: [{ key, op, value }]`，`op` 支持 `eq|neq|gt|gte|lt|lte|in`）。返回各步用户数、整体转化率、步间转化率、流失数与每步平均转化耗时（`averageConversionMs`，首步为 `null`）。

**转化窗口与顺序语义**：漏斗按用户单调时间线严格计算——第 1 步取每用户最早触发时间作为起点；第 N 步只统计「发生时间 ≥ 上一步命中时间，且 ≤ 首步时间 + `conversionWindowHours`」范围内该用户下一次命中（同一时刻允许）。不再是“时间窗口内命中事件集合的交集”这类无序判定，避免把后续步骤早于前置步骤的行为误计为转化。

- `conversionWindowHours`：转化窗口小时数，1–720，默认 72。
- `segmentId`：可选，限定分群成员参与统计（仅作用于漏斗起点，即第 1 步的候选用户集合）。

```jsonc
// 请求体示例
{ "days": 30, "conversionWindowHours": 72, "segmentId": null, "steps": [
  { "label": "进入首页", "pagePath": "/" },
  { "label": "浏览列表", "eventName": "$pageview" },
  { "label": "提交订单", "eventName": "order_submit",
    "properties": [{ "key": "amount", "op": "gte", "value": 100 }] }
] }
```

## 留存分析

`GET /api/analytics/retention?days=N&mode=first_seen|window_first` —— cohort 留存矩阵（Day0…最多 Day7），前端以热力矩阵呈现，行=同期群、列=第 N 日，单元格颜色深浅表示留存率。

支持两种同期群口径（`mode`，默认 `first_seen`）：

| 口径 | 说明 |
|------|------|
| `first_seen`（默认，真实首访） | 在**租户全部历史数据**中计算每个 `distinctId` 的真正首次出现日期，仅保留首次出现日落在当前分析窗口（`days`）内的用户作为同期群；日期过滤不会提前作用于「首次出现」这一判定本身，避免把老用户误判为新用户 |
| `window_first` | 沿用当前查询窗口内的“窗口内首现日”作为同期群锚点（旧版口径，计算量更小，但可能把窗口起始前已存在的老用户计入某个 cohort） |

响应体包含实际生效的 `mode` 字段，便于前端展示口径说明。

## 事件分析工作台

`POST /api/analytics/events/query` —— 通用事件分析查询，支持按 1–2 个维度分组、多事件名/属性过滤组合筛选，用于替代“为每个新问题写一次专用统计接口”的临时查询场景。

> 服务端权威事件（`source='server'`，如支付、工作流流转、会员注册/积分/优惠券/签到，详见 [埋点采集 SDK · 服务端权威事件](./tracking#服务端权威事件sourceserver)）与前端 SDK 事件写入同一张 `user_events` 表，**无需新增 API**：事件分析工作台的 `eventNames` 下拉、`source` 筛选，以及漏斗分析的每一步定义，均可直接选用/填写这些事件名参与统计。

请求参数：

| 参数 | 说明 |
|------|------|
| `startDate` / `endDate` 或 `days` | 日期范围（`YYYY-MM-DD`），或最近 N 天，默认 30 |
| `eventNames` | 事件名筛选，最多 20 个 |
| `source` / `appId` / `environment` / `device` | 来源 / 应用 / 环境 / 设备筛选 |
| `propertyFilters` | 属性过滤，最多 10 条，`{ key, op, value }` |
| `segmentId` | 可选，仅统计分群成员 |
| `groupBy` | 分组维度白名单，1–2 维：`date` / `eventName` / `pagePath` / `source` / `appId` / `environment` / `browser` / `os` / `deviceType` / `region` |
| `metric` | `events`（事件数，默认）或 `uv`（去重访客数） |
| `limit` | 结果行数上限，最多 200 |

分组维度与属性 key 均通过白名单 / 参数化绑定，禁止任意列名或原始 SQL 片段，防止注入。响应结构：`{ rows: [{ dimensions, value }], total, queryMeta }`。

前端「行为分析」页「事件分析」Tab 提供事件多选（可联动事件字典）、指标与维度选择、来源/环境/日期筛选，并以图表 + 表格双视图展示结果。

## 路径分析

`GET /api/analytics/path?days=N` —— 页面跳转路径：按会话内相邻页面跳转聚合，展示 Top 跳转（来源页 → 目标页 · 次数）。

## 用户行为时间线

`GET /api/analytics/user-stats?days=N&limit=N` —— 用户排行：总事件、页面访问、访问页面数、功能使用、总停留与最近活跃时间。

在「用户分析」Tab 点击某用户打开侧边栏，`GET /api/analytics/user-timeline?userId=X` 返回该用户完整事件序列（时间 + 事件 + 页面/功能），用于单用户行为回溯（轻量级 session replay）。

## 维度分布

`GET /api/analytics/dimension?dimension=X` —— 按浏览器 / 操作系统 / 设备 / 地域 / 来源 / 引荐 / 页面分布，饼图 + 占比表。

## Web Vitals 性能接口

`GET /api/analytics/perf-stats` —— 各性能指标的样本数、均值、P75 / P90 / P99 及评级（good / needs-improvement / poor，按 Web Vitals 阈值）。

## 点击分布

- `GET /api/analytics/heatmap-pages` 列出有区域点击数据的页面与区域；
- `GET /api/analytics/heatmap?pagePath=&componentArea=` 返回归一化坐标点；
- 前端以散点图展示点击落点分布（点大小 / 颜色随点击次数变化）。

> 点击分布依赖手动接入 `trackAreaClick`（见 [埋点采集 SDK](./tracking#手动埋点-api)）。

## 分群触达

用户分群列表的「触达」操作可创建并执行分群触达活动：

- `email`：按分群快照中的会员/管理员邮箱去重发送邮件模板，支持 `{name}` 变量。
- `in_app`：仅对管理员身份创建站内信；会员与匿名身份没有站内信收件箱，会计入失败数。
- `webhook`：使用 SSRF 防护的出站 HTTP 客户端分批 POST（每批 500）成员快照。

执行通过任务中心异步完成。活动状态为 `draft/running/completed/failed`；部分失败仍标记 `completed`，通过 `failedCount` 与 `lastError` 体现。若分群成员快照为空，需先执行分群物化。

## A/B 实验最小闭环

行为中心提供轻量 A/B 实验能力：后台配置实验、SDK 获取分流、自动记录曝光，并在报告中按变体对比转化。

- **分流算法**：服务端对 `expKey:distinctId` 做 SHA-256，取前 8 位十六进制转整数后 `mod 100`。未命中 `trafficAllocation` 的用户不参与实验，也不会产生曝光。命中后按变体 `weight` 区间选择 `variantKey`，同一实验和同一 `distinctId` 的结果稳定。
- **无状态分组**：系统不保存 assignment 表。曝光事件本身即为分组记录，事件名为 `$experiment_exposure`，属性包含 `expKey`、`variantKey`。
- **曝光语义**：SDK `getVariant(expKey)` 命中变体时自动上报曝光；同一会话内同一 `expKey + variantKey` 只上报一次。
- **转化口径**：实验报告以每个用户的首次曝光时间为起点，只统计该用户首次曝光之后发生的指标事件（`metricEventName`）为转化，按变体计算曝光用户数、转化用户数和转化率。
- **运行保护**：实验进入 `running` 后不可修改实验标识、参与流量、变体、转化指标和开始时间，避免历史分流漂移；仅允许更新名称、描述、状态和结束时间。

