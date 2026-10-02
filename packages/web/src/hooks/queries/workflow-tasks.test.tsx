/**
 * 任务动作的失效范围：批量审批 / 面板动作后，待办列表即时移除成功行并回源，
 * 监控列表（同屏挂载时）回源；已发布定义下拉等编辑态 / lookup 查询不受波及。
 * 曾经这里是 invalidateQueries(['workflow']) 全域广播，契约 key 下该前缀什么也匹配不到。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { workflowDefinitionContract, workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, getCacheEntry, isFresh, observeFetches } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { urlOf } from '@/lib/contract-query';
import { invalidateAfterTaskAction, runWorkflowBatchApprove, useBatchApproveWorkflowTasks, useConsultWorkflowTask, usePendingWorkflowTasks, useReduceWorkflowSignGroup, workflowTaskKeys } from './workflow-tasks';
import { useWorkflowInstanceDetail, useWorkflowMonitorList } from './workflow-monitor';
import { usePublishedWorkflowDefinitions, workflowDefinitionKeys } from './workflow-definitions';
import { workflowInstanceKeys } from './workflow-instances';

const PENDING_URL = workflowInstanceContract.pendingMine.fullPath;
const MONITOR_URL = workflowInstanceContract.monitor.fullPath;
const PUBLISHED_URL = workflowDefinitionContract.published.fullPath;
const DETAIL_1_URL = urlOf(workflowInstanceContract.detail, { params: { id: 1 } });
const DETAIL_2_URL = urlOf(workflowInstanceContract.detail, { params: { id: 2 } });

const pendingItem = (id: number, pendingTaskId: number) => ({ id, pendingTaskId, title: `申请 ${id}` });
const page = <T,>(list: T[]) => ({ list, total: list.length, page: 1, pageSize: 10 });

beforeEach(() => {
  recorder.reset();
  recorder
    .on('GET', PENDING_URL, page([pendingItem(1, 11), pendingItem(2, 12)]))
    .on('GET', MONITOR_URL, { ...page([]), stats: {} })
    .on('GET', PUBLISHED_URL, [])
    .on('GET', DETAIL_1_URL, { id: 1 })
    .on('GET', DETAIL_2_URL, { id: 2 })
    .on('POST', workflowTaskContract.batchApprove.fullPath, { succeeded: 1, failed: 0, results: [{ taskId: 11, success: true }] })
    .on('POST', urlOf(workflowTaskContract.consult, { params: { taskId: 11 } }), []);
});

describe('workflow task action cache', () => {
  it('group reduction refetches its instance and pending views without refreshing unrelated details or published lookups', async () => {
    const groupUrl = urlOf(workflowTaskContract.reduceSign, { params: { groupId: 20 } });
    recorder.on('POST', groupUrl, { group: { id: 20 }, removed: [], instance: { id: 1 } });
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      first: useWorkflowInstanceDetail(1), second: useWorkflowInstanceDetail(2),
      pending: usePendingWorkflowTasks({ page: 1, pageSize: 10 }), published: usePublishedWorkflowDefinitions(),
      reduce: useReduceWorkflowSignGroup(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.first.isSuccess && result.current.second.isSuccess
      && result.current.pending.isSuccess && result.current.published.isSuccess).toBe(true));
    recorder.resetCalls();
    await result.current.reduce.mutateAsync({ params: { groupId: 20 }, body: { targetSlotIds: [12] } });
    await waitFor(() => expect(recorder.countOf('GET', DETAIL_1_URL)).toBe(1));
    await waitFor(() => expect(recorder.countOf('GET', PENDING_URL)).toBe(1));
    expect(recorder.countOf('GET', DETAIL_2_URL)).toBe(0);
    expect(recorder.countOf('GET', PUBLISHED_URL)).toBe(0);
    expect(recorder.calls.find((call) => call.method === 'POST')?.body).toEqual({ targetSlotIds: [12] });
    expect(recorder.calls.find((call) => call.method === 'POST')?.headers?.['x-idempotency-key']).toMatch(/^workflow-reduce-group-[\da-f-]{36}$/);
  });

  it('batch approve drops succeeded rows at once, refetches pending + monitor lists and leaves the published lookup fresh', async () => {
    const qc = createTestQueryClient();
    const params = { page: 1, pageSize: 10 };
    const { result } = renderHook(() => ({
      pending: usePendingWorkflowTasks(params),
      monitor: useWorkflowMonitorList({ page: 1, pageSize: 10 }),
      published: usePublishedWorkflowDefinitions(),
      approve: useBatchApproveWorkflowTasks(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => {
      expect(result.current.pending.isSuccess && result.current.monitor.isSuccess && result.current.published.isSuccess).toBe(true);
    });

    recorder.on('GET', PENDING_URL, page([pendingItem(2, 12)]));
    recorder.resetCalls();
    const fetches = observeFetches(qc);
    await result.current.approve.mutateAsync({ body: { taskIds: [11] } });

    // 每次明确确认单独生成意图，弱网重试沿用该请求头。
    expect(recorder.calls.find((c) => c.method === 'POST')?.headers?.['x-idempotency-key']).toMatch(/^workflow-batch-approve-[\da-f-]{36}$/);
    // 成功行先从缓存即时移除，再由回源校准
    const cached = getCacheEntry<{ list: Array<{ pendingTaskId: number }>; total: number }>(qc, workflowTaskKeys.pendingList(params));
    expect(cached?.list.map((it) => it.pendingTaskId)).toEqual([12]);
    expect(cached?.total).toBe(1);
    await waitFor(() => {
      expect(recorder.countOf('GET', PENDING_URL)).toBe(1);
      expect(recorder.countOf('GET', MONITOR_URL)).toBe(1);
    });
    expect(recorder.countOf('GET', PUBLISHED_URL)).toBe(0);
    expect(fetches.countOf(workflowDefinitionKeys.published)).toBe(0);
    expect(isFresh(qc, workflowDefinitionKeys.published)).toBe(true);
    fetches.stop();
  });

  it('uses a new confirmation key when a personal signature version changes and sends only its reference', async () => {
    await runWorkflowBatchApprove({ taskIds: [11], signature: { source: 'saved', signatureId: 9, version: 1 } });
    await runWorkflowBatchApprove({ taskIds: [11], signature: { source: 'saved', signatureId: 9, version: 2 } });
    const calls = recorder.calls.filter((call) => call.method === 'POST');
    expect(calls[0].headers?.['x-idempotency-key']).not.toBe(calls[1].headers?.['x-idempotency-key']);
    expect(calls.map((call) => call.body)).toEqual([
      { taskIds: [11], signature: { source: 'saved', signatureId: 9, version: 1 } },
      { taskIds: [11], signature: { source: 'saved', signatureId: 9, version: 2 } },
    ]);
  });

  it('invalidateAfterTaskAction(instanceId) refetches that instance detail only', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      first: useWorkflowInstanceDetail(1),
      second: useWorkflowInstanceDetail(2),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.first.isSuccess && result.current.second.isSuccess).toBe(true));

    recorder.resetCalls();
    invalidateAfterTaskAction(qc, 1);
    await waitFor(() => expect(recorder.countOf('GET', DETAIL_1_URL)).toBe(1));
    expect(recorder.countOf('GET', DETAIL_2_URL)).toBe(0);
    expect(isFresh(qc, workflowInstanceKeys.detail(2))).toBe(true);
  });

  it('consulting refetches instance details (consult opinions) but not the pending list', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      pending: usePendingWorkflowTasks({ page: 1, pageSize: 10 }),
      detail: useWorkflowInstanceDetail(1),
      consult: useConsultWorkflowTask(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.pending.isSuccess && result.current.detail.isSuccess).toBe(true));

    recorder.resetCalls();
    await result.current.consult.mutateAsync({ params: { taskId: 11 }, body: { consulteeIds: [5] } });
    await waitFor(() => expect(recorder.countOf('GET', DETAIL_1_URL)).toBe(1));
    expect(recorder.countOf('GET', PENDING_URL)).toBe(0);
    expect(isFresh(qc, workflowTaskKeys.pendingList({ page: 1, pageSize: 10 }))).toBe(true);
  });
});
