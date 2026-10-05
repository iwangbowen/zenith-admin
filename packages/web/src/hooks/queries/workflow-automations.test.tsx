import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, isInvalidated, observeFetches } from '@/test-utils/query-harness';
const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));
import { useRetryWorkflowAutomationRun, useWorkflowAutomationList, useWorkflowAutomationRunList, workflowAutomationKeys } from './workflow-automations';
const ruleQuery = { page: 1, pageSize: 20 };
const runQuery = { ruleId: 7, page: 1, pageSize: 20 };

beforeEach(() => {
  api.reset();
  api.on('GET', '/api/workflows/automations', { list: [], total: 0, page: 1, pageSize: 20 })
    .on('GET', '/api/workflows/automations/runs', { list: [], total: 0, page: 1, pageSize: 20 })
    .on('POST', '/api/workflows/automations/runs/81/retry', { id: 81, status: 'pending', attempts: 0 });
});
describe('independent automation recovery', () => {
  it('refreshes actual run queries after retry without invalidating the rule configuration list', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({ rules: useWorkflowAutomationList(ruleQuery),
      runs: useWorkflowAutomationRunList(runQuery), retry: useRetryWorkflowAutomationRun() }), { wrapper: createWrapper(qc) });
    await waitFor(() => { expect(hook.result.current.rules.isSuccess).toBe(true); expect(hook.result.current.runs.isSuccess).toBe(true); });
    const fetches = observeFetches(qc); api.resetCalls();
    await hook.result.current.retry.mutateAsync({ params: { id: 81 } });
    await waitFor(() => expect(api.countOf('GET', '/api/workflows/automations/runs')).toBeGreaterThan(0));
    expect(fetches.countOf(workflowAutomationKeys.runs)).toBeGreaterThan(0);
    expect(fetches.countOf(workflowAutomationKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/workflows/automations')).toBe(0);
    expect(isInvalidated(qc, workflowAutomationKeys.list(ruleQuery))).toBe(false);
    fetches.stop(); hook.unmount(); qc.clear();
  });
});
