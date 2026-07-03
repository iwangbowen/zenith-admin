import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiFeedbackStatus, AiMessage, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface AiFeedbackListParams {
  page: number;
  pageSize: number;
  feedback?: string;
  status?: string;
}

export interface AiFeedbackHandleValues {
  status: AiFeedbackStatus;
  remark: string | null;
}

export const aiFeedbackKeys = {
  all: ['ai-feedback'] as const,
  lists: ['ai-feedback', 'list'] as const,
  list: (params: AiFeedbackListParams) => ['ai-feedback', 'list', params] as const,
};

export function useAiFeedbackList(params: AiFeedbackListParams) {
  return useQuery({
    queryKey: aiFeedbackKeys.list(params),
    queryFn: () =>
      request
        .get<PaginatedResponse<AiMessage>>(`/api/ai/conversations/admin/feedback${toQueryString(params)}`)
        .then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useHandleAiFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: AiFeedbackHandleValues }) =>
      request.put<null>(`/api/ai/conversations/admin/feedback/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiFeedbackKeys.all }),
  });
}
