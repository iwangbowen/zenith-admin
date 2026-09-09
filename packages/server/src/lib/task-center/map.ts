import { isAsyncTaskTerminal, type AsyncTask } from '@zenith/shared/tasks';
import type { AsyncTaskRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../datetime';
import { sendToUser } from '../ws-manager';
import { getTaskTypeMeta } from './registry';

type AsyncTaskRowWithCreator = AsyncTaskRow & {
  createdByUser?: { nickname: string | null; username: string } | null;
};

export function mapAsyncTask(row: AsyncTaskRowWithCreator): AsyncTask {
  return {
    id: row.id,
    taskType: row.taskType,
    title: row.title,
    module: getTaskTypeMeta(row.taskType)?.module ?? null,
    status: row.status,
    payload: row.payload ?? {},
    totalCount: row.totalCount ?? null,
    processedCount: row.processedCount,
    failedCount: row.failedCount,
    progressNote: row.progressNote ?? null,
    result: row.result ?? null,
    errorMessage: row.errorMessage ?? null,
    cancelRequested: row.cancelRequested,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    retryDelayMs: row.retryDelayMs,
    nextRunAt: formatNullableDateTime(row.nextRunAt),
    createdBy: row.createdBy ?? null,
    createdByName: row.createdByUser?.nickname || row.createdByUser?.username || null,
    tenantId: row.tenantId ?? null,
    traceId: row.traceId ?? null,
    startedAt: formatNullableDateTime(row.startedAt),
    completedAt: formatNullableDateTime(row.completedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 进度 WS 推送最小间隔（毫秒），避免逐条任务刷屏；状态变更总是立即推送 */
const PUSH_THROTTLE_MS = 300;
const lastPushAt = new Map<number, number>();

/** 向任务创建者推送进度事件（task:progress）；带节流，终态/强制推送不受节流限制 */
export function pushTaskProgress(row: AsyncTaskRowWithCreator, opts?: { force?: boolean }): void {
  if (!row.createdBy) return;
  const now = Date.now();
  const terminal = isAsyncTaskTerminal(row.status);
  const force = opts?.force === true || terminal;
  if (!force && now - (lastPushAt.get(row.id) ?? 0) < PUSH_THROTTLE_MS) return;
  if (terminal) lastPushAt.delete(row.id);
  else lastPushAt.set(row.id, now);
  sendToUser(row.createdBy, { type: 'task:progress', payload: mapAsyncTask(row) });
}
