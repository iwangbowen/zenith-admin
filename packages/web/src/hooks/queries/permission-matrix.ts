import { apiCatalogContract, permissionCatalogContract, permissionMatrixContract } from '@zenith/shared/identity';
import { contractKey, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export const apiCatalogKeys = {
  catalog: contractKey(apiCatalogContract.get),
  permissions: contractKey(permissionCatalogContract.list),
};

/**
 * 接口目录：服务端从契约派生（前端不 import 契约聚合，避免各域契约进共享分包）。
 * 目录只随发布变化，缓存视为不过期；页面「查询 / 重置」仅在客户端过滤，显式刷新仍可重新获取。
 */
export function useApiCatalog() {
  return useApiQuery(apiCatalogContract.get, { staleTime: Infinity });
}

/** 权限目录：能力定义、形态和页面绑定；API-only 权限也包含在内。 */
export function usePermissionCatalog() {
  return useApiQuery(permissionCatalogContract.list, { staleTime: Infinity });
}

/**
 * 权限矩阵的数据面：只取「主体持有哪些权限码」，判定在浏览器内用 judgeOperation 完成。
 */
export function useRolePermissionSets(enabled = true) {
  return useApiQuery(permissionMatrixContract.roles, { enabled, staleTime: LOOKUP_STALE_TIME });
}

export function useUserPermissionSet(userId: number | null) {
  return useApiQuery(permissionMatrixContract.user, { params: { id: userId ?? 0 } }, { enabled: userId != null, staleTime: LOOKUP_STALE_TIME });
}
