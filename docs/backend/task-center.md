# 任务中心（通用异步任务框架）

任务中心为长耗时、可重试、需要进度或需要取消/断点恢复的业务操作提供统一异步执行框架。业务页面提交任务，后端持久化任务实例并投递 pg-boss 队列，Worker 执行注册的 handler，进度通过任务表与 WebSocket 同步到前端。

与「系统调度」的分工：

| | 系统调度（调度中心） | 任务中心 |
| --- | --- | --- |
| 管理对象 | cron / 队列 Worker / 系统周期任务 | 用户提交的业务任务实例 |
| 数据粒度 | 每个执行器与每次运行日志 | 每次任务的状态、进度、断点、结果、行级明细 |
| 主要使用者 | 管理员 / 运维 | 业务用户查看自己的任务，管理员监控全局任务 |

任务中心队列 Worker 名为 `async-tasks`，注册到系统调度；任务实例在「系统设置 → 任务中心」页面查看。

## 架构

```text
业务页面提交
   │  业务接口调用 submitAsyncTask()
   ▼
async_tasks（pending，快照 maxAttempts / tenant / createdBy）
   │
   │  pg-boss 队列 async-tasks
   ▼
registerAsyncTaskWorker() → runAsyncTask(taskId) → handler.run(ctx)
   │                                     │
   │                                     ├─ ctx.progress(): 进度 / 断点 / 心跳 / WS 推送
   │                                     ├─ ctx.reportItems(): async_task_items 行级明细 upsert
   │                                     └─ 抛错: 自动重试或 failed
   ├─ WebSocket task:progress（推送给创建者）
   └─ system_scheduler_runs（系统调度运行日志）

async-tasks-drain（每分钟）:
  - 回收心跳超时的 running 任务并重投
  - 重投长时间停留 pending 且已到执行时间的任务

data-retention（每天 03:00）:
  - 按数据保留策略清理已结束任务；类型级 retentionDays 可覆盖
```

核心文件：

- `packages/server/src/lib/task-center/`：框架入口、类型、注册表、运行器、策略与实体映射。
- `packages/server/src/routes/tasks/async-tasks.ts`：任务中心管理 API。
- `packages/server/src/services/tasks/async-tasks.service.ts`：列表、统计、权限、操作服务。
- `packages/server/src/bootstrap/workers.ts`：任务类型注册与 Worker 启动编排。
- `packages/server/src/lib/system-tasks.registry.ts`：`async-tasks-drain` 兜底扫描注册。
- 前端：`useAsyncTasks` / `TaskTray` / `/system/task-center` / `/biz/task-demo`。

数据表：

| 表 | 说明 |
| --- | --- |
| `async_tasks` | 任务实例、状态、进度、断点、结果、错误、幂等键、租户和创建者 |
| `async_task_items` | 可选的行级处理明细，按 `task_id + item_key` 幂等覆盖 |
| `async_task_type_configs` | 任务类型运行时策略，覆盖注册默认值 |

## 业务接入三步

### ① 注册任务类型（启动时执行一次）

```ts
import { registerTaskHandler } from '../../lib/task-center';

registerTaskHandler({
  taskType: 'member-batch-import',
  title: '会员批量导入',
  module: '会员中心',
  description: '从上传文件导入会员',
  allowConcurrent: false,
  maxAttempts: 3,
  retryDelayMs: 5000,
  retentionDays: 90,
  async run(ctx) {
    let processed = Number(ctx.checkpoint?.processed ?? 0);
    const rows = await loadRows(ctx.payload);

    for (let i = processed; i < rows.length; i++) {
      const ok = await importOne(rows[i]);
      processed = i + 1;
      await ctx.reportItems([{ key: `row-${i + 1}`, label: rows[i].name, status: ok ? 'success' : 'failed' }]);
      const { cancelRequested } = await ctx.progress({
        processed,
        total: rows.length,
        note: `已导入 ${processed}/${rows.length} 条`,
        checkpoint: { processed },
      });
      if (cancelRequested) return { processed };
    }

    return { processed };
  },
});
```

注册时机放在 `src/bootstrap/workers.ts` 的 `registerBackgroundWorkers()` 中，并确保业务 handler 在 `registerAsyncTaskWorker()` 前完成注册。重复注册同一 `taskType` 时后注册者覆盖先注册者。启动 Worker 时会把注册默认策略落库到 `async_task_type_configs`，已有配置保留管理员修改。

### ② 业务接口中提交任务

```ts
import { submitAsyncTask, mapAsyncTask } from '../../lib/task-center';
import { okBody } from '../../lib/openapi-schemas';

const row = await submitAsyncTask({
  taskType: 'member-batch-import',
  title: `会员批量导入（${fileName}）`,
  payload: { fileId },
  idempotencyKey: `member-import-${fileId}`,
});

return c.json(okBody(mapAsyncTask(row), '任务已提交'), 200);
```

`submitAsyncTask()` 依赖 `currentUser()`，通常在已认证 HTTP 请求中调用。提交时会检查：

- 任务类型必须已注册；
- `enabled=false` 时拒绝新提交；
- `allowConcurrent=false` 时，同一创建者未结束的同类型任务会阻止重复提交；
- `idempotencyKey` 会按「租户 + 创建者 + 任务类型 + key」命中已有任务，避免跨租户或跨用户泄漏。

### 与业务事务一起提交

任务需要与业务写操作原子提交时，在事务内传入 `executor`。事务内只写 `pending` 任务记录；事务提交后再入队。

```ts
import { submitAsyncTask, enqueueAsyncTask } from '../../lib/task-center';

const task = await db.transaction(async (tx) => {
  await tx.insert(orders).values(orderData);
  return submitAsyncTask({ taskType: 'order-sync', payload }, { executor: tx });
});

await enqueueAsyncTask(task.id);
```

外部事务内禁止 `enqueue: true`。提交成功但入队失败时，每分钟兜底扫描会重投长期停留 `pending` 的任务。

### ③ 前端展示进度

```tsx
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';

const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: ['member-batch-import'] });
```

`useMyAsyncTasks` 通过 WebSocket `task:progress` 实时更新，并在存在进行中任务时使用轮询兜底。进度单元格使用 `<AsyncTaskProgress task={task} />`：`totalCount` 有值显示百分比，无总量显示不定进度。

## TaskRunContext API

| 成员 | 说明 |
| --- | --- |
| `taskId` | 任务 ID |
| `payload` | 提交时传入的任务参数 |
| `checkpoint` | 上次持久化的断点；首次执行为 `null` |
| `attempt` | 第几次领取执行；首次为 1，自动重试 / 断点恢复 / 兜底重跑递增，重新开始清零 |
| `progress(update)` | 上报 `processed` / `failed` / `total` / `note` / `checkpoint`，刷新心跳并推送 WS；返回 `{ cancelRequested }` |
| `reportItems(items)` | 批量上报行级明细，按 `taskId + key` 幂等 upsert |
| `isCancelRequested()` | 单独查询取消标记；通常使用 `progress()` 返回值即可 |

handler 应在每个批次后调用 `progress()`。超过 90 秒无心跳的 `running` 任务会被兜底扫描回收为 `pending` 并重投。`checkpoint` 结构由 handler 自定义，重跑逻辑必须幂等。

handler 主动判定任务无需继续时抛 `TaskCancelledError(message, result?)`，runner 会把任务终止为 `cancelled`，不触发自动重试。

## 自动重试

handler 抛错时，若 `attempts < maxAttempts` 且未请求取消，框架会自动重试：

- 状态回到 `pending`；
- `nextRunAt` 设为 `retryDelayMs × 2^(attempts-1)`，上限 15 分钟；
- `checkpoint` 保留；
- pg-boss 使用 `sendAfter` 定时投递；
- 领取时校验 `nextRunAt`，兜底扫描不会提前重投退避中的任务；
- 重试耗尽后状态为 `failed`。

## 生命周期与操作

```text
pending ──领取──► running ──完成──► success ─┐
   │取消              │抛错                  ├─► 重新开始（清空进度 / 断点 / 明细）
   ▼                  ▼                      │
cancelled          pending / failed ─────────┘
                      │
                      └─ 断点恢复（保留 checkpoint）
```

| 操作 | 语义 | 适用状态 |
| --- | --- | --- |
| 取消 | `pending` 直接终止；`running` 置 `cancelRequested`，由 handler 协作退出 | `pending` / `running` |
| 断点恢复 | 保留进度与 checkpoint，重新入队继续执行 | `failed` / `cancelled` |
| 重新开始 | 清空进度、断点、结果和明细，按类型策略重新快照 `maxAttempts` | `success` / `failed` / `cancelled` |
| 删除 | 删除已结束任务记录 | `success` / `failed` / `cancelled` |
| 清理 | 删除超过保留期的已结束任务；全局策略由数据保留中心驱动，类型可设置 `retentionDays` | — |

## API 一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/async-tasks/types` | 登录 | 已注册任务类型与生效策略 |
| `PUT` | `/api/async-tasks/types/{taskType}/config` | `system:async-task:config` | 更新类型运行时策略 |
| `GET` | `/api/async-tasks/stats` | `system:async-task:list` | 统计概览 |
| `GET` | `/api/async-tasks/mine` | 登录 | 我的任务列表 |
| `GET` | `/api/async-tasks` | `system:async-task:list` | 全局任务列表，支持类型、状态、标题、内容、提交人、时间范围筛选 |
| `GET` | `/api/async-tasks/{id}` | 创建者或 `system:async-task:list` | 任务详情 |
| `GET` | `/api/async-tasks/{id}/items` | 创建者或 `system:async-task:list` | 任务项明细分页 |
| `POST` | `/api/async-tasks/{id}/cancel` | 创建者或 `system:async-task:manage` | 取消任务 |
| `POST` | `/api/async-tasks/{id}/resume` | 创建者或 `system:async-task:manage` | 断点恢复 |
| `POST` | `/api/async-tasks/{id}/restart` | 创建者或 `system:async-task:manage` | 重新开始 |
| `POST` | `/api/async-tasks/batch-cancel` | `system:async-task:manage` | 批量取消 |
| `POST` | `/api/async-tasks/batch-delete` | `system:async-task:manage` | 批量删除已结束任务 |
| `DELETE` | `/api/async-tasks/{id}` | `system:async-task:manage` | 删除任务记录 |
| `POST` | `/api/async-tasks/cleanup` | `system:async-task:cleanup` | 立即清理过期任务记录 |

WS 事件：`task:progress`，payload 为 `AsyncTask`，推送给任务创建者。

## 全局任务托盘

顶栏「我的任务」入口（`TaskTray`）展示当前用户进行中任务和近期完成任务。Badge 显示进行中数量，Popover 内展示进度并支持取消。数据源与业务页共享 `useMyAsyncTasks`。

## 与导出中心的分工

导出中心专注文件导出：列定义、渲染格式、脱敏、水印式元信息、下载审计、文件保留策略和托管文件保存。任务中心面向任意业务异步任务，适合导入、批量处理、外部同步、治理扫描、静态化等需要进度、明细、重试或取消的场景。

## 业务示例

业务示例页 `/biz/task-demo` 注册两个演示类型：

- `demo-batch`：批量处理演示，可并发，`maxAttempts=3`，包含硬失败点、软失败间隔和行级明细。
- `demo-serial`：串行阶段演示，不可并发，用于演示重复提交拦截和不定进度。

Demo 模式通过 MSW 模拟提交、进度、取消、断点恢复、重新开始、自动重试和类型策略调整。
