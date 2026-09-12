import { retentionPolicyContract } from '@zenith/shared/ops';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const retentionKeys = {
  list: contractKey(retentionPolicyContract.list),
  preview: (key: string) => contractKey(retentionPolicyContract.preview, { params: { key } }),
};

export function useRetentionPolicies() {
  return useApiQuery(retentionPolicyContract.list);
}

/** 策略列表是本域唯一缓存查询（预览按需拉取不进缓存），更新 / 执行都只需回源列表 */
export function useUpdateRetentionPolicy() {
  return useApiMutation(retentionPolicyContract.update, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: retentionKeys.list }),
  });
}

/** 预览按需触发（执行前确认弹窗），结果不进缓存 */
export function useRetentionPreview() {
  return useApiMutation(retentionPolicyContract.preview);
}

/** 立即执行：策略行的 lastRunAt / lastDeleted 随之变化 */
export function useRunRetentionPolicy() {
  return useApiMutation(retentionPolicyContract.run, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: retentionKeys.list }),
  });
}
