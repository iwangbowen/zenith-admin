import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { resourceKeyOf } from '@zenith/shared/core';
import { mpDraftContract, mpMaterialContract, mpMessageContract, type MpDraft, type MpMaterial } from '@zenith/shared/mp';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

const MP_MESSAGE_KEY = resourceKeyOf(mpMessageContract.basePath);

/** 会话线程固定拉最近 50 条，最新在后 */
const THREAD_PAGE = { page: 1, pageSize: 50 } as const;

export const mpMessageKeys = {
  all: [MP_MESSAGE_KEY] as const,
  /** 全部会话列表查询的公共前缀 */
  conversations: contractKey(mpMessageContract.conversations),
  /** 全部消息列表（会话线程）查询的公共前缀 */
  threads: contractKey(mpMessageContract.list),
  thread: (accountId: number | null | undefined, openid: string | null | undefined) =>
    contractKey(mpMessageContract.list, { query: { accountId: accountId ?? 0, openid: openid ?? undefined, ...THREAD_PAGE } }),
  /** 发消息可选的素材 / 图文（跨资源聚合，不随消息变化） */
  media: (accountId: number | null | undefined) => [MP_MESSAGE_KEY, 'media', accountId] as const,
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

export function useMpMessageThread(accountId: number | null | undefined, openid: string | null | undefined) {
  return useQuery({
    queryKey: mpMessageKeys.thread(accountId, openid),
    queryFn: async () => {
      const data = await api(mpMessageContract.list, { query: { accountId: accountId ?? 0, openid: openid ?? undefined, ...THREAD_PAGE } });
      return [...data.list].reverse();
    },
    enabled: !!accountId && !!openid,
    placeholderData: keepPreviousData,
  });
}

export function useMpMessageMediaOptions(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpMessageKeys.media(accountId),
    queryFn: async (): Promise<MpMessageMediaOptions> => {
      const query = { accountId: accountId ?? 0, page: 1, pageSize: 200 };
      const [materials, drafts] = await Promise.all([
        api(mpMaterialContract.list, { query }),
        api(mpDraftContract.list, { query }),
      ]);
      return {
        materials: materials.list.filter((x) => x.wechatMediaId),
        drafts: drafts.list.filter((x) => x.wechatMediaId),
      };
    },
    enabled: !!accountId,
  });
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
