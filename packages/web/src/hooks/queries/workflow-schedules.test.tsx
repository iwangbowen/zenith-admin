import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));
import { useRetryWorkflowScheduleRun, useRunWorkflowSchedule, useSaveWorkflowSchedule, useWorkflowScheduleList, useWorkflowScheduleRuns, useWorkflowScheduleRunDetail } from './workflow-schedules';

beforeEach(() => {
  api.reset();
  api.on('GET', '/api/workflows/schedules', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/workflows/schedules/1/runs', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/workflows/schedules/2/runs', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/workflows/schedules/1/runs/12', { status: 'dead', executions: [] })
    .on('POST', '/api/workflows/schedules/1/run', { id: 1 })
    .on('POST', '/api/workflows/schedules/1/runs/12/retry', { status: 'pending', executions: [] })
    .on('PUT', '/api/workflows/schedules/1', { id: 1 });
});

function harness() {
  const client = createTestQueryClient();
  const hook = renderHook(() => ({
    list: useWorkflowScheduleList({ page: 1, pageSize: 10 }),
    first: useWorkflowScheduleRuns(1, { page: 1, pageSize: 10 }),
    other: useWorkflowScheduleRuns(2, { page: 1, pageSize: 10 }),
    detail: useWorkflowScheduleRunDetail(1, 12),
    run: useRunWorkflowSchedule(), retry: useRetryWorkflowScheduleRun(), save: useSaveWorkflowSchedule(),
  }), { wrapper: createWrapper(client) });
  return { hook, client };
}

describe('schedule occurrence cache behavior', () => {
  it('manual enqueue refreshes its runs and rule list, preserving unrelated rule history', async () => {
    const { hook, client } = harness();
    await waitFor(() => expect(hook.result.current.first.isSuccess && hook.result.current.other.isSuccess && hook.result.current.list.isSuccess).toBe(true));
    const first = api.countOf('GET', '/api/workflows/schedules/1/runs');
    const other = api.countOf('GET', '/api/workflows/schedules/2/runs');
    const list = api.countOf('GET', '/api/workflows/schedules');
    await hook.result.current.run.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(api.countOf('GET', '/api/workflows/schedules/1/runs')).toBe(first + 1));
    expect(api.countOf('GET', '/api/workflows/schedules')).toBe(list + 1);
    expect(api.countOf('GET', '/api/workflows/schedules/2/runs')).toBe(other);
    hook.unmount(); client.clear();
  });

  it('replay refreshes the selected occurrence detail; changing a name does not reload immutable history', async () => {
    const { hook, client } = harness();
    await waitFor(() => expect(hook.result.current.detail.isSuccess && hook.result.current.first.isSuccess).toBe(true));
    const detail = api.countOf('GET', '/api/workflows/schedules/1/runs/12');
    await hook.result.current.retry.mutateAsync({ params: { id: 1, jobId: 12 } });
    await waitFor(() => expect(api.countOf('GET', '/api/workflows/schedules/1/runs/12')).toBe(detail + 1));
    const history = api.countOf('GET', '/api/workflows/schedules/1/runs');
    await hook.result.current.save.mutateAsync({ id: 1, values: { name: '改名' } });
    await waitFor(() => expect(hook.result.current.list.isFetching).toBe(false));
    expect(api.countOf('GET', '/api/workflows/schedules/1/runs')).toBe(history);
    hook.unmount(); client.clear();
  });
});
