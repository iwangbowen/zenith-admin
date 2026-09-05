import type { QueryClient } from '@tanstack/react-query';
import { systemConfigContract } from '@zenith/shared/platform';
import { contractKey, createResourceQueries, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/** 密码策略与公开配置都是配置表派生的读视图，任一条配置增删改都可能影响它们 */
const PASSWORD_POLICY_KEY = contractKey(systemConfigContract.passwordPolicy);
const PUBLIC_PREFIX = contractKey(systemConfigContract.publicByKey);

function invalidateDerivedViews(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: PASSWORD_POLICY_KEY });
  void qc.invalidateQueries({ queryKey: PUBLIC_PREFIX });
}

const resource = createResourceQueries(systemConfigContract, {
  onSaved: (qc) => invalidateDerivedViews(qc),
  onDeleted: (qc) => invalidateDerivedViews(qc),
});

export const systemConfigKeys = {
  ...resource.keys,
  passwordPolicy: PASSWORD_POLICY_KEY,
  publicPrefix: PUBLIC_PREFIX,
  publicConfig: (key: string) => contractKey(systemConfigContract.publicByKey, { params: { key } }),
};

export const useSystemConfigList = resource.useList;
export const useSystemConfigDetail = resource.useDetail;
export const useSaveSystemConfig = resource.useSave;
/** 服务端未提供 DELETE /batch，多条时逐条删除 */
export const useDeleteSystemConfigs = resource.useDelete;

export function useSystemPasswordPolicy() {
  return useApiQuery(systemConfigContract.passwordPolicy, { staleTime: LOOKUP_STALE_TIME });
}

/** 公开读取单项系统配置（无需权限，用于全局开关类配置） */
export function usePublicConfig(key: string) {
  return useApiQuery(systemConfigContract.publicByKey, { params: { key } }, { staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } });
}
