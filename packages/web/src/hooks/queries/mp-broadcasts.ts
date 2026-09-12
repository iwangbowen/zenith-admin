import { useMemo } from 'react';
import type { QueryOf } from '@zenith/shared/core';
import { mpBroadcastContract, mpDraftContract, mpMaterialContract, mpTagContract, type MpDraft, type MpMaterial, type MpTag } from '@zenith/shared/mp';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

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

/** 群发表单的候选项一次取足 200 条 */
const AUX_PAGE = { page: 1, pageSize: 200 } as const;

/**
 * 群发表单的候选标签 / 图片素材 / 图文草稿。数据归 mp-tags / mp-materials / mp-drafts 域所有，
 * 分别走各自契约的列表查询（同步 / 上传 / 推送后随所有者域的 `lists` 前缀一起失效），这里只做 useMemo 派生。
 */
export function useMpBroadcastAux(accountId: number | null | undefined) {
  const query = { accountId: accountId ?? 0, ...AUX_PAGE };
  const enabled = !!accountId;
  const tagsQuery = useApiQuery(mpTagContract.list, { query }, { enabled });
  const materialsQuery = useApiQuery(mpMaterialContract.list, { query }, { enabled });
  const draftsQuery = useApiQuery(mpDraftContract.list, { query }, { enabled });

  const data = useMemo<MpBroadcastAuxData | undefined>(() => {
    if (!tagsQuery.data || !materialsQuery.data || !draftsQuery.data) return undefined;
    return {
      tags: tagsQuery.data.list,
      materials: materialsQuery.data.list.filter((x) => x.type === 'image' && x.wechatMediaId),
      drafts: draftsQuery.data.list.filter((x) => x.wechatMediaId),
    };
  }, [tagsQuery.data, materialsQuery.data, draftsQuery.data]);

  return {
    data,
    isFetching: tagsQuery.isFetching || materialsQuery.isFetching || draftsQuery.isFetching,
    isSuccess: tagsQuery.isSuccess && materialsQuery.isSuccess && draftsQuery.isSuccess,
  };
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
