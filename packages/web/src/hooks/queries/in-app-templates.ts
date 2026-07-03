import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InAppMessageType, InAppTemplate, PaginatedResponse } from '@zenith/shared';
import { toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface InAppTemplateListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: InAppMessageType;
  status?: string;
}

export const inAppTemplateKeys = {
  all: ['in-app-templates'] as const,
  lists: ['in-app-templates', 'list'] as const,
  list: (params: InAppTemplateListParams) => ['in-app-templates', 'list', params] as const,
  detail: (id: number | undefined) => ['in-app-templates', 'detail', id] as const,
};

export function useInAppTemplateList(params: InAppTemplateListParams) {
  return useQuery({
    queryKey: inAppTemplateKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<InAppTemplate>>(`/api/in-app-templates${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useInAppTemplateDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: inAppTemplateKeys.detail(id),
    queryFn: () => request.get<InAppTemplate>(`/api/in-app-templates/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveInAppTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<InAppTemplate>('/api/in-app-templates', values)
        : request.put<InAppTemplate>(`/api/in-app-templates/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inAppTemplateKeys.all }),
  });
}

export function useDeleteInAppTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/in-app-templates/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inAppTemplateKeys.all }),
  });
}
