import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));
import { useCmsFeedbackDetail, useCmsFeedbackList, useCmsFeedbackWorkflow, useCmsEditorialWorkspace, useHandleCmsFeedback } from './cms-operations';

beforeEach(() => {
  api.reset();
  api.on('GET', '/api/cms/operations/feedback', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/cms/operations/feedback/1', { id: 1, status: 'new', version: 1, workflowStatus: null })
    .on('GET', '/api/cms/operations/feedback/1/workflow', { instance: null, previousInstances: [] })
    .on('GET', '/api/cms/operations/workspace', { list: [], total: 0, page: 1, pageSize: 10, counters: [] })
    .on('POST', '/api/cms/operations/feedback/1/handle', { id: 1, status: 'processing', version: 2, workflowStatus: null });
});
describe('CMS feedback cache refresh', () => {
  it('refreshes list, detail, workflow context and workspace after handling', async () => {
    const hook = renderHook(() => ({ list: useCmsFeedbackList({ siteId: 1 }), detail: useCmsFeedbackDetail(1), workflow: useCmsFeedbackWorkflow(1), workspace: useCmsEditorialWorkspace({ siteId: 1 }), handle: useHandleCmsFeedback() }), { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => expect(hook.result.current.list.isSuccess && hook.result.current.detail.isSuccess && hook.result.current.workflow.isSuccess && hook.result.current.workspace.isSuccess).toBe(true));
    api.on('GET', '/api/cms/operations/feedback/1', { id: 1, status: 'processing', version: 2, workflowStatus: null });
    await act(() => hook.result.current.handle.mutateAsync({ params: { id: 1 }, body: { expectedVersion: 1, status: 'processing', note: '受理' } }));
    await waitFor(() => expect(hook.result.current.detail.data?.version).toBe(2));
    await waitFor(() => {
      for (const path of ['/api/cms/operations/feedback', '/api/cms/operations/feedback/1', '/api/cms/operations/feedback/1/workflow', '/api/cms/operations/workspace']) expect(api.countOf('GET', path)).toBe(2);
    });
    hook.unmount();
  });
});
