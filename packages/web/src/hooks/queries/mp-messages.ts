import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { mpDraftContract, mpMaterialContract, mpMessageContract, type MpDraft, type MpMaterial } from '@zenith/shared/mp';
import { apiQueryOptions, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

/** 会话线程固定拉最近 50 条，最新在后 */
const THREAD_PAGE = { page: 1, pageSize: 50 } as const;

/** 发消息可选的素材 / 图文：一次取足 200 条 */
const MEDIA_PAGE = { page: 1, pageSize: 200 } as const;

const threadInput = (accountId: number | null | undefined, openid: string | null | undefined) =>
  ({ query: { accountId: accountId ?? 0, openid: openid ?? undefined, ...THREAD_PAGE } }) as const;

export const mpMessageKeys = {
  /** 全部会话列表查询的公共前缀 */
  conversations: contractKey(mpMessageContract.conversations),
  /** 全部消息列表（会话线程）查询的公共前缀 */
  threads: contractKey(mpMessageContract.list),
  thread: (accountId: number | null | undefined, openid: string | null | undefined) =>
    contractKey(mpMessageContract.list, threadInput(accountId, openid)),
};

export interface MpMessageMediaOptions {
  materials: MpMaterial[];
  drafts: MpDraft[];
}

export function useMpConversations(accountId: number | null | undefined) {
  return useApiQuery(mpMessageContract.conversations, { query: { accountId: accountId ?? 0 } }, {
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

/** 会话线程：缓存里是分页载荷，select 派生「最新在后」的消息数组 */
export function useMpMessageThread(accountId: number | null | undefined, openid: string | null | undefined) {
  return useQuery({
    ...apiQueryOptions(mpMessageContract.list, threadInput(accountId, openid), { placeholderData: keepPreviousData }),
    select: (data) => [...data.list].reverse(),
    enabled: !!accountId && !!openid,
  });
}

/**
 * 发消息可选的素材 / 图文。数据归 mp-materials / mp-drafts 域所有，故分别走各自契约的列表查询
 * （素材同步 / 图文推送后随所有者域的 `lists` 前缀一起失效），这里只做 useMemo 派生，不另起聚合请求。
 */
export function useMpMessageMediaOptions(accountId: number | null | undefined) {
  const query = { accountId: accountId ?? 0, ...MEDIA_PAGE };
  const enabled = !!accountId;
  const materialsQuery = useApiQuery(mpMaterialContract.list, { query }, { enabled });
  const draftsQuery = useApiQuery(mpDraftContract.list, { query }, { enabled });

  const data = useMemo<MpMessageMediaOptions | undefined>(() => {
    if (!materialsQuery.data || !draftsQuery.data) return undefined;
    return {
      materials: materialsQuery.data.list.filter((x) => x.wechatMediaId),
      drafts: draftsQuery.data.list.filter((x) => x.wechatMediaId),
    };
  }, [materialsQuery.data, draftsQuery.data]);

  return {
    data,
    isFetching: materialsQuery.isFetching || draftsQuery.isFetching,
    isSuccess: materialsQuery.isSuccess && draftsQuery.isSuccess,
  };
}

/** 发送只新增一条出站消息：会话摘要与该粉丝的线程都会变化，素材 / 图文不受影响 */
export function useSendMpMessage() {
  return useApiMutation(mpMessageContract.send, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: mpMessageKeys.conversations });
      void qc.invalidateQueries({ queryKey: mpMessageKeys.threads });
    },
  });
}
