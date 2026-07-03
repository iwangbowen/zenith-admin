import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowDefinition, WorkflowTemplate } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const workflowTemplateKeys = {
  all: ['workflow', 'templates'] as const,
  lists: ['workflow', 'templates', 'list'] as const,
  list: () => ['workflow', 'templates', 'list'] as const,
};

export function useWorkflowTemplates(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowTemplateKeys.list(),
    queryFn: () => request.get<WorkflowTemplate[]>('/api/workflows/templates').then(unwrap),
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) =>
      request.put<WorkflowTemplate>(`/api/workflows/templates/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowTemplateKeys.all }),
  });
}

export function useDeleteWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<unknown>(`/api/workflows/templates/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowTemplateKeys.all }),
  });
}

export function useCloneWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values?: Record<string, unknown> }) =>
      request.post<WorkflowDefinition>(`/api/workflows/templates/${id}/clone`, values ?? {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}
