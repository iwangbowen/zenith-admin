import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, SystemSchedulerNode, SystemSchedulerRun, SystemSchedulerTask } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface SystemSchedulerRunListParams {
  page: number;
  pageSize: number;
  taskName?: string;
  taskType?: string;
  triggerType?: string;
  status?: string;
  alertStatus?: string;
  startTime?: string;
  endTime?: string;
}

export interface SystemSchedulerNodeListParams {
  page: number;
  pageSize: number;
}

export interface SystemSchedulerCleanupResult {
  message: string;
  deletedByAge: number;
  deletedByCount: number;
  totalBefore: number;
  totalAfter: number;
}

export const systemSchedulerKeys = {
  all: ['system-scheduler'] as const,
  tasks: ['system-scheduler', 'tasks'] as const,
  runs: ['system-scheduler', 'runs'] as const,
  runList: (params: SystemSchedulerRunListParams) => ['system-scheduler', 'runs', params] as const,
  runDetail: (id: number | undefined) => ['system-scheduler', 'run-detail', id] as const,
  nodes: ['system-scheduler', 'nodes'] as const,
  nodeList: (params: SystemSchedulerNodeListParams) => ['system-scheduler', 'nodes', params] as const,
};

export function useSystemSchedulerTasks() {
  return useQuery({
    queryKey: systemSchedulerKeys.tasks,
    queryFn: () => request.get<SystemSchedulerTask[]>('/api/system-scheduler/tasks').then(unwrap),
  });
}

export function useSystemSchedulerRuns(params: SystemSchedulerRunListParams, enabled = true) {
  return useQuery({
    queryKey: systemSchedulerKeys.runList(params),
    queryFn: () => request.get<PaginatedResponse<SystemSchedulerRun>>(`/api/system-scheduler/runs${toQueryString(params)}`).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSystemSchedulerRunDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: systemSchedulerKeys.runDetail(id),
    queryFn: () => request.get<SystemSchedulerRun>(`/api/system-scheduler/runs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSystemSchedulerNodes(params: SystemSchedulerNodeListParams, enabled = true) {
  return useQuery({
    queryKey: systemSchedulerKeys.nodeList(params),
    queryFn: () => request.get<PaginatedResponse<SystemSchedulerNode>>(`/api/system-scheduler/nodes${toQueryString(params)}`).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useRunSystemSchedulerTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => request.post<{ message: string; runId?: number; jobId?: string | null }>(`/api/system-scheduler/tasks/${encodeURIComponent(name)}/run`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemSchedulerKeys.all }),
  });
}

export function useSaveSystemSchedulerTaskConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, values }: { name: string; values: Record<string, unknown> }) =>
      request.put(`/api/system-scheduler/tasks/${encodeURIComponent(name)}/config`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemSchedulerKeys.all }),
  });
}

export function useAcknowledgeSystemSchedulerAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string | null }) =>
      request.post<SystemSchedulerRun>(`/api/system-scheduler/runs/${id}/ack-alert`, { note }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemSchedulerKeys.all }),
  });
}

export function useCleanupSystemSchedulerRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskName?: string) => {
      const query = taskName ? `?taskName=${encodeURIComponent(taskName)}` : '';
      return request.post<SystemSchedulerCleanupResult>(`/api/system-scheduler/runs/cleanup${query}`).then(unwrap);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: systemSchedulerKeys.all }),
  });
}
