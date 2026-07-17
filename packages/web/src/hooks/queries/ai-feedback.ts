import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiFeedbackItem, AiFeedbackStatus, AiMessage, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface AiFeedbackListParams {
  page: number;
  pageSize: number;
  feedback?: string;
  status?: string;
  model?: string;
  startDate?: string;
  endDate?: string;
}

export interface AiFeedbackHandleValues {
  status: AiFeedbackStatus;
  remark: string | null;
}

export interface AiFeedbackContext {
  conversationId: number;
  conversationTitle: string | null;
  targetMsgId: number;
  messages: AiMessage[];
}

export const aiFeedbackKeys = {
  all: ['ai-feedback'] as const,
  lists: ['ai-feedback', 'list'] as const,
  list: (params: AiFeedbackListParams) => ['ai-feedback', 'list', params] as const,
  context: (msgId: number | null) => ['ai-feedback', 'context', msgId] as const,
};

export function useAiFeedbackList(params: AiFeedbackListParams) {
  return useQuery({
    queryKey: aiFeedbackKeys.list(params),
    queryFn: () =>
      request
        .get<PaginatedResponse<AiFeedbackItem>>(`/api/ai/conversations/admin/feedback${toQueryString(params)}`)
        .then(unwrap),
    placeholderData: keepPreviousData,
  });
}

/** 反馈消息的会话上下文（回放弹窗） */
export function useAiFeedbackContext(msgId: number | null) {
  return useQuery({
    queryKey: aiFeedbackKeys.context(msgId),
    queryFn: () =>
      request.get<AiFeedbackContext>(`/api/ai/conversations/admin/feedback/${msgId}/context`).then(unwrap),
    enabled: msgId !== null,
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

/** 导出反馈列表 CSV（携带当前筛选） */
export function downloadAiFeedbackCsv(params: Omit<AiFeedbackListParams, 'page' | 'pageSize'>) {
  return request.download(`/api/ai/conversations/admin/feedback/export${toQueryString(params)}`, 'ai-feedback.csv');
}
