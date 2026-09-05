import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsPageContract } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type CmsPageListParams = NonNullable<QueryOf<typeof cmsPageContract.list>>;

const resource = createResourceQueries(cmsPageContract);

export const cmsPageKeys = {
  ...resource.keys,
  acls: (id: number | undefined) => contractKey(cmsPageContract.blockAcls, { params: { id: id ?? 0 }, query: {} }),
};

export function useCmsPageList(params: Omit<CmsPageListParams, 'siteId'> & { siteId: number | undefined }) {
  return useQuery({
    ...apiQueryOptions(cmsPageContract.list, { query: { ...params, siteId: params.siteId ?? 0 } }),
    enabled: !!params.siteId,
    placeholderData: keepPreviousData,
  });
}

export function useCmsPageDetail(id: number | undefined) {
  return resource.useDetail(id, !!id);
}

export const useSaveCmsPage = resource.useSave;
export const useDeleteCmsPages = resource.useDelete;

export function useCmsPageBlockAcls(id: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsPageContract.blockAcls, { params: { id: id ?? 0 }, query: {} }),
    enabled: enabled && !!id,
  });
}

/** 区块 ACL 决定详情里各区块的 canManage / aclConfigured 标记 */
export function useSetCmsPageBlockAcls() {
  return useApiMutation(cmsPageContract.setBlockAcls, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsPageKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsPageKeys.acls(params.id) });
    },
  });
}
