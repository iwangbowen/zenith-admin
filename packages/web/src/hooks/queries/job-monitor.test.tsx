import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { JobSourceKey } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { useJobMonitorStuck, useJobMonitorTrend, type JobMonitorTrendRange } from './job-monitor';

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', '/api/job-monitor/sources/async-task/stuck', []);
  recorder.on('GET', '/api/job-monitor/sources/workflow-job/stuck', []);
  recorder.on('GET', '/api/job-monitor/trend', { points: [] });
});

describe('job monitor stuck query', () => {
  it('requests only while the drawer is open and fetches fresh data on reopening', async () => {
    const hook = renderHook(({ key, enabled }: { key: JobSourceKey | undefined; enabled: boolean }) => useJobMonitorStuck(key, enabled), {
      initialProps: { key: 'async-task' as JobSourceKey | undefined, enabled: false },
      wrapper: createWrapper(createTestQueryClient()),
    });
    expect(recorder.calls).toHaveLength(0);
    hook.rerender({ key: 'async-task', enabled: true });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(recorder.urls()).toEqual(['/api/job-monitor/sources/async-task/stuck?limit=50']);
    hook.rerender({ key: undefined, enabled: false });
    expect(recorder.calls).toHaveLength(1);
    hook.rerender({ key: 'async-task', enabled: true });
    await waitFor(() => expect(recorder.calls).toHaveLength(2));
  });

  it('keeps source lists separate in the query cache', async () => {
    const hook = renderHook(({ key }) => useJobMonitorStuck(key, true), {
      initialProps: { key: 'async-task' as JobSourceKey }, wrapper: createWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ key: 'workflow-job' });
    await waitFor(() => expect(recorder.countOf('GET', '/api/job-monitor/sources/workflow-job/stuck')).toBe(1));
    expect(recorder.countOf('GET', '/api/job-monitor/sources/async-task/stuck')).toBe(1);
  });

  it('fetches the requested trend range when the range changes', async () => {
    const hook = renderHook(({ range }) => useJobMonitorTrend(range), {
      initialProps: { range: '24h' as JobMonitorTrendRange }, wrapper: createWrapper(createTestQueryClient()),
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ range: '1h' });
    await waitFor(() => expect(recorder.urls()).toEqual(['/api/job-monitor/trend?range=24h', '/api/job-monitor/trend?range=1h']));
  });
});
