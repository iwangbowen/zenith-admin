import { afterEach, expect, it } from 'vitest';
import { fillPath, type AnyOperation } from '@zenith/shared/core';
import { jobMonitorContract } from '@zenith/shared/platform';
import { asyncTaskContract } from '@zenith/shared/tasks';
import { jobMonitorHandlers } from './handlers/job-monitor';
import { asyncTasksHandlers, createImmediateMockTask, mockAsyncTasks } from './handlers/async-tasks';

const original = structuredClone(mockAsyncTasks);
afterEach(() => mockAsyncTasks.splice(0, mockAsyncTasks.length, ...structuredClone(original)));
async function call(operation: AnyOperation, params: Record<string, string | number> = {}) {
  const request = new Request(new URL(fillPath(operation.fullPath, params), window.location.origin), { method: operation.method.toUpperCase() });
  for (const handler of [...jobMonitorHandlers, ...asyncTasksHandlers]) {
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: 'monitor-drill-down-test' });
    if (result?.response) return result.response;
  }
  throw new Error('No handler');
}
it('links the monitor fixture to an existing task detail and preserves unique task ids', async () => {
  await call(jobMonitorContract.overview);
  await call(jobMonitorContract.overview);
  expect(mockAsyncTasks.filter(task => task.id === 731)).toHaveLength(1);
  const detail = await call(asyncTaskContract.detail, { id: 731 });
  expect(detail.status).toBe(200);
  expect((await detail.json()).data).toMatchObject({ id: 731, title: '历史数据导入', status: 'running' });
  const created = createImmediateMockTask({ taskType: 'demo-batch', title: '后续演示任务' });
  expect(created.id).toBeGreaterThan(731);
});
