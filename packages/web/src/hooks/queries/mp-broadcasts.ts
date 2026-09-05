import { useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { mpBroadcastContract, mpDraftContract, mpMaterialContract, mpTagContract, type MpDraft, type MpMaterial, type MpTag } from '@zenith/shared/mp';
import { api, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MpBroadcastListParams = QueryOf<typeof mpBroadcastContract.list>;

export const {
  keys: mpBroadcastKeys,
  useList: useMpBroadcastList,
  useSave: useSaveMpBroadcast,
  useDelete: useDeleteMpBroadcasts,
} = createResourceQueries(mpBroadcastContract);

export interface MpBroadcastAuxData {
  tags: MpTag[];
  materials: MpMaterial[];
  drafts: MpDraft[];
}

/** 群发表单的候选标签 / 图片素材 / 图文草稿（跨资源聚合，只在打开表单时拉取） */
export function useMpBroadcastAux(accountId: number | null | undefined) {
  return useQuery({
    queryKey: [...mpBroadcastKeys.all, 'aux', accountId] as const,
    queryFn: async (): Promise<MpBroadcastAuxData> => {
      const query = { accountId: accountId ?? 0, page: 1, pageSize: 200 };
      const [tags, materials, drafts] = await Promise.all([
        api(mpTagContract.list, { query }),
        api(mpMaterialContract.list, { query }),
        api(mpDraftContract.list, { query }),
      ]);
      return {
        tags: tags.list,
        materials: materials.list.filter((x) => x.type === 'image' && x.wechatMediaId),
        drafts: drafts.list.filter((x) => x.wechatMediaId),
      };
    },
    enabled: !!accountId,
  });
}

export function useMpBroadcastResult(id: number | null | undefined, enabled = true) {
  return useApiQuery(mpBroadcastContract.result, { params: { id: id ?? 0 } }, { enabled: enabled && id != null });
}

/** 发送改变该条记录的状态 / msgId：列表与发送结果都需刷新 */
export function useSendMpBroadcast() {
  return useApiMutation(mpBroadcastContract.send, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: mpBroadcastKeys.lists });
      void qc.invalidateQueries({ queryKey: contractKey(mpBroadcastContract.result, { params }) });
    },
  });
}

/** 预览只向指定 openid 试发，不改变群发状态 */
export function usePreviewMpBroadcast() {
  return useApiMutation(mpBroadcastContract.preview);
}
