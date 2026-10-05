import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { workflowEventSubscriptionContract } from '@zenith/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
import { useToggleWorkflowEventSubscription, useWorkflowEventDeliveries, useWorkflowEventSubscriptionDetail, useWorkflowEventSubscriptionList } from './workflow-event-subscriptions';

describe('event subscription cache consistency', () => {
  beforeEach(() => { recorder.resetCalls(); });

  it('refreshes delivery action gates together with the toggled subscription', async () => {
    let enabled = false;
    const list = workflowEventSubscriptionContract.list.fullPath;
    const detail = workflowEventSubscriptionContract.detail.fullPath.replace('{id}', '1');
    const deliveries = workflowEventSubscriptionContract.deliveries.fullPath;
    const toggle = workflowEventSubscriptionContract.toggle.fullPath.replace('{id}', '1');
    recorder.on('GET', list, () => ({ list: [{ id: 1, enabled }], total: 1, page: 1, pageSize: 20 }))
      .on('GET', detail, () => ({ id: 1, enabled }))
      .on('GET', deliveries, () => ({ list: [{ id: 10, jobStatus: 'dead', canRetry: enabled }], total: 1, page: 1, pageSize: 20 }))
      .on('PATCH', toggle, () => { enabled = true; return { id: 1, enabled }; });
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      list: useWorkflowEventSubscriptionList({}), detail: useWorkflowEventSubscriptionDetail(1),
      deliveries: useWorkflowEventDeliveries({ subscriptionId: 1 }), toggle: useToggleWorkflowEventSubscription(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.detail.isSuccess && result.current.deliveries.isSuccess).toBe(true));
    expect(result.current.deliveries.data?.list[0].canRetry).toBe(false);
    recorder.resetCalls();
    await result.current.toggle.mutateAsync({ params: { id: 1 }, body: { enabled: true } });
    await waitFor(() => expect(result.current.deliveries.data?.list[0].canRetry).toBe(true));
    expect(recorder.countOf('GET', deliveries)).toBe(1);
    expect(recorder.countOf('GET', detail)).toBe(1);
    expect(recorder.countOf('GET', list)).toBe(1);
  });
});
