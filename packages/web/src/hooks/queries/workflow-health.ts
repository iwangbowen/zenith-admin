import { useQuery } from '@tanstack/react-query';
import type { WorkflowHealthSummary } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowHealthParams {
  thresholdMinutes: number;
}

export const workflowHealthKeys = {
  all: ['workflow', 'health'] as const,
  summary: (params: WorkflowHealthParams) => ['workflow', 'health', 'summary', params] as const,
};

export function useWorkflowHealthSummary(params: WorkflowHealthParams) {
  return useQuery({
    queryKey: workflowHealthKeys.summary(params),
    queryFn: () => request.get<WorkflowHealthSummary>(`/api/workflows/health${toQueryString(params)}`).then(unwrap),
  });
}
