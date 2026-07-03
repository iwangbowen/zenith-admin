import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpBroadcast, MpBroadcastResult, MpBroadcastStatus, MpDraft, MpMaterial, MpTag, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpBroadcastListParams {
  page: number;
  pageSize: number;
  status?: MpBroadcastStatus;
}

export interface MpBroadcastAuxData {
  tags: MpTag[];
  materials: MpMaterial[];
  drafts: MpDraft[];
}

export const mpBroadcastKeys = {
  all: ['mp', 'broadcasts'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'broadcasts', accountId] as const,
  list: (accountId: number | null | undefined, params: MpBroadcastListParams) => ['mp', 'broadcasts', accountId, params] as const,
  aux: (accountId: number | null | undefined) => ['mp', 'broadcasts', accountId, 'aux'] as const,
  result: (id: number | null | undefined) => ['mp', 'broadcasts', 'result', id] as const,
};

export function useMpBroadcastList(accountId: number | null | undefined, params: MpBroadcastListParams) {
  return useQuery({
    queryKey: mpBroadcastKeys.list(accountId, params),
    queryFn: () =>
      request.get<PaginatedResponse<MpBroadcast>>(`/api/mp/broadcasts${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useMpBroadcastAux(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpBroadcastKeys.aux(accountId),
    queryFn: async (): Promise<MpBroadcastAuxData> => {
      const [tags, materials, drafts] = await Promise.all([
        request.get<PaginatedResponse<MpTag>>(`/api/mp/tags${toQueryString({ accountId, page: 1, pageSize: 200 })}`).then(unwrap),
        request.get<PaginatedResponse<MpMaterial>>(`/api/mp/materials${toQueryString({ accountId, page: 1, pageSize: 200 })}`).then(unwrap),
        request.get<PaginatedResponse<MpDraft>>(`/api/mp/drafts${toQueryString({ accountId, page: 1, pageSize: 200 })}`).then(unwrap),
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
  return useQuery({
    queryKey: mpBroadcastKeys.result(id),
    queryFn: () => request.get<MpBroadcastResult>(`/api/mp/broadcasts/${id}/result`).then(unwrap),
    enabled: enabled && id != null,
  });
}

export function useSaveMpBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number | null; values: Record<string, unknown> }) =>
      (id ? request.put<MpBroadcast>(`/api/mp/broadcasts/${id}`, values) : request.post<MpBroadcast>('/api/mp/broadcasts', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpBroadcastKeys.all }),
  });
}

export function useSendMpBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/mp/broadcasts/${id}/send`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpBroadcastKeys.all }),
  });
}

export function usePreviewMpBroadcast() {
  return useMutation({
    mutationFn: ({ id, openid }: { id: number; openid: string }) =>
      request.post<null>(`/api/mp/broadcasts/${id}/preview`, { openid }).then(unwrap),
  });
}

export function useDeleteMpBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/broadcasts/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpBroadcastKeys.all }),
  });
}
