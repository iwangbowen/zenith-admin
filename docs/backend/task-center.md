# 任务中心（通用异步任务框架）

任务中心为**长耗时操作**（批量处理、导入、数据迁移、报表生成、消息群发等）提供统一的异步任务框架：页面提交任务 → 后台队列执行 → 实时进度展示 → 取消 / 断点恢复 / 重新开始，任务中断或服务重启后可从断点继续。

与「系统调度」是上下两层的关系：

| | 系统调度（调度中心） | 任务中心 |
| --- | --- | --- |
| 管什么 | **执行器**：有哪些 cron / 队列 Worker | **任务实例**：某人提交的某次任务 |
| 粒度 | 每个 Worker 一行 | 每次提交一行（进度 / 断点 / 结果） |
| 给谁看 | 管理员 / 运维（启停、告警、运行日志） | 业务用户（自己任务的进度）+ 管理员（全局监控） |

任务中心的 Worker（`async-tasks`）以「队列 Worker」身份出现在系统调度页面，运维可在那里查看吞吐、运行日志与告警策略；任务实例则在 **系统设置 → 任务中心** 页面全局监控。

## 架构

```text
业务页面提交
   │  POST /api/xxx（业务自己的接口，支持 idempotencyKey 幂等）
   ▼
submitAsyncTask()  ──►  async_tasks 表（status=pending，快照 maxAttempts）
   │                        ▲
   │  pg-boss 入队           │  progress()：进度 + 断点 + 心跳
   ▼                        │  reportItems()：行级明细（async_task_items）
异步任务执行 Worker ──►  handler.run(ctx)
   │                        │
   │                        └─ 抛错且未用尽重试 → pending + nextRunAt（指数退避，断点保留）
   ├─►  WS 推送 task:progress（创建者实时进度）
   └─►  system_scheduler_runs（调度中心运行日志）

兜底扫描（每分钟）：回收心跳超时的卡死任务 → 重投从断点续跑
自动清理（每天 03:30）：删除超过保留期的已结束任务（全局 30 天，类型可覆盖）
```

核心文件：

- `packages/server/src/lib/task-center/` — 框架（registry / config / runner / map）
- `packages/server/src/services/tasks/async-tasks.service.ts` + `routes/tasks/async-tasks.ts` — 查询与操作 API
- `packages/server/src/routes/tasks/task-demo.ts` — 业务接入示例（演示任务类型）
- `packages/web/src/hooks/useAsyncTasks.ts` — 前端实时进度 Hook
- `packages/web/src/components/TaskTray.tsx` — 全局任务托盘（顶栏）
- `packages/web/src/pages/system/task-center/TaskCenterPage.tsx` — 管理端全局监控页（任务列表 / 任务类型策略）
- `packages/web/src/pages/biz/task-demo/TaskDemoPage.tsx` — 业务示例页（可模拟提交）

数据表：`async_tasks`（任务实例）、`async_task_items`（行级明细，可选层）、`async_task_type_configs`（类型级运行时策略）。

## 业务接入三步

### ① 注册任务类型（启动时执行一次）

```ts
import { registerTaskHandler } from '../lib/task-center';

registerTaskHandler({
  taskType: 'member-batch-import',   // 唯一标识
  title: '会员批量导入',              // 默认任务标题
  module: '会员中心',                 // 展示模块
  allowConcurrent: false,            // false：同一用户存在未结束任务时拒绝重复提交
  maxAttempts: 3,                    // 失败自动重试次数（默认 1 = 不重试）
  retryDelayMs: 5000,                // 重试退避基数：5s → 10s → 20s…（上限 15 分钟）
  retentionDays: 90,                 // 可选：该类型已结束任务的保留天数（默认跟随全局 30 天）
  async run(ctx) {
    // 断点恢复：ctx.checkpoint 是上次中断时保存的状态
    let processed = Number(ctx.checkpoint?.processed ?? 0);
    const rows = await loadRows(ctx.payload);

    for (let i = processed; i < rows.length; i++) {
      const ok = await importOne(rows[i]);           // 业务处理
      processed = i + 1;
      await ctx.reportItems([{                       // 行级明细（可选）：按 key 幂等 upsert
        key: `row-${i + 1}`,
        label: rows[i].name,
        status: ok ? 'success' : 'failed',
        message: ok ? null : '数据校验不通过',
      }]);
      const { cancelRequested } = await ctx.progress({
        processed,
        total: rows.length,
        note: `已导入 ${processed}/${rows.length} 条`,
        checkpoint: { processed },                   // 断点随进度一起持久化
      });
      if (cancelRequested) return;                   // 协作式取消
    }
    return { processed };                            // 写入 result 字段
  },
});
```

注册时机：在模块加载时调用（参考 `routes/tasks/task-demo.ts` 的 `registerTaskDemoHandlers()`，于 `index.ts` 启动流程中、任务中心 Worker 注册之前执行）。注册默认值会落库到 `async_task_type_configs`，管理员可在 **任务中心 → 任务类型** 页面覆盖（暂停提交 / 并发 / 重试 / 保留期），运行时以 DB 覆盖值为准。

### ② 业务接口中提交任务

```ts
import { submitAsyncTask, mapAsyncTask } from '../lib/task-center';

const row = await submitAsyncTask({
  taskType: 'member-batch-import',
  title: `会员批量导入（${fileName}）`,   // 可选，覆盖默认标题
  payload: { fileId },                    // handler 自定义入参
  idempotencyKey: `member-import-${fileId}`, // 可选幂等键：重复提交返回同一任务
});
return c.json(okBody(mapAsyncTask(row), '任务已提交'), 200);
```

`submitAsyncTask` 必须在 HTTP 上下文中调用（依赖 `currentUser()`）。提交前检查类型策略：`enabled=false` 抛 400（暂停提交）；`allowConcurrent=false` 且存在未结束任务抛 400；`idempotencyKey` 命中已存在任务时直接返回该任务（唯一索引 + `onConflictDoNothing`，天然防重复点击）。

### ③ 前端展示进度

```tsx
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';

const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: ['member-batch-import'] });
// tasks 通过 WS（task:progress）实时更新；存在进行中任务时每 3s 轮询兜底（Demo 模式无 WS 全靠轮询）
```

进度单元格直接使用 `<AsyncTaskProgress task={task} />`：`totalCount` 有值显示百分比进度条，为 `null` 显示不定进度（Spin + 进度说明）。

## TaskRunContext API

| 成员 | 说明 |
| --- | --- |
| `payload` | 提交时传入的任务参数 |
| `checkpoint` | 上次中断保存的断点状态；首次执行为 `null` |
| `attempt` | 第几次领取执行（首次 1；断点恢复/自动重试/兜底重跑递增；重新开始清零） |
| `progress(update)` | 上报进度：`processed` / `failed` / `total`（`null`=不可枚举）/ `note` / `checkpoint`。同时刷新心跳、持久化断点、WS 推送（300ms 节流）；返回 `{ cancelRequested }` |
| `reportItems(items)` | 批量上报行级明细（`key/label/status/message/data`），按 `taskId+key` 幂等 upsert，重试自动覆盖旧状态；导入等需要逐行错误报告的场景使用，普通任务可不用 |
| `isCancelRequested()` | 单独查询取消标记（`progress` 返回值已包含，通常不需要） |

**约定**：handler 应在每个处理批次后调用 `progress()`——它同时承担心跳职责，超过 90 秒无心跳的 running 任务会被兜底扫描判定为卡死并回收重跑；`checkpoint` 结构完全由 handler 自定义（游标 / 行号 / 阶段名 / syncToken 均可），处理逻辑需要按 checkpoint 幂等（重跑已处理的条目不产生副作用）。

## 自动重试

任务抛错时，若 `attempts < maxAttempts` 且未请求取消，框架自动安排重试而不是直接失败：

- 状态回到 `pending`，`nextRunAt` 设为退避时间点（`retryDelayMs × 2^(attempts-1)`，上限 15 分钟），UI 显示「等待重试」；
- **checkpoint 不清空**——重试从断点续跑，不重复已处理条目；
- 通过 pg-boss `sendAfter` 定时投递；Worker 领取时校验 `nextRunAt` 已到达，兜底扫描不会提前重投退避中的任务；
- 重试用尽后落 `failed`（可手动断点恢复或重新开始），期间任务被取消则直接终止。

## 生命周期与操作

```text
pending ──领取──► running ──✓──► success ─┐
   │取消             │抛错──► failed  ─────┼─► 重新开始（清空进度从头跑）
   ▼                 │取消──► cancelled ───┘        failed / cancelled 另支持
cancelled            │心跳超时（崩溃）                断点恢复（保留 checkpoint 续跑）
                     └──兜底扫描──► pending（断点续跑）
```

| 操作 | 语义 | 适用状态 |
| --- | --- | --- |
| 取消 | pending 直接终止；running 置 `cancelRequested`，handler 在下一次 `progress()` 时感知并退出（协作式） | pending / running |
| 断点恢复 | 保留进度与 checkpoint，重新入队从中断处继续 | failed / cancelled |
| 重新开始 | 清空进度 / 断点 / 结果，从头执行 | success / failed / cancelled |
| 删除 | 删除任务记录（进行中不可删） | 已结束 |
| 清理 | 删除超过 30 天保留期的已结束任务（页面按钮 / 调度中心手动执行 / 每日自动） | — |

**崩溃恢复**：服务重启或进程崩溃时，pg-boss 队列（存于 PostgreSQL）中未消费的任务照常消费；执行中被打断的任务心跳停止，`异步任务兜底扫描`（每分钟）将其回收为 pending 并重投，handler 从 `checkpoint` 继续——这是「任务中断或系统重启后继续之前进度」的关键路径。

## API 一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/async-tasks/types` | 登录 | 已注册任务类型（含生效策略） |
| PUT | `/api/async-tasks/types/{taskType}/config` | `system:async-task:config` | 更新类型运行时策略 |
| GET | `/api/async-tasks/stats` | `system:async-task:list` | 统计概览（状态计数 / 24h 平均耗时 / 7 天趋势） |
| GET | `/api/async-tasks/mine` | 登录 | 我的任务（业务页面进度展示） |
| GET | `/api/async-tasks` | `system:async-task:list` | 全局任务列表（支持提交人筛选） |
| GET | `/api/async-tasks/{id}` | 创建者或 `list` | 任务详情 |
| GET | `/api/async-tasks/{id}/items` | 创建者或 `list` | 任务项明细（行级状态分页） |
| POST | `/api/async-tasks/{id}/cancel` | 创建者或 `manage` | 取消 |
| POST | `/api/async-tasks/{id}/resume` | 创建者或 `manage` | 断点恢复 |
| POST | `/api/async-tasks/{id}/restart` | 创建者或 `manage` | 重新开始（清空明细重新快照策略） |
| POST | `/api/async-tasks/batch-cancel` | `system:async-task:manage` | 批量取消 |
| POST | `/api/async-tasks/batch-delete` | `system:async-task:manage` | 批量删除（仅已结束） |
| DELETE | `/api/async-tasks/{id}` | `system:async-task:manage` | 删除记录 |
| POST | `/api/async-tasks/cleanup` | `system:async-task:cleanup` | 立即清理过期记录 |

WS 事件：`task:progress`（推送给任务创建者，payload 为 `AsyncTask`），见 [WebSocket 事件清单](./websocket-events.md)。

## 全局任务托盘

顶栏「我的任务」入口（`packages/web/src/components/TaskTray.tsx`，挂载于 AdminLayout）跨页面展示当前用户的进行中 / 最近 10 分钟完成的任务：Badge 显示进行中数量，Popover 内实时进度条并支持直接取消。数据源与业务页共享 `useMyAsyncTasks`（WS 实时 + 轮询兜底），提交任务后无论跳到哪个页面都能看到进度。

## 与导出中心的分工

导出中心是**文件导出**这一特定场景的完整方案（列定义 / 脱敏 / 水印 / 下载审计 / 文件保留策略），继续独立使用；任务中心面向**任意业务异步任务**，需要细粒度进度与断点续跑的新场景优先接入任务中心。

## 业务示例

**业务示例 → 异步任务示例**（`/biz/task-demo`）提供两个可交互的演示任务类型：

- `demo-batch`（批量处理演示，可并发，maxAttempts=3）：可配置总条数、单条耗时、**硬失败点**（整个任务失败 → 观察自动重试与断点续跑）与**软失败间隔**（每 N 条失败一条，任务继续 → 行级明细可在「明细」抽屉查看）。
- `demo-serial`（串行阶段演示，不可并发）：多阶段不定进度任务；存在未结束任务时重复提交会被拒绝，演示 `allowConcurrent: false`。

Demo 演示模式（MSW）下按「读取时间推进」模拟任务执行（含自动重试与行级明细），无需后端即可完整体验提交 / 进度 / 取消 / 断点恢复 / 重新开始 / 类型策略调整。
