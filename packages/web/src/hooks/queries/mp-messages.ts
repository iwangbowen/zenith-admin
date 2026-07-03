import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpConversation, MpDraft, MpMaterial, MpMessage, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export const mpMessageKeys = {
  all: ['mp', 'messages'] as const,
  conversations: (accountId: number | null | undefined) => ['mp', 'messages', accountId, 'conversations'] as const,
  thread: (accountId: number | null | undefined, openid: string | null | undefined) => ['mp', 'messages', accountId, 'thread', openid] as const,
  media: (accountId: number | null | undefined) => ['mp', 'messages', accountId, 'media'] as const,
};

export interface MpMessageMediaOptions {
  materials: MpMaterial[];
  drafts: MpDraft[];
}

export function useMpConversations(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpMessageKeys.conversations(accountId),
    queryFn: () => request.get<MpConversation[]>(`/api/mp/messages/conversations${toQueryString({ accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useMpMessageThread(accountId: number | null | undefined, openid: string | null | undefined) {
  return useQuery({
    queryKey: mpMessageKeys.thread(accountId, openid),
    queryFn: async () => {
      const data = await request
        .get<PaginatedResponse<MpMessage>>(`/api/mp/messages${toQueryString({ accountId, openid, page: 1, pageSize: 50 })}`)
        .then(unwrap);
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
      const [materials, drafts] = await Promise.all([
        request.get<PaginatedResponse<MpMaterial>>(`/api/mp/materials${toQueryString({ accountId, page: 1, pageSize: 200 })}`).then(unwrap),
        request.get<PaginatedResponse<MpDraft>>(`/api/mp/drafts${toQueryString({ accountId, page: 1, pageSize: 200 })}`).then(unwrap),
      ]);
      return {
        materials: materials.list.filter((x) => x.wechatMediaId),
        drafts: drafts.list.filter((x) => x.wechatMediaId),
      };
    },
    enabled: !!accountId,
  });
}

export function useSendMpMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<MpMessage>('/api/mp/messages/send', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMessageKeys.all }),
  });
}
