import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, Position } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface PositionListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
}

export const positionKeys = {
  all: ['positions'] as const,
  allPositions: ['positions', 'all'] as const,
  lists: ['positions', 'list'] as const,
  list: (params: PositionListParams) => ['positions', 'list', params] as const,
  detail: (id: number | undefined) => ['positions', 'detail', id] as const,
  members: (id: number | undefined) => ['positions', 'members', id] as const,
};

export function usePositionList(params: PositionListParams) {
  return useQuery({
    queryKey: positionKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<Position>>(`/api/positions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAllPositions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: positionKeys.allPositions,
    queryFn: () => request.get<Position[]>('/api/positions/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function usePositionDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: positionKeys.detail(id),
    queryFn: () => request.get<Position>(`/api/positions/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function usePositionMembers(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: positionKeys.members(id),
    queryFn: () => request.get<Array<{ id: number }>>(`/api/positions/${id}/members`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSavePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Position> }) =>
      (id === undefined ? request.post<Position>('/api/positions', values) : request.put<Position>(`/api/positions/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: positionKeys.all }),
  });
}

export function useDeletePositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      (ids.length === 1 ? request.delete<null>(`/api/positions/${ids[0]}`) : request.delete<null>('/api/positions/batch', { ids })).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: positionKeys.all }),
  });
}

export function useAssignPositionMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) =>
      request.put<null>(`/api/positions/${id}/members`, { userIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: positionKeys.all }),
  });
}
