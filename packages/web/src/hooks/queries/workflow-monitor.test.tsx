import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { workflowEngineContract, workflowInstanceOpsContract } from '@zenith/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, isFresh } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { urlOf } from '@/lib/contract-query';
import { useResumeWorkflowInstance, useSuspendWorkflowInstance, useWorkflowJobList, useWorkflowJobSummary, workflowMonitorKeys } from './workflow-monitor';

describe('workflow instance lifecycle cache', () => {
  it('refreshes job lists and paused totals after suspend/resume while retaining definition lookups', async () => {
    const listUrl = workflowEngineContract.jobs.fullPath;
    const summaryUrl = workflowEngineContract.jobsSummary.fullPath;
    recorder
      .on('GET', listUrl, { list: [], total: 0, page: 1, pageSize: 10 })
      .on('GET', summaryUrl, [])
      .on('POST', urlOf(workflowInstanceOpsContract.suspend, { params: { id: 1 } }), {})
      .on('POST', urlOf(workflowInstanceOpsContract.resume, { params: { id: 1 } }), {});
    const qc = createTestQueryClient();
    qc.setQueryData(workflowMonitorKeys.definitionsOptions, []);
    const { result } = renderHook(() => ({
      list: useWorkflowJobList({}), summary: useWorkflowJobSummary(),
      suspend: useSuspendWorkflowInstance(), resume: useResumeWorkflowInstance(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.summary.isSuccess).toBe(true));

    for (const mutate of [
      () => result.current.suspend.mutateAsync({ params: { id: 1 }, body: { reason: 'maintenance' } }),
      () => result.current.resume.mutateAsync({ params: { id: 1 } }),
    ]) {
      recorder.resetCalls();
      await mutate();
      await waitFor(() => {
        expect(recorder.countOf('GET', listUrl)).toBe(1);
        expect(recorder.countOf('GET', summaryUrl)).toBe(1);
        expect(result.current.list.isFetching || result.current.summary.isFetching).toBe(false);
      });
      expect(isFresh(qc, workflowMonitorKeys.definitionsOptions)).toBe(true);
    }
  });
});
