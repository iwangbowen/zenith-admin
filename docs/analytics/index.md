# 数据分析与监控 · 总览

Zenith Admin 内置了一套对标 GA4 / PostHog / 神策 / Sentry 的**前端数据分析与错误监控系统**，无需任何外部服务即可完成行为采集、多维分析、错误监控与告警。本章按模块拆分讲解功能与用法。

## 章节导航

| 文档 | 内容 |
|------|------|
| [埋点采集 SDK](./tracking) | 自动采集（页面/点击/性能/API）、手动埋点 API、声明式 `data-track`、上报字段、远程配置、批量上报、离线重试、隐私合规 |
| [行为分析](./behavior) | 概览 KPI、趋势、实时、页面停留、功能使用、会话、漏斗、留存、路径、用户时间线、维度分布、Web Vitals、热力图 |
| [数据管理](./data-management) | 事件明细与导出、事件字典治理、每日聚合、采集设置、数据保留策略 |
| [错误监控](./error-monitoring) | Issue 分组模型、捕获范围、堆栈还原、行为面包屑、状态流转/指派、告警规则 |
| [架构与数据模型](./architecture) | 数据表、API 端点、定时任务、权限码、多租户隔离 |

## 设计理念

- **全自动优先**：页面浏览、元素点击、Web Vitals、API 异常默认全自动采集，无需逐页埋点；需要语义化业务事件时再用 `trackEvent` 显式补充。
- **零外部依赖**：采集、存储、分析、告警全部基于项目自带的 PostgreSQL + Redis + pg-boss，离线可用。
- **多租户隔离**：行为与错误数据按 `tenantId` 隔离；采集端点支持匿名上报（登录前埋点），错误指纹含租户因子保证分组全局唯一，事件字典按事件名全局治理。

## 数据流

```text
前端 Tracker SDK (utils/tracker.ts)
  · 自动采集 + Web Vitals + API 监控 + 批量上报 + 离线重试 + 远程配置
        ↓ 批量上报（匿名/登录均可）
POST /api/analytics/events           埋点事件
POST /api/frontend-errors            错误上报（含面包屑/上下文）
        ↓ 服务端解析 UA / IP、计算指纹、维护会话
PostgreSQL（9 张表）
        ↓ 聚合分析接口
GET /api/analytics/*                 概览/趋势/会话/漏斗/留存/路径/维度/实时…
GET /api/frontend-errors/*           概览/分组/详情(还原)/事件/告警…
        ↓ 定时任务（pg-boss）
analyticsRollupDaily / analyticsRetention / evaluateErrorAlerts
```

## 后台页面与权限

| 页面 | 路径 | 权限码 |
|------|------|--------|
| 行为分析 | `/analytics/behavior` | `analytics:view` |
| 数据管理 | `/analytics/data` | `analytics:manage` / `analytics:export` |
| 错误监控 | `/analytics/errors` | `monitor:error:list` / `monitor:error:manage` / `monitor:alert:list` / `monitor:alert:manage` |

> 超级管理员默认拥有全部权限；其他角色需在「角色管理」中分配对应权限码。
