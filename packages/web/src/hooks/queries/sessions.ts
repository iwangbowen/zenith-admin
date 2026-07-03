import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OnlineUser, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface SessionListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const sessionKeys = {
  all: ['sessions'] as const,
  lists: ['sessions', 'list'] as const,
  list: (params: SessionListParams) => ['sessions', 'list', params] as const,
};

export function useSessionList(params: SessionListParams) {
  return useQuery({
    queryKey: sessionKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<OnlineUser>>(`/api/sessions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useForceLogoutSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { mode: 'single' | 'all'; tokenId: string; userId: number }) =>
      (input.mode === 'all'
        ? request.delete<null>(`/api/sessions/user/${input.userId}`)
        : request.delete<null>(`/api/sessions/${input.tokenId}`)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}
