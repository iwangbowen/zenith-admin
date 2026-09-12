/**
 * 实例侧 mutation 的失效范围：曾经全部 invalidateQueries(['workflow']) 广播，
 * 契约 key 下改为按真实副作用逐项失效 —— 撤回牵动申请 / 已办 / 待办，草稿编辑只动申请列表与详情，
 * 标记抄送已读只动抄送列表与未读数。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { workflowInstanceContract } from '@zenith/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, isFresh } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { urlOf } from '@/lib/contract-query';
import {
  useCcWorkflowInstances,
  useHandledWorkflowInstances,
  useMarkWorkflowCcRead,
  useMyWorkflowInstances,
  useUpdateWorkflowDraft,
  useWithdrawWorkflowInstance,
  workflowInstanceKeys,
} from './workflow-instances';
import { usePendingWorkflowTasks, workflowTaskKeys } from './workflow-tasks';
import { useWorkflowInstanceDetail } from './workflow-monitor';

const MY_URL = workflowInstanceContract.list.fullPath;
const HANDLED_URL = workflowInstanceContract.handledMine.fullPath;
const CC_URL = workflowInstanceContract.ccMine.fullPath;
const PENDING_URL = workflowInstanceContract.pendingMine.fullPath;
const DETAIL_URL = urlOf(workflowInstanceContract.detail, { params: { id: 7 } });
const LIST_PARAMS = { page: 1, pageSize: 10 };

const emptyPage = { list: [], total: 0, page: 1, pageSize: 10 };

beforeEach(() => {
  recorder.reset();
  recorder
    .on('GET', MY_URL, emptyPage)
    .on('GET', HANDLED_URL, emptyPage)
    .on('GET', CC_URL, emptyPage)
    .on('GET', PENDING_URL, emptyPage)
    .on('GET', DETAIL_URL, { id: 7, status: 'draft' })
    .on('POST', urlOf(workflowInstanceContract.withdraw, { params: { id: 7 } }), { id: 7, status: 'withdrawn' })
    .on('PUT', urlOf(workflowInstanceContract.updateDraft, { params: { id: 7 } }), { id: 7, status: 'draft' })
    .on('POST', urlOf(workflowInstanceContract.ccRead, { params: { ccTaskId: 3 } }), null);
});

function renderLists(qc: ReturnType<typeof createTestQueryClient>) {
  return renderHook(() => ({
    my: useMyWorkflowInstances(LIST_PARAMS),
    handled: useHandledWorkflowInstances(LIST_PARAMS),
    cc: useCcWorkflowInstances(LIST_PARAMS),
    pending: usePendingWorkflowTasks(LIST_PARAMS),
    detail: useWorkflowInstanceDetail(7),
    withdraw: useWithdrawWorkflowInstance(),
    updateDraft: useUpdateWorkflowDraft(),
    ccRead: useMarkWorkflowCcRead(),
  }), { wrapper: createWrapper(qc) });
}

async function settled(result: ReturnType<typeof renderLists>['result']) {
  await waitFor(() => {
    const { my, handled, cc, pending, detail } = result.current;
    expect(my.isSuccess && handled.isSuccess && cc.isSuccess && pending.isSuccess && detail.isSuccess).toBe(true);
  });
}

describe('workflow instance mutation cache', () => {
  it('withdraw refetches my applications, handled, pending lists and the instance detail', async () => {
    const qc = createTestQueryClient();
    const { result } = renderLists(qc);
    await settled(result);

    recorder.resetCalls();
    await result.current.withdraw.mutateAsync({ params: { id: 7 } });
    await waitFor(() => {
      expect(recorder.countOf('GET', MY_URL)).toBe(1);
      expect(recorder.countOf('GET', HANDLED_URL)).toBe(1);
      expect(recorder.countOf('GET', PENDING_URL)).toBe(1);
      expect(recorder.countOf('GET', DETAIL_URL)).toBe(1);
    });
  });

  it('editing a draft only refetches my applications and that detail', async () => {
    const qc = createTestQueryClient();
    const { result } = renderLists(qc);
    await settled(result);

    recorder.resetCalls();
    await result.current.updateDraft.mutateAsync({ params: { id: 7 }, body: { title: '改标题' } });
    await waitFor(() => {
      expect(recorder.countOf('GET', MY_URL)).toBe(1);
      expect(recorder.countOf('GET', DETAIL_URL)).toBe(1);
    });
    expect(recorder.countOf('GET', PENDING_URL)).toBe(0);
    expect(recorder.countOf('GET', HANDLED_URL)).toBe(0);
    expect(isFresh(qc, workflowTaskKeys.pendingList(LIST_PARAMS))).toBe(true);
    expect(isFresh(qc, workflowInstanceKeys.handled(LIST_PARAMS))).toBe(true);
  });

  it('marking a cc read only refetches the cc list', async () => {
    const qc = createTestQueryClient();
    const { result } = renderLists(qc);
    await settled(result);

    recorder.resetCalls();
    await result.current.ccRead.mutateAsync({ params: { ccTaskId: 3 } });
    await waitFor(() => expect(recorder.countOf('GET', CC_URL)).toBe(1));
    expect(recorder.countOf('GET', MY_URL)).toBe(0);
    expect(recorder.countOf('GET', PENDING_URL)).toBe(0);
    expect(recorder.countOf('GET', DETAIL_URL)).toBe(0);
    expect(isFresh(qc, workflowInstanceKeys.list(LIST_PARAMS))).toBe(true);
    expect(isFresh(qc, workflowInstanceKeys.detail(7))).toBe(true);
  });
});
