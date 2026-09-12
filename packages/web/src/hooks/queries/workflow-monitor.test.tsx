import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { workflowEngineContract, workflowInstanceContract, workflowInstanceOpsContract } from '@zenith/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, isFresh } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { urlOf } from '@/lib/contract-query';
import {
  useAddWorkflowCompensationNote,
  useResumeWorkflowInstance,
  useRetryWorkflowJob,
  useSuspendWorkflowInstance,
  useWorkflowCompensationDetail,
  useWorkflowCompensationList,
  useWorkflowJobDetail,
  useWorkflowJobList,
  useWorkflowJobSummary,
  useWorkflowMonitorList,
  workflowMonitorKeys,
} from './workflow-monitor';

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

describe('workflow job / compensation cache', () => {
  const jobsUrl = workflowEngineContract.jobs.fullPath;
  const jobDetailUrl = urlOf(workflowEngineContract.jobDetail, { params: { id: 9 } });
  const summaryUrl = workflowEngineContract.jobsSummary.fullPath;
  const monitorUrl = workflowInstanceContract.monitor.fullPath;
  const compensationsUrl = workflowInstanceOpsContract.compensations.fullPath;
  const compensationDetailUrl = urlOf(workflowInstanceOpsContract.compensationDetail, { params: { id: 4 } });

  function stub() {
    recorder.reset();
    recorder
      .on('GET', jobsUrl, { list: [], total: 0, page: 1, pageSize: 10 })
      .on('GET', jobDetailUrl, { id: 9, status: 'failed' })
      .on('GET', summaryUrl, [])
      .on('GET', monitorUrl, { list: [], total: 0, page: 1, pageSize: 10, stats: {} })
      .on('GET', compensationsUrl, { list: [], total: 0, page: 1, pageSize: 10 })
      .on('GET', compensationDetailUrl, { id: 4, instanceId: 1 })
      .on('POST', urlOf(workflowEngineContract.retryJob, { params: { id: 9 } }), { id: 9, status: 'pending' })
      .on('POST', urlOf(workflowInstanceOpsContract.addCompensationNote, { params: { id: 4 } }), { id: 4, instanceId: 1 });
  }

  it('retrying a job refetches the job list, its detail and the summary but not the instance monitor', async () => {
    stub();
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      jobs: useWorkflowJobList({}), detail: useWorkflowJobDetail(9), summary: useWorkflowJobSummary(),
      monitor: useWorkflowMonitorList({ page: 1, pageSize: 10 }), retry: useRetryWorkflowJob(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => {
      const { jobs, detail, summary, monitor } = result.current;
      expect(jobs.isSuccess && detail.isSuccess && summary.isSuccess && monitor.isSuccess).toBe(true);
    });

    recorder.resetCalls();
    await result.current.retry.mutateAsync({ params: { id: 9 }, body: {} });
    await waitFor(() => {
      expect(recorder.countOf('GET', jobsUrl)).toBe(1);
      expect(recorder.countOf('GET', jobDetailUrl)).toBe(1);
      expect(recorder.countOf('GET', summaryUrl)).toBe(1);
    });
    expect(recorder.countOf('GET', monitorUrl)).toBe(0);
    expect(isFresh(qc, workflowMonitorKeys.monitorList({ page: 1, pageSize: 10 }))).toBe(true);
  });

  it('adding a compensation note refetches the ticket list and detail only', async () => {
    stub();
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      list: useWorkflowCompensationList({ page: 1, pageSize: 10 }), detail: useWorkflowCompensationDetail(4),
      jobs: useWorkflowJobList({}), note: useAddWorkflowCompensationNote(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.detail.isSuccess && result.current.jobs.isSuccess).toBe(true));

    recorder.resetCalls();
    await result.current.note.mutateAsync({ params: { id: 4 }, body: { note: '已联系供应商' } });
    await waitFor(() => {
      expect(recorder.countOf('GET', compensationsUrl)).toBe(1);
      expect(recorder.countOf('GET', compensationDetailUrl)).toBe(1);
    });
    expect(recorder.countOf('GET', jobsUrl)).toBe(0);
    expect(isFresh(qc, workflowMonitorKeys.jobList({}))).toBe(true);
  });
});
