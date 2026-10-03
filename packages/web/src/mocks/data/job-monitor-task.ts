import type { AsyncTask } from '@zenith/shared/tasks';
import { mockDateTimeOffset } from '@/mocks/utils/date';

/** A frozen execution appears in both the monitor and its task-center drill-down. */
export function createJobMonitorDemoTask(): AsyncTask {
  return {
    id: 731, taskType: 'demo-batch', title: '历史数据导入', module: '业务示例', status: 'running',
    payload: { totalItems: 1000, itemDelayMs: 100 }, totalCount: 1000, processedCount: 37, failedCount: 0,
    progressNote: '执行心跳失联，等待回收', result: null, errorMessage: null, cancelRequested: false,
    attempts: 1, maxAttempts: 3, retryDelayMs: 5000, nextRunAt: null,
    createdBy: 1, createdByName: '管理员', tenantId: null, traceId: null,
    startedAt: mockDateTimeOffset(-1_200_000), completedAt: null,
    createdAt: mockDateTimeOffset(-1_200_000), updatedAt: mockDateTimeOffset(-900_000),
  };
}
