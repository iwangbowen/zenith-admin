import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { workflowInstanceContract } from '@zenith/shared/workflow';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/contract-query', async importOriginal => ({ ...await importOriginal<object>(), api: request }));
import { useSubmitApprovalDraft, useUpdateApprovalDraft, approvalKeys } from './queries';
import { approvalRequest } from './approval-request';

describe('mobile draft cache revision and submission', () => {
  it('updates the editor revision without replacing its definition or current input session', async () => {
    const client = createTestQueryClient();
    const original = { instance: { id: 7, draftRevision: 2, formData: { costType: '差旅费' } }, definition: { id: 6, version: 4 }, formRevision: 8, versionChanged: false };
    client.setQueryData(['approval', 'draft-editor', 7], original);
    const saved = { ...original.instance, draftRevision: 3 };
    request.mockResolvedValueOnce(saved);
    const { result, unmount } = renderHook(useUpdateApprovalDraft, { wrapper: createWrapper(client) });
    await act(() => result.current.mutateAsync({ id: 7, body: { expectedRevision: 2, formData: { costType: '差旅费' } } }));
    await waitFor(() => expect(client.getQueryData(['approval', 'draft-editor', 7])).toEqual({ ...original, instance: saved }));
    expect(request).toHaveBeenLastCalledWith(workflowInstanceContract.updateDraft, expect.objectContaining({ params: { id: 7 } }), { client: approvalRequest });
    unmount(); client.clear();
  });

  it('invalidates displayed detail and statistics and discards the submitted editor', async () => {
    const client = createTestQueryClient();
    client.setQueryData(['approval', 'draft-editor', 7], { instance: { id: 7 } });
    client.setQueryData(approvalKeys.detail(7), { status: 'draft' });
    client.setQueryData(['approval', 'statistics', undefined], { total: 2 });
    request.mockResolvedValueOnce({ id: 7, status: 'running' });
    const { result, unmount } = renderHook(useSubmitApprovalDraft, { wrapper: createWrapper(client) });
    await act(() => result.current.mutateAsync({ id: 7, expectedRevision: 3 }));
    expect(client.getQueryData(['approval', 'draft-editor', 7])).toBeUndefined();
    expect(client.getQueryState(approvalKeys.detail(7))?.isInvalidated).toBe(true);
    expect(client.getQueryState(['approval', 'statistics', undefined])?.isInvalidated).toBe(true);
    unmount(); client.clear();
  });
});
