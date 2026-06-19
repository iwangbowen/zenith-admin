# 错误监控

错误监控页面（`/analytics/errors`）对标 Sentry，提供 Issue 分组、堆栈还原、行为面包屑、状态流转与告警。

## 捕获范围

全局兜底 `useGlobalErrorHandler`（`App` 中挂载一次）自动捕获并上报：

| 类型 | 来源 |
|------|------|
| `js_error` | 未捕获的运行时错误（window error） |
| `promise_rejection` | 未处理的 Promise 拒绝 |
| `resource_error` | 图片 / 脚本 / 样式等资源加载失败 |
| `console_error` | `console.error` 调用 |
| `http_error` | 失败的 fetch/XHR 请求（5xx / 网络错误，由 SDK API 监控转报） |
| `white_screen` | 加载后根节点长时间无内容的疑似白屏 |
| `crash` | 严重崩溃 |

每次上报携带最近 30 条**行为面包屑**（导航 / 点击 / 网络 / 控制台）用于还原现场。

## Issue 分组模型

相同错误按**指纹**聚合为一个 `error_group`（Issue），每次发生记录为一条 `error_event`：

- 指纹 = `hash(tenantId + errorType + 归一化 message + 顶层堆栈帧 + 来源文件)`，含租户因子保证全局唯一。
- 列表 `GET /api/frontend-errors/groups` 支持按状态 / 类型 / 级别 / 关键词筛选。
- 概览 `GET /api/frontend-errors/overview` 提供错误种类、未解决数、总发生次数、影响用户、今日新增、趋势与 Top Issues。

## 详情

`GET /api/frontend-errors/groups/{id}` 返回：

- 错误信息与堆栈；若已上传对应 release 的 Source Map，自动给出**还原后的源码堆栈**（可切换原始 / 还原）。
- 近 14 天发生趋势、浏览器 / 系统分布、影响用户数。
- 最近事件列表，每条可展开查看面包屑、上下文、UA、HTTP 详情。

## 状态流转与指派

`PUT /api/frontend-errors/groups/{id}`：

- 状态：未解决 / 已解决 / 已忽略 / 已静音；标记已解决记录 `resolvedAt`，**再次发生自动重开**（回归检测）。
- 指派处理人、修改级别、添加处理备注。
- 支持批量改状态（`POST /groups/batch-status`）与批量删除（`DELETE /groups/batch`）。

## Source Map 堆栈还原

在「Source Map」Tab 上传打包产物的 `.map` 文件（按 `release` + 文件名，文件名需与压缩堆栈中的 bundle 名一致，如 `index-abc.js`）：

- `POST /api/frontend-errors/source-maps`（replace 语义，重复上传覆盖）。
- 详情页自动将压缩堆栈逐帧映射回源码位置（基于 `source-map` 库）。

## 告警规则

在「告警规则」Tab 配置（权限 `monitor:alert:manage`）：

- **条件**：新错误（`new_error`）/ 阈值（`threshold`）/ 激增（`spike`）。
- 可按错误类型、级别过滤；设置阈值次数与时间窗口。
- **通知渠道**：邮件 / Webhook / 站内。
- 定时任务 `evaluateErrorAlerts`（每 5 分钟）评估规则，命中后去抖并推送，记录 `lastTriggeredAt`。
