import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowInstanceContract } from '@zenith/shared/workflow';
import { api } from '@/lib/contract-query';
import type { CreateWorkflowInstanceVariables } from './workflow-instances';

export const workflowLaunchKeys = {
  all: ['workflow', 'launch'] as const,
};

/** 发起工作台提交：与「我的申请」发起共用契约操作，幂等键由调用方按表单指纹传入 */
export function useLaunchWorkflowInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: CreateWorkflowInstanceVariables) =>
      api(workflowInstanceContract.create, { body }, idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}