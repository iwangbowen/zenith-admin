import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AsyncTask, AsyncTaskItem, AsyncTaskItemStatus, AsyncTaskStats, AsyncTaskTypeMeta, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface AsyncTaskListParams {
  page: number;
  pageSize: number;
  taskType?: string;
  status?: string;
  keyword?: string;
  createdBy?: string;
}

export interface AsyncTaskItemsParams {
  taskId: number;
  page: number;
  pageSize: number;
  status?: string;
}

export const asyncTaskKeys = {
  all: ['async-tasks'] as const,
  lists: ['async-tasks', 'list'] as const,
  list: (params: AsyncTaskListParams) => ['async-tasks', 'list', params] as const,
  stats: ['async-tasks', 'stats'] as const,
  types: ['async-tasks', 'types'] as const,
  items: ['async-tasks', 'items'] as const,
  itemList: (params: AsyncTaskItemsParams) => ['async-tasks', 'items', params] as const,
};

export function useAsyncTaskList(params: AsyncTaskListParams, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: asyncTaskKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<AsyncTask>>(`/api/async-tasks${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
  });
}

export function useAsyncTaskStats(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: asyncTaskKeys.stats,
    queryFn: () => request.get<AsyncTaskStats>('/api/async-tasks/stats', { silent: true }).then(unwrap),
    refetchInterval: options?.refetchInterval,
  });
}

export function useAsyncTaskTypes() {
  return useQuery({
    queryKey: asyncTaskKeys.types,
    queryFn: () => request.get<AsyncTaskTypeMeta[]>('/api/async-tasks/types', { silent: true }).then(unwrap),
  });
}

export function useAsyncTaskItems(params: AsyncTaskItemsParams, enabled = true) {
  return useQuery({
    queryKey: asyncTaskKeys.itemList(params),
    queryFn: () => request.get<PaginatedResponse<AsyncTaskItem>>(`/api/async-tasks/${params.taskId}/items${toQueryString({ page: params.page, pageSize: params.pageSize, status: params.status })}`, { silent: true }).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useAsyncTaskAction(action: 'cancel' | 'resume' | 'restart') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<AsyncTask>(`/api/async-tasks/${id}/${action}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: asyncTaskKeys.all }),
  });
}

export function useDeleteAsyncTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/async-tasks/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: asyncTaskKeys.all }),
  });
}

export function useBatchCancelAsyncTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.post<{ affected: number }>('/api/async-tasks/batch-cancel', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: asyncTaskKeys.all }),
  });
}

export function useBatchDeleteAsyncTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.post<{ affected: number }>('/api/async-tasks/batch-delete', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: asyncTaskKeys.all }),
  });
}

export function useCleanupAsyncTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.post<{ cleaned: number }>('/api/async-tasks/cleanup').then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: asyncTaskKeys.all }),
  });
}

export function useUpdateAsyncTaskTypeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskType, values }: { taskType: string; values: Partial<AsyncTaskTypeMeta> }) =>
      request.put<AsyncTaskTypeMeta>(`/api/async-tasks/types/${taskType}/config`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: asyncTaskKeys.all }),
  });
}

export type { AsyncTaskItemStatus };
