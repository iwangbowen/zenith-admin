import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, Tag } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface TagListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  groupName?: string;
}

export const tagKeys = {
  all: ['tags'] as const,
  lists: ['tags', 'list'] as const,
  list: (params: TagListParams) => ['tags', 'list', params] as const,
  detail: (id: number | undefined) => ['tags', 'detail', id] as const,
  groups: ['tags', 'groups'] as const,
};

export function useTagList(params: TagListParams) {
  return useQuery({
    queryKey: tagKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<Tag>>(`/api/tags${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useTagGroups() {
  return useQuery({
    queryKey: tagKeys.groups,
    queryFn: () => request.get<string[]>('/api/tags/groups').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useTagDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: tagKeys.detail(id),
    queryFn: () => request.get<Tag>(`/api/tags/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Tag> }) =>
      (id === undefined ? request.post<Tag>('/api/tags', values) : request.put<Tag>(`/api/tags/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/tags/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useBatchDeleteTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.delete<null>('/api/tags/batch', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export function useUpdateTagStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'enabled' | 'disabled' }) =>
      request.put<Tag>(`/api/tags/${id}`, { status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all }),
  });
}
