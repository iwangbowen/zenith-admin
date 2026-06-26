# 定时任务

定时任务模块基于 **pg-boss**（PostgreSQL 队列库）实现，支持在后台 UI 中创建、修改状态、手动执行任务，并可查看每次执行的历史日志。pg-boss 的核心优势是：

- **精确一次执行**：基于 PostgreSQL `SKIP LOCKED`，多进程/多机器部署时不会重复执行
- **进程重启持久化**：调度配置存储在数据库，重启后无需重新加载
- **内置指数退避重试**：任务失败后可自动按指数间隔重试

## 概念说明

| 概念 | 说明 |
|------|------|
| **Handler（处理器）** | 实际执行业务逻辑的 TypeScript 函数，需在代码中预先注册 |
| **任务（Job）** | 在后台 UI 中创建，将 Cron 表达式与某个 Handler 关联起来 |
| **执行日志** | 每次任务执行（手动或定时）的详情记录，包含开始/结束时间、状态、输出 |
| **统计概览** | 汇总任务总数、启用数、运行中数量、今日成功/失败次数和单任务成功率 |

## 菜单入口

**系统管理 → 定时任务**（路由：`/system/cron-jobs`，权限：`system:cronjob:list`）

## Cron 表达式格式

兼容标准 5 段式 Cron 与带秒的 6 段式 Cron，统一按 `Asia/Shanghai` 时区调度：

```text
┌───── 分钟 (0–59)
│ ┌───── 小时 (0–23)
│ │ ┌───── 日期 (1–31)
│ │ │ ┌───── 月份 (1–12)
│ │ │ │ ┌───── 星期 (0–7，0 和 7 均表示周日)
│ │ │ │ │
* * * * *
```

6 段式表达式在最左侧增加「秒」字段。

常用示例：

| 表达式 | 含义 |
|--------|------|
| `0 2 * * *` | 每天凌晨 2 点执行 |
| `*/15 * * * *` | 每 15 分钟执行一次 |
| `0 9 * * 1` | 每周一上午 9 点执行 |
| `0 0 1 * *` | 每月 1 日零点执行 |
| `30 0 2 * * *` | 每天 02:00:30 执行 |

UI 中提供 Cron 表达式校验按钮，填写后可即时验证格式是否正确。

## 如何注册新的 Handler

Handler 在 `packages/server/src/lib/pg-boss-scheduler.ts` 中通过内部 `handlerRegistry.set(name, fn)` 静态注册。添加新 Handler 需直接修改该文件：

```typescript
// packages/server/src/lib/pg-boss-scheduler.ts
// 在现有 handlerRegistry.set(...) 区块中追加：
handlerRegistry.set('myNewTask', async (params) => {
  // 任务业务逻辑
  return `执行自定义任务：${params ?? 'no params'}`;
});
```

> **注意**：无法从外部模块动态注册 Handler，必须直接编辑 `pg-boss-scheduler.ts`。
> 修改后，在后台「定时任务」页面的「处理器」下拉框中即可看到该 Handler，并为其配置触发时间。

已注册的系统 Handler 包括：`cleanExpiredCaptchas`、`cleanExpiredSessions`、`echo`、`databaseBackup`、`retryWorkflowEventDeliveries`、`processWorkflowTaskTimeouts`、`publishScheduledAnnouncements`、`cleanupTerminalRecordings`、`closeExpiredPaymentOrders`、`paymentReconciliation`、`dispatchPaymentEvents`、`analyticsRollupDaily`、`analyticsRetention`、`evaluateErrorAlerts`、`sampleSystemMetrics`、`evaluateMonitorAlerts`、`cleanupSystemMetrics`。

## 重试与执行

- 启用任务会调用 pg-boss `schedule()` 写入调度计划；停用或删除任务会 `unschedule()` 对应队列。
- 队列名使用 `cron-job-{id}`，避免中文任务名与 pg-boss 队列命名规则冲突。
- `retryCount` 大于 0 时启用 pg-boss 重试；`retryInterval` 单位为秒；`retryBackoff=true` 时启用指数退避。
- `monitorTimeout` 会映射为 pg-boss 的 `expireInSeconds`，用于限制单次执行最长时间。
- Handler 执行前写入 `running` 日志，成功后更新为 `success`，异常后更新为 `fail` 并截断保存错误信息。
- 任务失败时会向创建者推送「定时任务执行失败」聊天卡片；找不到创建者时尝试推送给系统管理员 `admin`。

## 相关接口

| 接口 | 说明 |
|------|------|
| `GET /api/cron-jobs` | 获取任务列表（支持按名称筛选） |
| `GET /api/cron-jobs/{id}` | 获取任务详情 |
| `POST /api/cron-jobs` | 创建任务 |
| `PUT /api/cron-jobs/{id}` | 更新任务 |
| `DELETE /api/cron-jobs/{id}` | 删除任务 |
| `POST /api/cron-jobs/{id}/run` | 立即执行一次（不影响定时计划） |
| `PUT /api/cron-jobs/{id}/status` | 更新任务状态（`enabled` / `disabled`） |
| `GET /api/cron-jobs/logs` | 查看全部执行日志（分页） |
| `GET /api/cron-jobs/{id}/logs` | 查看单任务执行日志（分页） |
| `DELETE /api/cron-jobs/logs/clean` | 按时间范围清除全部执行日志（`months=0/1/3/6/12`） |
| `DELETE /api/cron-jobs/{id}/logs/clean` | 按时间范围清除单任务执行日志（`months=0/1/3/6/12`） |
| `GET /api/cron-jobs/handlers` | 获取已注册的 Handler 列表 |
| `POST /api/cron-jobs/validate` | 校验 Cron 表达式格式 |
| `GET /api/cron-jobs/stats` | 获取任务统计概览 |

任务列表导出统一通过导出中心创建任务，筛选条件沿用定时任务列表当前提交查询参数。

## 数据库表

- `cron_jobs`：任务定义（名称、Handler、Cron 表达式、状态、描述、重试次数、重试间隔、指数退避、监控超时、最后执行状态）
- `cron_job_logs`：任务执行历史（任务 ID、任务名、执行序号、开始/结束时间、耗时、状态、输出）
- `pgboss.*`：pg-boss 内部表（独立 schema，自动管理），包括队列、调度、归档等
