import { tenantPackageContract } from '@zenith/shared/identity';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { invalidateCurrentUserAccess } from './menus';

export const {
  keys: tenantPackageKeys,
  useList: useTenantPackageList,
  useDetail: useTenantPackageDetail,
  useSave: useSaveTenantPackage,
  useDelete: useDeleteTenantPackages,
  useLookup: useAllTenantPackages,
} = createResourceQueries(tenantPackageContract);

/**
 * 分配套餐可授权功能。
 *
 * 刻意**不**失效下拉源：`features` 不进入下拉源（仅列表/详情返回），
 * 失效下拉源纯属无谓回源（由 lookup-collateral.test.tsx 锁定）。
 * 但套餐功能收紧会影响当前登录者的可访问范围，故需刷新用户权限。
 */
export function useAssignTenantPackageFeatures() {
  return useApiMutation(tenantPackageContract.assignFeatures, {
    // features 在列表行与详情中都返回，功能变更需同时刷新两者
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: tenantPackageKeys.lists });
      void qc.invalidateQueries({ queryKey: tenantPackageKeys.detail(params.id) });
    },
    onSuccess: (_output, _variables, _result, { client }) => invalidateCurrentUserAccess(client, true),
  });
}
