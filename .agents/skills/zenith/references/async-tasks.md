# 异步任务接入参考（任务中心）

> **触发场景**：业务功能包含**长耗时操作**——批量删除/更新、Excel 导入、报表生成、数据迁移、消息群发、第三方同步等无法同步完成的操作。此类需求**禁止自建轮询表或后台线程**，必须接入任务中心（`packages/server/src/lib/task-center/`）。
>
> 完整文档：[docs/backend/task-center.md](../../../../docs/backend/task-center.md)；可运行示例：`packages/server/src/routes/task-demo.ts` + `packages/web/src/pages/biz/task-demo/TaskDemoPage.tsx`。

---

## 能力清单（框架已内置，勿重复造）

| 能力 | 说明 |
| --- | --- |
| 任务记录 | `async_tasks` 表：状态 / 进度 / 断点 / 结果 / 错误，管理端「任务中心」页全局监控 |
| 实时进度 | `ctx.progress()` 自动 WS 推送（`task:progress`，300ms 节流）+ 前端轮询兜底 |
| 断点续跑 | `checkpoint` jsonb 由 handler 自定义；崩溃/重启后兜底扫描（每分钟）回收心跳超时任务并从断点重投 |
| 自动重试 | 注册 `maxAttempts` + `retryDelayMs`（指数退避，上限 15min）；失败保留断点自动重试 |
| 协作式取消 | `progress()` 返回 `{ cancelRequested }`，handler 保存断点后 return |
| 重复提交拦截 | `allowConcurrent: false` → 同用户存在未结束任务时 400 |
| 幂等提交 | `submitAsyncTask({ idempotencyKey })` → 相同 key 返回已存在任务 |
| 行级明细 | `ctx.reportItems()` 写 `async_task_items`（按 taskId+key upsert），导入类场景的逐行错误报告 |
| 运行时策略 | `async_task_type_configs`：管理员可在任务中心「任务类型」tab 覆盖注册默认值（暂停提交/并发/重试/保留期） |
| 自动清理 | 调度中心周期任务每日清理已结束任务（全局 30 天，类型可覆盖） |
| 全局托盘 | 顶栏 `TaskTray` 自动展示当前用户进行中任务，业务代码无需接入 |

---

## 后端接入（三步）

### ① 注册 handler（模块加载时执行一次）

新建 `packages/server/src/services/xxx-tasks.ts`（或就近放在业务 service），在 `packages/server/src/index.ts` 启动流程中、`registerSystemTasks()` **之前**调用注册函数（参考 `registerTaskDemoHandlers()` 的挂载位置）：

```ts
import { registerTaskHandler } from '../lib/task-center';

export function registerXxxTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'xxx-batch-import',      // 唯一标识：模块-动作，小写中划线
    title: 'XXX 批量导入',
    module: 'XXX管理',                  // 展示模块名
    allowConcurrent: false,            // 同用户是否允许并行提交
    maxAttempts: 3,                    // 失败自动重试（默认 1 = 不重试）
    retryDelayMs: 5000,                // 退避基数 5s → 10s → 20s
    async run(ctx) {
      // 断点恢复：跳过已处理部分（handler 必须按 checkpoint 幂等）
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      const rows = await loadRows(ctx.payload);
      for (let i = processed; i < rows.length; i++) {
        const ok = await importOne(rows[i]);
        processed = i + 1;
        await ctx.reportItems([{        // 可选：行级明细
          key: `row-${i + 1}`, label: rows[i].name,
          status: ok ? 'success' : 'failed',
          message: ok ? null : '校验不通过',
        }]);
        const { cancelRequested } = await ctx.progress({
          processed, total: rows.length,
          note: `已导入 ${processed}/${rows.length} 条`,
          checkpoint: { processed },    // 断点随进度持久化
        });
        if (cancelRequested) return;    // 协作式取消
      }
      return { processed };             // 写入 result
    },
  });
}
```

要点：

- `progress()` 兼作心跳，每个处理批次必须调用（>90s 无心跳会被判卡死回收）
- `total: null`（或不传）= 不可枚举任务，前端显示不定进度
- handler 内可用 `currentUser()`（框架已还原创建者身份），审计上下文同样生效
- 抛错 → 自动重试（未用尽）或 failed；**不要**在 handler 里自行 try-catch 吞掉错误

### ② 业务接口提交任务

业务路由 handler 中（HTTP 上下文内）：

```ts
import { mapAsyncTask, submitAsyncTask } from '../lib/task-center';

const row = await submitAsyncTask({
  taskType: 'xxx-batch-import',
  title: `XXX 批量导入（${fileName}）`,      // 可选，覆盖默认标题
  payload: { fileId },                       // handler 自定义入参
  idempotencyKey: `xxx-import-${fileId}`,    // 可选：防重复点击
});
return c.json(okBody(mapAsyncTask(row), '任务已提交'), 200);
```

### ③ 无需新建查询/操作接口

任务查询、取消、断点恢复、重新开始、明细均走**通用接口** `/api/async-tasks/*`（`mine` / `{id}` / `{id}/items` / `{id}/cancel|resume|restart`），业务侧只需提交接口。

---

## 前端接入

```tsx
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';

// WS 实时 + 3s 轮询兜底（Demo 模式纯轮询）；taskTypes 过滤本模块任务
const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: ['xxx-batch-import'] });

// 表格进度列直接用通用组件（确定进度=进度条，不定进度=Spin+说明）
{ title: '进度', render: (_, record) => <AsyncTaskProgress task={record} /> }
```

- 取消/恢复/重开直接 POST `/api/async-tasks/{id}/cancel|resume|restart`
- 操作列布局参考 `TaskDemoPage.tsx`；顶栏 `TaskTray` 已全局挂载，提交后跨页面可见进度，无需额外处理

---

## MSW Mock（Demo 模式）

`packages/web/src/mocks/handlers/async-tasks.ts` 已模拟通用接口（按读取时间推进进度、自动重试、行级明细）。新增业务任务类型时：

1. 在该文件 `taskTypes` 数组中追加类型元信息；
2. 业务自己的**提交接口**需新增对应 handler（参考文件内 `/api/task-demo/submit`），创建任务对象后调用 `startSim(task)`。

---

## 与相邻设施的分工（选型判断）

| 需求 | 用什么 |
| --- | --- |
| 用户在页面提交的长耗时业务操作（要进度/取消/续跑） | **任务中心**（本文档） |
| 数据列表导出 Excel/CSV（脱敏/水印/下载审计） | 导出中心（`lib/export-center/`，见 crud-backend.md 导出章节） |
| 系统级周期任务（清理/扫描/采集，cron 触发） | `registerSystemRecurringJob`（`lib/system-tasks.registry.ts`） |
| 用户可自定义 cron 的定时任务 | 定时任务模块（`cron_jobs`） |
| 工作流节点的延迟/补偿/外呼作业 | `workflow_jobs`（`lib/workflow-jobs/`） |
