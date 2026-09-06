import type { AsyncTaskItem } from '@zenith/shared/tasks';
import type { asyncTaskItems } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';

export function mapAsyncTaskItem(row: typeof asyncTaskItems.$inferSelect): AsyncTaskItem {
  return {
    id: row.id,
    taskId: row.taskId,
    itemKey: row.itemKey,
    label: row.label ?? null,
    status: row.status,
    message: row.message ?? null,
    data: row.data ?? null,
    attempt: row.attempt,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}
