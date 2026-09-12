import { authContract, tenantContract } from '@zenith/shared/identity';
import { createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const {
  keys: tenantKeys,
  useList: useTenantList,
  useDetail: useTenantDetail,
  useSave: useSaveTenant,
  useDelete: useDeleteTenants,
  useLookup: useAllTenants,
} = createResourceQueries(tenantContract);

export function useTenantStats(id: number | undefined, enabled = true) {
  return useApiQuery(tenantContract.stats, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 切换当前查看的租户——换发 token 后整页重载，故不做缓存失效 */
export function useSwitchTenant() {
  return useApiMutation(authContract.switchTenant);
}
