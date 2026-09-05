import { useQuery } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsModelContract } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type CmsModelListParams = NonNullable<QueryOf<typeof cmsModelContract.list>>;

/** 同一表单同时服务新增与编辑，必填字段由表单 rules 保证、服务端 schema 兜底校验 */
export type CmsModelSaveValues = Partial<BodyOf<typeof cmsModelContract.create>>;

const resource = createResourceQueries(cmsModelContract);

export const cmsModelKeys = {
  ...resource.keys,
  allModels: (siteId?: number) => contractKey(cmsModelContract.all, { query: { siteId } }),
  refs: (id: number | undefined, siteId?: number) => contractKey(cmsModelContract.refs, { params: { id: id ?? 0 }, query: { siteId } }),
};

export const useCmsModelList = resource.useList;
export const useCmsModelDetail = resource.useDetail;

/** 全部启用模型；siteId 提供时按站群可见性过滤（平台共享 + 该站点专属） */
export function useAllCmsModels(siteId?: number) {
  return useQuery({
    ...apiQueryOptions(cmsModelContract.all, { query: { siteId } }),
    staleTime: LOOKUP_STALE_TIME,
  });
}

/**
 * 模型写入按站点范围校验（siteId 随更新 / 删除以查询参数携带）；
 * 字段整组替换会影响下拉源与详情，按域根整体失效
 */
export function useSaveCmsModel(siteId?: number) {
  const create = useApiMutation(cmsModelContract.create, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsModelKeys.all }),
  });
  const update = useApiMutation(cmsModelContract.update, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsModelKeys.all }),
  });
  return {
    mutateAsync: ({ id, values }: { id?: number; values: CmsModelSaveValues }) =>
      id === undefined
        ? create.mutateAsync({ body: values as BodyOf<typeof cmsModelContract.create> })
        : update.mutateAsync({ params: { id }, query: { siteId }, body: values }),
    isPending: create.isPending || update.isPending,
  };
}

export function useDeleteCmsModel(siteId?: number) {
  const remove = useApiMutation(cmsModelContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsModelKeys.all }),
  });
  return {
    mutateAsync: (id: number) => remove.mutateAsync({ params: { id }, query: { siteId } }),
    isPending: remove.isPending,
  };
}
