import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpMaterial, MpMaterialType, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpMaterialListParams {
  page: number;
  pageSize: number;
  type?: MpMaterialType;
  keyword?: string;
}

export interface MpMaterialSyncResult {
  created: number;
  updated: number;
}

export const mpMaterialKeys = {
  all: ['mp', 'materials'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'materials', accountId] as const,
  list: (accountId: number | null | undefined, params: MpMaterialListParams) => ['mp', 'materials', accountId, params] as const,
};

export function useMpMaterialList(accountId: number | null | undefined, params: MpMaterialListParams) {
  return useQuery({
    queryKey: mpMaterialKeys.list(accountId, params),
    queryFn: () =>
      request.get<PaginatedResponse<MpMaterial>>(`/api/mp/materials${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useSaveMpMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined ? request.post<MpMaterial>('/api/mp/materials', values) : request.put<MpMaterial>(`/api/mp/materials/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMaterialKeys.all }),
  });
}

export function useDeleteMpMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/materials/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMaterialKeys.all }),
  });
}

export function useSyncMpMaterials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<MpMaterialSyncResult>('/api/mp/materials/sync', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMaterialKeys.all }),
  });
}

export function useUploadMpMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress }: { formData: FormData; onProgress?: (percent: number) => void }) =>
      request.postForm<MpMaterial>('/api/mp/materials/upload', formData, { onProgress }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMaterialKeys.all }),
  });
}
