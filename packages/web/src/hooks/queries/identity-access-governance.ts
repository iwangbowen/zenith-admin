import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { accessGovernanceContract, type AccessReviewItem } from '@zenith/shared/identity';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateCurrentUserAccess } from './menus';
import { userKeys } from './users';
import { roleKeys } from './roles';
import { userGroupKeys } from './user-groups';
import { scopeMemberKeys } from './scope-members';

export type AccessRequestListQuery = NonNullable<QueryOf<typeof accessGovernanceContract.requestList>>;
export type AccessGrantListQuery = NonNullable<QueryOf<typeof accessGovernanceContract.grantList>>;
export type AccessReviewCampaignListQuery = NonNullable<QueryOf<typeof accessGovernanceContract.reviewCampaignList>>;
export type AccessReviewItemListQuery = NonNullable<QueryOf<typeof accessGovernanceContract.reviewItemList>>;
export type PermissionPolicyListQuery = NonNullable<QueryOf<typeof accessGovernanceContract.policyList>>;

export const identityAccessGovernanceKeys = {
  workflowResults: contractKey(accessGovernanceContract.workflowResult),
  workflowOptions: contractKey(accessGovernanceContract.workflowOptions),
  all: ['identity-access-governance'] as const,
  myRequests: contractKey(accessGovernanceContract.myRequests),
  myGrants: contractKey(accessGovernanceContract.myGrants),
  reviewOptions: contractKey(accessGovernanceContract.reviewOptions),
  requests: contractKey(accessGovernanceContract.requestList),
  grants: contractKey(accessGovernanceContract.grantList),
  reviewCampaigns: contractKey(accessGovernanceContract.reviewCampaignList),
  reviewItems: contractKey(accessGovernanceContract.reviewItemList),
  policies: contractKey(accessGovernanceContract.policyList),
  // 详情按 id 缓存：治理页的"关联申请 / 来源授权 / 用户概览"跳转复用同一份记录
  requestDetail: (id: number | null | undefined) => contractKey(accessGovernanceContract.requestDetail, { params: { id: id ?? 0 } }),
  grantDetail: (id: number | null | undefined) => contractKey(accessGovernanceContract.grantDetail, { params: { id: id ?? 0 } }),
  userOverview: (id: number | null | undefined) => contractKey(accessGovernanceContract.userOverview, { params: { id: id ?? 0 } }),
};

export function useAccessWorkflowResult(instanceId: number | null | undefined) {
  return useApiQuery(accessGovernanceContract.workflowResult, { params: { id: instanceId ?? 0 } }, {
    enabled: instanceId != null,
    refetchInterval: state => state.state.data && ['pending', 'running'].includes(state.state.data.request.provisionStatus) ? 3000 : 30_000,
  });
}
export function useGovernanceRequestWorkflow(id: number | null) {
  return useApiQuery(accessGovernanceContract.requestWorkflow, { params: { id: id ?? 0 } }, { enabled: id !== null });
}

export function useAccessWorkflowOptions(enabled = true) {
  return useApiQuery(accessGovernanceContract.workflowOptions, undefined, { enabled, staleTime: 0, refetchOnMount: 'always' });
}

export function useAccessWorkflowPreview(body: BodyOf<typeof accessGovernanceContract.workflowPreview>, enabled: boolean) {
  return useApiQuery(accessGovernanceContract.workflowPreview, { body }, { enabled, staleTime: 0 });
}

export function useAccessRequestList(query: AccessRequestListQuery, enabled = true) {
  return useApiQuery(accessGovernanceContract.requestList, { query }, { enabled, placeholderData: keepPreviousData, refetchInterval: state => state.state.data?.list.some(request => ['pending', 'running'].includes(request.provisionStatus)) ? 3000 : false });
}

export function useAccessGrantList(query: AccessGrantListQuery, enabled = true) {
  return useApiQuery(accessGovernanceContract.grantList, { query }, { enabled, placeholderData: keepPreviousData });
}

export function useAccessReviewCampaignList(query: AccessReviewCampaignListQuery, enabled = true) {
  return useApiQuery(accessGovernanceContract.reviewCampaignList, { query }, { enabled, placeholderData: keepPreviousData, refetchInterval: state => state.state.data?.list.some(campaign => campaign.status === 'preparing') ? 2000 : false });
}

export function useAccessReviewItemList(query: AccessReviewItemListQuery, enabled = true) {
  return useApiQuery(accessGovernanceContract.reviewItemList, { query }, { enabled, placeholderData: keepPreviousData });
}

export function usePermissionPolicyList(query: PermissionPolicyListQuery, enabled = true) {
  return useApiQuery(accessGovernanceContract.policyList, { query }, { enabled, placeholderData: keepPreviousData });
}

/** 单条申请详情（临时授权详情里的「关联申请」按 id 拉取） */
export function useAccessRequestDetail(id: number | null | undefined, enabled = true) {
  return useApiQuery(accessGovernanceContract.requestDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id != null });
}

/** 单条临时授权详情（权限复核详情里的「来源授权」按 id 拉取） */
export function useAccessGrantDetail(id: number | null | undefined, enabled = true) {
  return useApiQuery(accessGovernanceContract.grantDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id != null });
}

/** 用户权限治理概览（该用户的临时授权与复核项） */
export function useAccessUserOverview(id: number | null | undefined, enabled = true) {
  return useApiQuery(accessGovernanceContract.userOverview, { params: { id: id ?? 0 } }, { enabled: enabled && id != null });
}

export function invalidateAccessRequests(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: identityAccessGovernanceKeys.workflowResults });
  for (const queryKey of [identityAccessGovernanceKeys.requests, identityAccessGovernanceKeys.myRequests, contractKey(accessGovernanceContract.requestDetail)]) void qc.invalidateQueries({ queryKey });
}

function invalidateAccessGrants(qc: QueryClient, userId: number): void {
  void qc.invalidateQueries({ queryKey: identityAccessGovernanceKeys.workflowResults });
  for (const queryKey of [identityAccessGovernanceKeys.grants, identityAccessGovernanceKeys.myGrants, contractKey(accessGovernanceContract.grantDetail), identityAccessGovernanceKeys.userOverview(userId), userKeys.effectivePermissions(userId), userKeys.dataPermission(userId)]) void qc.invalidateQueries({ queryKey });
  invalidateCurrentUserAccess(qc);
}

export function useRevokeAccessGrant() {
  return useApiMutation(accessGovernanceContract.grantRevoke, { invalidate: (qc, grant) => invalidateAccessGrants(qc, grant.userId) });
}

export function useRevokeAccessGrantItem() {
  return useApiMutation(accessGovernanceContract.grantItemRevoke, { invalidate: (qc, grant) => invalidateAccessGrants(qc, grant.userId) });
}

export function useRetryAccessProvision() {
  return useApiMutation(accessGovernanceContract.requestRetry, { invalidate: (qc, request) => { invalidateAccessRequests(qc); invalidateAccessGrants(qc, request.targetUserId); } });
}

function invalidateAccessReview(qc: QueryClient, item: AccessReviewItem): void {
  for (const queryKey of [identityAccessGovernanceKeys.reviewItems, identityAccessGovernanceKeys.reviewCampaigns, userKeys.detail(item.userId), userKeys.lists]) void qc.invalidateQueries({ queryKey });
  invalidateAccessGrants(qc, item.userId);
  if (item.sourceType === 'role' && item.sourceId) {
    for (const queryKey of [roleKeys.users(item.sourceId), roleKeys.lists, scopeMemberKeys.of('role', item.sourceId)]) void qc.invalidateQueries({ queryKey });
  }
  if (item.sourceType === 'group_membership' && typeof item.snapshot.groupId === 'number') {
    for (const queryKey of [userGroupKeys.members(item.snapshot.groupId), userGroupKeys.lists, scopeMemberKeys.of('userGroup', item.snapshot.groupId)]) void qc.invalidateQueries({ queryKey });
  }
}

export function useDecideAccessReviewItem() {
  return useApiMutation(accessGovernanceContract.reviewItemDecide, { invalidate: invalidateAccessReview });
}

export function useMyAccessRequests(query: AccessRequestListQuery, enabled = true) {
  return useApiQuery(accessGovernanceContract.myRequests, { query }, { enabled, placeholderData: keepPreviousData, refetchInterval: state => state.state.data?.list.some(request => ['pending', 'running'].includes(request.provisionStatus)) ? 3000 : false });
}

export function useMyAccessGrants(query: AccessGrantListQuery, enabled = true) {
  return useApiQuery(accessGovernanceContract.myGrants, { query }, { enabled, placeholderData: keepPreviousData });
}

export function useAccessReviewOptions(enabled = true) {
  return useApiQuery(accessGovernanceContract.reviewOptions, undefined, { enabled });
}

export function useAssignAccessReviewCampaign() {
  return useApiMutation(accessGovernanceContract.reviewCampaignAssign, { invalidate: qc => {
    void qc.invalidateQueries({ queryKey: identityAccessGovernanceKeys.reviewCampaigns });
    void qc.invalidateQueries({ queryKey: identityAccessGovernanceKeys.reviewItems });
  } });
}

export function useRetryAccessReviewCampaign() {
  return useApiMutation(accessGovernanceContract.reviewCampaignRetry, { invalidate: qc => { void qc.invalidateQueries({ queryKey: identityAccessGovernanceKeys.reviewCampaigns }); } });
}

export function useCreateAccessReviewCampaign() {
  return useApiMutation(accessGovernanceContract.reviewCampaignCreate, {
    invalidate: (queryClient) => {
      void queryClient.invalidateQueries({ queryKey: identityAccessGovernanceKeys.reviewCampaigns });
      void queryClient.invalidateQueries({ queryKey: identityAccessGovernanceKeys.reviewItems });
    },
  });
}

export function useUpdatePermissionPolicy() {
  return useApiMutation(accessGovernanceContract.policyUpdate, {
    invalidate: (queryClient) => {
      void queryClient.invalidateQueries({ queryKey: identityAccessGovernanceKeys.policies });
      void queryClient.invalidateQueries({ queryKey: identityAccessGovernanceKeys.workflowOptions });
    },
  });
}

export function useSavePermissionPolicy() {
  const mutation = useUpdatePermissionPolicy();
  return {
    isPending: mutation.isPending,
    mutateAsync: async ({ id: _id, values }: { id?: number; values: Parameters<typeof mutation.mutateAsync>[0]['body'] & { permissionCode: string } }) => {
      if (!values?.permissionCode) throw new Error('缺少权限码');
      return mutation.mutateAsync({ params: { permissionCode: values.permissionCode }, body: values });
    },
  };
}
