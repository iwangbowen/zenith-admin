import { keepPreviousData } from '@tanstack/react-query';
import { aiConversationContract } from '@zenith/shared/ai';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { request } from '@/utils/request';

export type AiFeedbackListParams = NonNullable<QueryOf<typeof aiConversationContract.feedbackList>>;

export type AiFeedbackFilterParams = NonNullable<QueryOf<typeof aiConversationContract.feedbackExport>>;

export type AiFeedbackHandleValues = BodyOf<typeof aiConversationContract.handleFeedback>;

export const aiFeedbackKeys = {
  lists: contractKey(aiConversationContract.feedbackList),
  list: (params: AiFeedbackListParams) => contractKey(aiConversationContract.feedbackList, { query: params }),
  contexts: contractKey(aiConversationContract.feedbackContext),
  context: (msgId: number | null) => contractKey(aiConversationContract.feedbackContext, { params: { msgId: msgId ?? 0 } }),
};

export function useAiFeedbackList(params: AiFeedbackListParams) {
  return useApiQuery(aiConversationContract.feedbackList, { query: params }, { placeholderData: keepPreviousData });
}

/** 反馈消息的会话上下文（回放弹窗） */
export function useAiFeedbackContext(msgId: number | null) {
  return useApiQuery(aiConversationContract.feedbackContext, { params: { msgId: msgId ?? 0 } }, { enabled: msgId !== null });
}

/** 处理状态与备注同时出现在列表行与上下文回放里，两者一并失效 */
export function useHandleAiFeedback() {
  return useApiMutation(aiConversationContract.handleFeedback, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: aiFeedbackKeys.lists });
      void qc.invalidateQueries({ queryKey: aiFeedbackKeys.contexts });
    },
  });
}

/** 导出反馈列表 CSV（携带当前筛选） */
export function downloadAiFeedbackCsv(params: AiFeedbackFilterParams) {
  return request.download(urlOf(aiConversationContract.feedbackExport, { query: params }), 'ai-feedback.csv');
}
