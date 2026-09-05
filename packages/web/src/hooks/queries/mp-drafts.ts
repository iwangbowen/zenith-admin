import type { QueryOf } from '@zenith/shared/core';
import { mpDraftContract } from '@zenith/shared/mp';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type MpDraftListParams = QueryOf<typeof mpDraftContract.list>;

export const {
  keys: mpDraftKeys,
  useList: useMpDraftList,
  useDetail: useMpDraftDetail,
  useSave: useSaveMpDraft,
  useDelete: useDeleteMpDrafts,
} = createResourceQueries(mpDraftContract);

/** 推送会回填 wechatMediaId 并改状态：该草稿详情与列表都需刷新 */
export function usePushMpDraft() {
  return useApiMutation(mpDraftContract.push, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: mpDraftKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: mpDraftKeys.lists });
    },
  });
}
