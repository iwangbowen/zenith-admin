import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { regionContract, type CreateRegionInput, type Region } from '@zenith/shared/platform';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type RegionTreeParams = NonNullable<QueryOf<typeof regionContract.tree>>;

export const regionKeys = {
  all: [resourceKeyOf(regionContract.basePath)] as const,
  trees: contractKey(regionContract.tree),
  tree: (params: RegionTreeParams) => contractKey(regionContract.tree, { query: params }),
  /** 无筛选条件的全量树，供地区级联选择器等下拉场景长期缓存 */
  lookupTree: contractKey(regionContract.tree, { query: {} }),
  flat: contractKey(regionContract.flat),
  detail: (id: number | undefined) => contractKey(regionContract.detail, { params: { id: id ?? 0 } }),
};

export function useRegionTree(params: RegionTreeParams) {
  return useApiQuery(regionContract.tree, { query: params });
}

export function useFlatRegions(options?: { enabled?: boolean }) {
  return useApiQuery(regionContract.flat, { staleTime: LOOKUP_STALE_TIME, enabled: options?.enabled ?? true });
}

export function useRegionLookupTree() {
  return useApiQuery(regionContract.tree, { query: {} }, { staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } });
}

export function useRegionDetail(id: number | undefined, enabled = true) {
  return useApiQuery(regionContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 树（含下拉树）与扁平列表都直接渲染地区名称与层级，改动后都需回源 */
function invalidateRegionViews(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: regionKeys.trees });
  void qc.invalidateQueries({ queryKey: regionKeys.flat });
}

/** 无 id 走 create，有 id 走 update；同一表单同时服务新增与编辑 */
export function useSaveRegion() {
  const qc = useQueryClient();
  return useMutation<Region, Error, { id?: number; values: Partial<CreateRegionInput> }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(regionContract.create, { body: values as CreateRegionInput })
      : api(regionContract.update, { params: { id }, body: values })),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: regionKeys.detail(saved.id) });
      invalidateRegionViews(qc);
    },
  });
}

export function useDeleteRegion() {
  return useApiMutation(regionContract.remove, {
    invalidate: (qc, _output, { params }) => {
      // 详情缓存必须移除而非失效：失效会让已删除记录在下次挂载时重新请求并 404
      qc.removeQueries({ queryKey: regionKeys.detail(params.id) });
      invalidateRegionViews(qc);
    },
  });
}
