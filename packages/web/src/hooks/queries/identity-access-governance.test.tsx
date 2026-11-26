import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
import { useRoleUsers } from './roles';
import { useAccessGrantList, useAccessReviewCampaignList, useAccessReviewItemList, useAccessUserOverview, useAccessWorkflowOptions, useDecideAccessReviewItem, usePermissionPolicyList, useRevokeAccessGrantItem, useUpdatePermissionPolicy } from './identity-access-governance';

const params = { page: 1, pageSize: 10 };
const empty = { list: [], total: 0, page: 1, pageSize: 10 };

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', '/api/access-governance/grants', empty)
    .on('GET', '/api/access-governance/policies', empty)
    .on('GET', '/api/access-governance/workflow-options', { roles: [], scope: { pages: [], selectablePageIds: [], permissions: [] } })
    .on('GET', '/api/access-governance/users/5/overview', { userId: 5, grants: [], reviews: [] })
    .on('GET', '/api/access-governance/review-campaigns', empty)
    .on('GET', '/api/access-governance/review-items', empty)
    .on('GET', '/api/roles/7/users', [])
    .on('POST', '/api/access-governance/grant-items/9/revoke', { id: 2, userId: 5, menus: [] })
    .on('POST', '/api/access-governance/review-items/4/decide', { id: 4, userId: 5, sourceType: 'role', sourceId: 7, snapshot: {} })
    .on('PUT', /\/policies\/example(?:%3A|:)list/, { id: 1, permissionCode: 'example:list', version: 2 });
});

describe('access governance mutation cache ownership', () => {
  it('refreshes grant and beneficiary views after a single-item revoke without reloading policy metadata', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({ grants: useAccessGrantList(params), overview: useAccessUserOverview(5), policies: usePermissionPolicyList(params), options: useAccessWorkflowOptions(), revoke: useRevokeAccessGrantItem() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect([hook.result.current.grants, hook.result.current.overview, hook.result.current.policies, hook.result.current.options].every(query => query.isSuccess)).toBe(true));
    recorder.resetCalls();
    await hook.result.current.revoke.mutateAsync({ params: { id: 9 }, body: { reason: '回归测试撤销' } });
    await waitFor(() => expect(recorder.countOf('GET', '/api/access-governance/grants')).toBe(1));
    expect(recorder.countOf('GET', '/api/access-governance/users/5/overview')).toBe(1);
    expect(recorder.countOf('GET', '/api/access-governance/policies')).toBe(0);
    expect(recorder.countOf('GET', '/api/access-governance/workflow-options')).toBe(0);
  });

  it('refreshes the real role membership and campaign counts after a review decision', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({ users: useRoleUsers(7), campaigns: useAccessReviewCampaignList(params), items: useAccessReviewItemList(params), decide: useDecideAccessReviewItem() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect([hook.result.current.users, hook.result.current.campaigns, hook.result.current.items].every(query => query.isSuccess)).toBe(true));
    recorder.resetCalls();
    await hook.result.current.decide.mutateAsync({ params: { id: 4 }, body: { decision: 'revoke', remark: '确认已不再需要此角色' } });
    await waitFor(() => expect(recorder.countOf('GET', '/api/roles/7/users')).toBe(1));
    expect(recorder.countOf('GET', '/api/access-governance/review-campaigns')).toBe(1);
    expect(recorder.countOf('GET', '/api/access-governance/review-items')).toBe(1);
  });

  it('reloads effective request options when a policy changes without refetching unrelated grants', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(() => ({ grants: useAccessGrantList(params), policies: usePermissionPolicyList(params), options: useAccessWorkflowOptions(), update: useUpdatePermissionPolicy() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect([hook.result.current.grants, hook.result.current.policies, hook.result.current.options].every(query => query.isSuccess)).toBe(true));
    recorder.resetCalls();
    await hook.result.current.update.mutateAsync({ params: { permissionCode: 'example:list' }, body: { riskLevel: 'low', approvalPolicy: 'manager', maxDurationMinutes: null, reviewIntervalDays: 0, mfaRequired: false, enabled: true, permanentAllowed: false, emergencyAllowed: false, maxEmergencyMinutes: 60 } });
    await waitFor(() => expect(recorder.countOf('GET', '/api/access-governance/workflow-options')).toBe(1));
    expect(recorder.countOf('GET', '/api/access-governance/policies')).toBe(1);
    expect(recorder.countOf('GET', '/api/access-governance/grants')).toBe(0);
  });
});
