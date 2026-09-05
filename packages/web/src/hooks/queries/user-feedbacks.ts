import type { QueryClient } from '@tanstack/react-query';
import { userFeedbackContract } from '@zenith/shared/platform';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

const resource = createResourceQueries(userFeedbackContract);

export const userFeedbackKeys = resource.keys;

export const useUserFeedbackList = resource.useList;
/** 删除：单条走 DELETE /{id}，多条走 DELETE /batch */
export const useDeleteFeedbacks = resource.useDelete;

/** 反馈没有详情接口，写操作后只需回源列表 */
const invalidateLists = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: userFeedbackKeys.lists });

/** 提交意见反馈（所有登录用户可用） */
export function useSubmitFeedback() {
  return useApiMutation(userFeedbackContract.submit, { invalidate: invalidateLists });
}

/** 处理反馈（更新状态与备注） */
export function useHandleFeedback() {
  return useApiMutation(userFeedbackContract.handle, { invalidate: invalidateLists });
}
