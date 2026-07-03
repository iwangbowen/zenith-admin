import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowEventDelivery, WorkflowEventSubscription, WorkflowEventType } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowEventSubscriptionListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  definitionId?: number;
  enabled?: 'true' | 'false';
}

export interface WorkflowEventDeliveryListParams {
  page: number;
  pageSize: number;
  subscriptionId: number | null;
}

export interface WorkflowEventDeliveryReplayPayload {
  subscriptionId: number;
  eventType?: WorkflowEventType;
  status?: 'success' | 'failed' | 'pending';
  startAt?: string;
  endAt?: string;
}

export const workflowEventSubscriptionKeys = {
  all: ['workflow', 'event-subscriptions'] as const,
  lists: ['workflow', 'event-subscriptions', 'list'] as const,
  list: (params: WorkflowEventSubscriptionListParams) => ['workflow', 'event-subscriptions', 'list', params] as const,
  detail: (id: number | null | undefined) => ['workflow', 'event-subscriptions', 'detail', id ?? null] as const,
  deliveries: ['workflow', 'event-subscriptions', 'deliveries'] as const,
  deliveryList: (params: WorkflowEventDeliveryListParams) => ['workflow', 'event-subscriptions', 'deliveries', params] as const,
};

export function useWorkflowEventSubscriptionList(params: WorkflowEventSubscriptionListParams) {
  return useQuery({
    queryKey: workflowEventSubscriptionKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowEventSubscription>>(`/api/workflows/event-subscriptions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowEventSubscriptionDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowEventSubscriptionKeys.detail(id),
    queryFn: () => request.get<WorkflowEventSubscription>(`/api/workflows/event-subscriptions/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useWorkflowEventDeliveries(params: WorkflowEventDeliveryListParams, enabled = true) {
  return useQuery({
    queryKey: workflowEventSubscriptionKeys.deliveryList(params),
    queryFn: () =>
      request
        .get<PaginatedResponse<WorkflowEventDelivery>>(`/api/workflows/event-subscriptions/deliveries/list${toQueryString(params)}`)
        .then(unwrap),
    enabled: enabled && params.subscriptionId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useSaveWorkflowEventSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<WorkflowEventSubscription>(`/api/workflows/event-subscriptions/${id}`, values) : request.post<WorkflowEventSubscription>('/api/workflows/event-subscriptions', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.all }),
  });
}

export function useToggleWorkflowEventSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request.patch<WorkflowEventSubscription>(`/api/workflows/event-subscriptions/${id}/toggle`, { enabled }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.all }),
  });
}

export function useDeleteWorkflowEventSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/event-subscriptions/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.all }),
  });
}

export function useWorkflowEventSubscriptionSecret() {
  return useMutation({
    mutationFn: (id: number) => request.get<{ secret: string }>(`/api/workflows/event-subscriptions/${id}/secret`).then(unwrap),
  });
}

export function useRetryWorkflowEventDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/workflows/event-subscriptions/deliveries/${id}/retry`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.deliveries }),
  });
}

export function useReplayWorkflowEventDeliveries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: WorkflowEventDeliveryReplayPayload) =>
      request.post<{ count: number }>('/api/workflows/event-subscriptions/deliveries/replay', payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.deliveries }),
  });
}
