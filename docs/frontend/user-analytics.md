# 用户行为埋点分析

Zenith Admin 内置了轻量级的前端用户行为分析系统，无需外部服务即可收集**页面停留时长**、**功能使用频率**和**点击热力图**数据，帮助你了解用户真实行为，持续优化产品体验。

## 架构概览

```
前端 Tracker SDK (tracker.ts)
    ↓  内存缓冲，每 30s 或 50 条批量上报
POST /api/analytics/events
    ↓  批量写入 PostgreSQL
user_events 表
    ↓  聚合分析接口
GET /api/analytics/page-stats     页面停留时长
GET /api/analytics/feature-stats  功能使用频率
GET /api/analytics/heatmap        点击热力图
GET /api/analytics/heatmap-pages  有热力图数据的页面列表
```

所有数据均与当前登录用户（`userId`）和租户（`tenantId`）关联，支持多租户隔离。

---

## 快速接入（3 步）

### 第一步：追踪页面停留时长

在页面组件顶部调用 `usePageTracker` hook，**1 行代码**，无需其他改动：

```tsx
// packages/web/src/pages/users/UsersPage.tsx
import { usePageTracker } from '@/hooks/usePageTracker';

export default function UsersPage() {
  usePageTracker('用户管理');  // ← 只加这 1 行
  // ...其余代码不变
}
```

hook 会自动在路由进入时记录 `page_view` 事件，路由离开时记录 `page_leave` 事件（携带 `durationMs`）。

---

### 第二步：追踪功能点击频率

在现有按钮的 `onClick` 中追加一行 `trackFeature()` 调用：

```tsx
import { trackFeature } from '@/utils/tracker';

// 搜索按钮
<Button onClick={() => { trackFeature('search-btn', '查询', 'search-toolbar'); handleSearch(); }}>
  查询
</Button>

// 新增按钮
<Button onClick={() => { trackFeature('create-btn', '新增', 'search-toolbar'); openCreate(); }}>
  新增
</Button>

// 导出按钮
<Button onClick={() => { trackFeature('export-btn', '导出', 'search-toolbar'); handleExport(); }}>
  导出
</Button>
```

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `elementKey` | `string` | 稳定的标识符，如 `create-btn`、`export-btn`，用于统计聚合 |
| `elementLabel` | `string` | 人类可读标签，如 `新增`、`导出`，显示在分析面板中 |
| `componentArea` | `string`（可选）| UI 区域，如 `search-toolbar`、`table-actions`、`form` |

---

### 第三步：追踪点击热力图

给需要分析的容器区域加 `ref` 和 `onClick`，记录点击坐标（以百分比存储，与屏幕分辨率无关）：

```tsx
import { useRef } from 'react';
import { trackAreaClick } from '@/utils/tracker';

export default function UsersPage() {
  const tableRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={tableRef}
      onClick={(e) => trackAreaClick(e.nativeEvent, tableRef.current!, 'table')}
    >
      <ConfigurableTable ... />
    </div>
  );
}
```

坐标范围为 `0–100`（百分比），分析面板会在热力图可视化中还原成位置。

---

## API 参考

### `usePageTracker(pageTitle?)`

```ts
import { usePageTracker } from '@/hooks/usePageTracker';
```

React Hook，自动追踪当前路由的进入/离开。参数 `pageTitle` 为可选的人类可读标题（如 `'用户管理'`）。

---

### `trackFeature(elementKey, elementLabel, componentArea?)`

```ts
import { trackFeature } from '@/utils/tracker';
```

手动埋点，记录一次功能操作（`feature_use` 事件）。通常放在按钮的 `onClick` 回调中。

---

### `trackAreaClick(e, containerEl, componentArea)`

```ts
import { trackAreaClick } from '@/utils/tracker';
```

记录一次区域点击（`area_click` 事件），用于热力图分析。

| 参数 | 类型 | 说明 |
|------|------|------|
| `e` | `{ clientX: number; clientY: number }` | React `MouseEvent` 或原生 `MouseEvent` |
| `containerEl` | `HTMLElement` | 容器元素，用于计算点击的相对坐标 |
| `componentArea` | `string` | 区域标识符，如 `'table'`、`'search-toolbar'` |

---

### `trackPageView(pagePath, pageTitle?)`  /  `trackPageLeave(pagePath, durationMs, pageTitle?)`

底层函数，`usePageTracker` 内部已调用。如需在非路由场景（如 Modal、Tab 切换）手动记录，可直接使用。

---

## 数据上报机制

Tracker SDK 采用**内存缓冲 + 批量上报**策略，减少请求数量：

- **定时上报**：每 30 秒自动上报一次缓冲区内的所有事件
- **缓冲区满**：事件数达到 50 条时立即上报
- **页面关闭**：监听 `pagehide` 和 `visibilitychange` 事件，页面隐藏/关闭时通过 `navigator.sendBeacon` 可靠上报（保证数据不丢失）

每个浏览器 tab 有独立的 `sessionId`（存储在 `sessionStorage`），用于区分不同会话。

---

## 分析仪表盘

数据收集完成后，可在管理后台的 **数据分析 → 行为分析** 页面（`/analytics/behavior`）查看三个维度的分析结果：

### 页面停留时长

展示各页面的平均停留时长（秒），按时长降序排列，帮助发现用户最关注的页面。

![停留时长示意](https://placeholder.com/analytics-dwell.png)

### 功能使用频率

展示各功能按钮的点击次数，按频次排列，发现最常用和最少用的功能。

### 点击热力图

选择页面路径后，以百分比坐标渲染点击密度分布图，颜色越深表示点击越密集。

---

## 数据库结构

事件数据存储在 `user_events` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `serial` | 主键 |
| `user_id` | `integer` | 关联用户（可为空，未登录时） |
| `username` | `varchar(64)` | 用户名快照 |
| `tenant_id` | `integer` | 租户 ID |
| `session_id` | `varchar(36)` | 浏览器 Tab 会话 ID |
| `event_type` | `enum` | `page_view` / `page_leave` / `feature_use` / `area_click` |
| `page_path` | `varchar(256)` | 路由路径，如 `/users` |
| `page_title` | `varchar(128)` | 页面标题，如 `用户管理` |
| `element_key` | `varchar(128)` | 功能标识符，如 `create-btn` |
| `element_label` | `varchar(128)` | 功能标签，如 `新增` |
| `component_area` | `varchar(64)` | 区域，如 `search-toolbar` |
| `click_x` | `real` | 点击横坐标（0–100%） |
| `click_y` | `real` | 点击纵坐标（0–100%） |
| `duration_ms` | `integer` | 停留时长（毫秒，仅 `page_leave`） |
| `created_at` | `timestamptz` | 事件时间 |

---

## 已埋点页面清单

当前已接入 `usePageTracker` 的页面：

| 页面 | 路由 | 功能点 |
|------|------|--------|
| 我的申请 | `/workflow/instances/mine` | 页面停留、查询、重置、发起申请 |
| 待我审批 | `/workflow/tasks/pending` | 页面停留、查询、重置、通过、驳回 |

> 如需为更多页面接入埋点，按照本文档的[快速接入](#快速接入-3-步)步骤操作即可。每个页面仅需 1–3 行代码。
