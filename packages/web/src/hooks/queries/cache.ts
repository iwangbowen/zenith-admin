import { resourceKeyOf } from '@zenith/shared/core';
import { cacheContract } from '@zenith/shared/platform';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const cacheKeys = {
  all: [resourceKeyOf(cacheContract.basePath)] as const,
  lists: contractKey(cacheContract.list),
  overview: contractKey(cacheContract.overview),
  value: (key: string | undefined) => contractKey(cacheContract.value, { query: { key: key ?? '' } }),
};

/** 全量 key 列表：关键词筛选在页面按分类 / displayKey 本地完成 */
export function useCacheList() {
  return useApiQuery(cacheContract.list, { query: {} });
}

export function useCacheOverview() {
  return useApiQuery(cacheContract.overview, { requestOptions: { silent: true } });
}

export function useCacheValue(key: string | undefined, enabled = true) {
  return useApiQuery(cacheContract.value, { query: { key: key ?? '' } }, { enabled: enabled && key !== undefined });
}

/** 任何写操作都会改变 key 集合 / 概览计数 / 值预览，整域失效 */
const invalidateAll = (qc: import('@tanstack/react-query').QueryClient) => void qc.invalidateQueries({ queryKey: cacheKeys.all });

export function useDeleteCacheKey() {
  return useApiMutation(cacheContract.removeKey, { invalidate: invalidateAll });
}

export function useBatchDeleteCacheKeys() {
  return useApiMutation(cacheContract.removeKeys, { invalidate: invalidateAll });
}

export function useDeleteCacheCategory() {
  return useApiMutation(cacheContract.removeByCategory, { invalidate: invalidateAll });
}

export function useClearAllCache() {
  return useApiMutation(cacheContract.removeAll, { invalidate: invalidateAll });
}

export function useUpdateCacheTtl() {
  return useApiMutation(cacheContract.updateTtl, { invalidate: invalidateAll });
}

export function useUpdateCacheValue() {
  return useApiMutation(cacheContract.updateValue, { invalidate: invalidateAll });
}
