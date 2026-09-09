import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { developerAppContract } from '@zenith/shared/open-platform';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MyAppListParams = QueryOf<typeof developerAppContract.list>;

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveMyAppValues = BodyOf<typeof developerAppContract.update>;

export type DebugMyAppValues = BodyOf<typeof developerAppContract.debug>;

const DEVELOPER_APP_KEY = resourceKeyOf(developerAppContract.basePath);

export const developerAppKeys = {
  all: [DEVELOPER_APP_KEY] as const,
  lists: contractKey(developerAppContract.list),
  list: (params: MyAppListParams) => contractKey(developerAppContract.list, { query: params }),
  detail: (id: number) => contractKey(developerAppContract.detail, { params: { id } }),
  quota: (id: number) => contractKey(developerAppContract.quotaUsage, { params: { id } }),
  debugEndpoints: contractKey(developerAppContract.debugEndpoints),
};

/**
 * 应用写操作（创建 / 更新 / 删除 / 提交审核 / 轮换密钥）改变列表、详情与配额用量，
 * 端点目录是低频字典型数据、与应用无关，所以失效列表与按 id 的查询而非整个资源根。
 */
function invalidateMyApps(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: developerAppKeys.lists });
  void qc.invalidateQueries({ queryKey: contractKey(developerAppContract.detail) });
  void qc.invalidateQueries({ queryKey: contractKey(developerAppContract.quotaUsage) });
}

/** 可调试的开放 API 端点目录（由服务端按实际路由派生，属低频字典型数据） */
export function useDebugEndpoints() {
  return useApiQuery(developerAppContract.debugEndpoints, { staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } });
}

export function useMyAppList(params: MyAppListParams) {
  return useApiQuery(developerAppContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useMyAppDetail(id: number | undefined, enabled = true) {
  return useApiQuery(developerAppContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 无 id 走创建（POST，返回含一次性 clientSecret），有 id 走更新（PUT） */
export function useSaveMyApp() {
  return useSaveMutation(developerAppContract.create, developerAppContract.update, {
    invalidate: (qc) => invalidateMyApps(qc),
  });
}

export function useDeleteMyApp() {
  return useApiMutation(developerAppContract.remove, { invalidate: invalidateMyApps });
}

export function useSubmitMyApp() {
  return useApiMutation(developerAppContract.submit, { invalidate: invalidateMyApps });
}

export function useRotateMyAppSecret() {
  return useApiMutation(developerAppContract.regenerateSecret, { invalidate: invalidateMyApps });
}

export function useMyAppQuota(id: number | undefined, enabled = true) {
  return useApiQuery(developerAppContract.quotaUsage, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    refetchInterval: 10_000,
  });
}

/** 在线调试只读取网关响应，不改变任何缓存 */
export function useDebugMyApp() {
  return useApiMutation(developerAppContract.debug);
}
