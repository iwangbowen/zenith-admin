import { useMutation } from '@tanstack/react-query';
import { retentionPolicyContract } from '@zenith/shared/ops';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const retentionKeys = {
  all: ['retention-policies'] as const,
  list: contractKey(retentionPolicyContract.list),
  preview: (key: string) => contractKey(retentionPolicyContract.preview, { params: { key } }),
};

export function useRetentionPolicies() {
  return useApiQuery(retentionPolicyContract.list);
}

export function useUpdateRetentionPolicy() {
  return useApiMutation(retentionPolicyContract.update, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: retentionKeys.all });
    },
  });
}

/** 预览按需触发（执行前确认弹窗），结果不进缓存 */
export function useRetentionPreview() {
  return useMutation({
    mutationFn: (key: string) => api(retentionPolicyContract.preview, { params: { key } }),
  });
}

/** 立即执行：策略行的 lastRunAt / lastDeleted 随之变化 */
export function useRunRetentionPolicy() {
  return useApiMutation(retentionPolicyContract.run, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: retentionKeys.all });
    },
  });
}
