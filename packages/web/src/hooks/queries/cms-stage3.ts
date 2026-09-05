import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsPublishingContract } from '@zenith/shared/cms';
import { asyncTaskKeys } from './async-tasks';
import { apiQueryOptions, contractKey, useApiMutation } from '@/lib/contract-query';

export type CmsPublishingListParams = NonNullable<QueryOf<typeof cmsPublishingContract.list>>;

export type CmsPublishArtifactListParams = NonNullable<QueryOf<typeof cmsPublishingContract.artifacts>>;

/** 发布任务、产物与详情同源于任务表：任何提交 / 操作都按域根失效 */
export const cmsPublishingKeys = {
  all: [contractKey(cmsPublishingContract.list)[0]] as const,
  lists: contractKey(cmsPublishingContract.list),
  list: (params: CmsPublishingListParams) => contractKey(cmsPublishingContract.list, { query: params }),
  detail: (id: number | undefined) => contractKey(cmsPublishingContract.detail, { params: { id: id ?? 0 } }),
  artifacts: contractKey(cmsPublishingContract.artifacts),
  artifactList: (params: CmsPublishArtifactListParams) => contractKey(cmsPublishingContract.artifacts, { query: params }),
};

const ACTIVE_TASK_STATUSES = ['pending', 'running'];

export function useCmsPublishingList(params: CmsPublishingListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsPublishingContract.list, { query: params }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => query.state.data?.list.some((item) => ACTIVE_TASK_STATUSES.includes(item.status)) ? 4000 : false,
  });
}

export function useCmsPublishingDetail(id: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsPublishingContract.detail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
    refetchInterval: (query) => query.state.data && ACTIVE_TASK_STATUSES.includes(query.state.data.task.status) ? 3000 : false,
  });
}

export function useCmsPublishArtifactList(params: CmsPublishArtifactListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsPublishingContract.artifacts, { query: params }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSubmitCmsPublish() {
  return useApiMutation(cmsPublishingContract.submit, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsPublishingKeys.all }),
  });
}

export function useCmsPublishingAction() {
  return useApiMutation(cmsPublishingContract.action, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsPublishingKeys.all }),
  });
}

export function useBatchCmsPublishingAction() {
  return useApiMutation(cmsPublishingContract.batchAction, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsPublishingKeys.all }),
  });
}

/** 站群整组重建会为每个受影响站点提交发布任务，「我的任务」列表随之变化 */
export function useSubmitCmsSiteGroupPublish() {
  return useApiMutation(cmsPublishingContract.groupSubmit, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsPublishingKeys.all });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.all });
    },
  });
}
