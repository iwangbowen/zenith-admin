import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WorkflowInstance } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { usePublishedWorkflowDefinitions } from './workflow-definitions';

export const workflowLaunchKeys = {
  all: ['workflow', 'launch'] as const,
};

export const useLaunchableWorkflowDefinitions = usePublishedWorkflowDefinitions;

export function useLaunchWorkflowInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ values, idempotencyKey }: { values: Record<string, unknown>; idempotencyKey?: string }) =>
      request
        .post<WorkflowInstance>(
          '/api/workflows/instances',
          values,
          idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : undefined,
        )
        .then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}
