import { useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowHealthContract } from '@zenith/shared/workflow';
import { api } from '@/lib/contract-query';

export type WorkflowHealthParams = QueryOf<typeof workflowHealthContract.summary>;

export const workflowHealthKeys = {
  all: ['workflow', 'health'] as const,
  summary: (params: WorkflowHealthParams) => ['workflow', 'health', 'summary', params] as const,
};

export function useWorkflowHealthSummary(params: WorkflowHealthParams) {
  return useQuery({
    queryKey: workflowHealthKeys.summary(params),
    queryFn: () => api(workflowHealthContract.summary, { query: params }),
  });
}
