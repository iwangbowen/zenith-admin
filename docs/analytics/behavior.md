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

`POST /api/analytics/funnel` —— 自定义多步转化漏斗。每步可按 `eventType` / `eventName` / `pagePath` / `elementKey` 定义，返回各步用户数、整体转化率、步间转化率与流失数。

```jsonc
// 请求体示例
{ "days": 30, "steps": [
  { "label": "进入首页", "pagePath": "/" },
  { "label": "浏览列表", "eventName": "$pageview" },
  { "label": "提交订单", "eventName": "order_submit" }
] }
```

## 留存分析

`GET /api/analytics/retention?days=N` —— 按首次访问日期分群的 cohort 留存数据（Day0…最多 Day7），前端以折线图展示，每条折线为一个同期群的留存率衰减曲线。

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
