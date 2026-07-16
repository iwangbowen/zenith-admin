import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BizLeave, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface BizLeaveListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: BizLeave['status'];
}

export interface SaveBizLeavePayload {
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
}

export const bizLeaveKeys = {
  all: ['biz-leave'] as const,
  lists: ['biz-leave', 'list'] as const,
  list: (params: BizLeaveListParams) => ['biz-leave', 'list', params] as const,
  detail: (id: string | null | undefined) => ['biz-leave', 'detail', id] as const,
};

export function useBizLeaveList(params: BizLeaveListParams) {
  return useQuery({
    queryKey: bizLeaveKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<BizLeave>>(`/api/biz/leaves${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useBizLeaveDetail(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: bizLeaveKeys.detail(id),
    queryFn: () => request.get<BizLeave>(`/api/biz/leaves/${id}/detail`, { silent: true }).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useSaveBizLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: SaveBizLeavePayload }) =>
      (id === undefined
        ? request.post<BizLeave>('/api/biz/leaves', values)
        : request.put<BizLeave>(`/api/biz/leaves/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizLeaveKeys.all }),
  });
}

export function useSubmitBizLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<BizLeave>(`/api/biz/leaves/${id}/submit`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizLeaveKeys.all }),
  });
}

export function useReopenBizLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<BizLeave>(`/api/biz/leaves/${id}/reopen`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizLeaveKeys.all }),
  });
}

export function useDeleteBizLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/biz/leaves/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizLeaveKeys.all }),
  });
}
