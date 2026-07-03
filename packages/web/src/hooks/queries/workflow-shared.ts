import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  WorkflowApproverPreviewNode,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowSelectableNextApproverGroup,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const workflowSharedKeys = {
  all: ['workflow'] as const,
  approvalPreviews: ['workflow', 'approval-preview'] as const,
  approvalPreview: (definitionId: number | null | undefined, reloadKey: number | undefined) =>
    ['workflow', 'approval-preview', definitionId ?? null, reloadKey ?? 0] as const,
  instanceDetails: ['workflow', 'instance-detail'] as const,
  instanceDetail: (instanceId: number | null | undefined) => ['workflow', 'instance-detail', instanceId ?? null] as const,
  selectableNextApprovers: (taskId: number | null | undefined) =>
    ['workflow', 'selectable-next-approvers', taskId ?? null] as const,
};

export async function fetchWorkflowInstanceWithDefinition(instanceId: number): Promise<{
  instance: WorkflowInstance;
  definition: WorkflowDefinition | null;
}> {
  const instance = await request.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`, { silent: true }).then(unwrap);
  if (instance.definitionSnapshot) return { instance, definition: null };
  const definition = await request
    .get<WorkflowDefinition>(`/api/workflows/definitions/${instance.definitionId}`, { silent: true })
    .then(unwrap);
  return { instance, definition };
}

export function useWorkflowApprovalPreview(
  definitionId: number | null | undefined,
  reloadKey: number | undefined,
  getFormData?: () => Record<string, unknown>,
) {
  return useQuery({
    queryKey: workflowSharedKeys.approvalPreview(definitionId, reloadKey),
    queryFn: () =>
      request
        .post<WorkflowApproverPreviewNode[]>(
          `/api/workflows/definitions/${definitionId}/preview`,
          { formData: getFormData ? getFormData() : null },
          { silent: true },
        )
        .then(unwrap),
    enabled: !!definitionId,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === definitionId ? previousData : undefined,
  });
}

export function useWorkflowInstanceWithDefinition(instanceId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowSharedKeys.instanceDetail(instanceId),
    queryFn: () => fetchWorkflowInstanceWithDefinition(instanceId as number),
    enabled: enabled && !!instanceId,
    staleTime: 0,
  });
}

export function useWorkflowSelectableNextApprovers(taskId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowSharedKeys.selectableNextApprovers(taskId),
    queryFn: () =>
      request
        .get<WorkflowSelectableNextApproverGroup[]>(`/api/workflows/tasks/${taskId}/selectable-next-approvers`)
        .then(unwrap),
    enabled: enabled && taskId != null,
    placeholderData: keepPreviousData,
  });
}
