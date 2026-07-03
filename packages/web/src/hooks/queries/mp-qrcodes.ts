import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpQrcode, MpQrcodeType, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpQrcodeListParams {
  accountId: number | null;
  page: number;
  pageSize: number;
  type?: MpQrcodeType;
  keyword?: string;
}

export const mpQrcodeKeys = {
  all: ['mp', 'qrcodes'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'qrcodes', accountId, 'list'] as const,
  list: (params: MpQrcodeListParams) => ['mp', 'qrcodes', params.accountId, 'list', params] as const,
};

export function useMpQrcodeList(params: MpQrcodeListParams) {
  return useQuery({
    queryKey: mpQrcodeKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<MpQrcode>>(`/api/mp/qrcodes${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: !!params.accountId,
  });
}

export function useCreateMpQrcode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<MpQrcode>('/api/mp/qrcodes', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpQrcodeKeys.all }),
  });
}

export function useDeleteMpQrcode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/qrcodes/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpQrcodeKeys.all }),
  });
}
