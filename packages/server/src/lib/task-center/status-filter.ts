import { eq, inArray, type SQL } from 'drizzle-orm';
import {
  ASYNC_TASK_ACTIVE_STATUSES,
  ASYNC_TASK_STATUSES,
  ASYNC_TASK_TERMINAL_STATUSES,
  type AsyncTaskStatus,
} from '@zenith/shared/tasks';
import { asyncTasks } from '../../db/schema';

/** 列表筛选里的任务状态取值：具体状态，或 `active`（pending / running）、`terminal`（success / failed / cancelled）分组 */
export type AsyncTaskStatusFilter = AsyncTaskStatus | 'active' | 'terminal';

/**
 * 任务状态筛选 → `async_tasks.status` 的 WHERE 条件。
 * 分组值展开为 `IN (...)`，具体状态精确匹配；空值或不在取值集合内的输入不过滤（返回 `undefined`，交给 `buildWhere` 丢弃）。
 */
export function asyncTaskStatusCondition(status: unknown): SQL | undefined {
  if (status === 'active') return inArray(asyncTasks.status, ASYNC_TASK_ACTIVE_STATUSES);
  if (status === 'terminal') return inArray(asyncTasks.status, ASYNC_TASK_TERMINAL_STATUSES);
  if (typeof status === 'string' && (ASYNC_TASK_STATUSES as readonly string[]).includes(status)) {
    return eq(asyncTasks.status, status as AsyncTaskStatus);
  }
  return undefined;
}
