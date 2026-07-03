import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dict, DictItem, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface DictListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const dictKeys = {
  all: ['dicts'] as const,
  lists: ['dicts', 'list'] as const,
  list: (params: DictListParams) => ['dicts', 'list', params] as const,
  items: (dictId: number | undefined) => ['dicts', 'items', dictId] as const,
  detail: (id: number | undefined) => ['dicts', 'detail', id] as const,
  itemDetail: (dictId: number | undefined, itemId: number | undefined) => ['dicts', 'item-detail', dictId, itemId] as const,
};

export function useDictList(params: DictListParams) {
  return useQuery({
    queryKey: dictKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<Dict>>(`/api/dicts${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useDictDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: dictKeys.detail(id),
    queryFn: () => request.get<Dict>(`/api/dicts/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useDictItemsById(dictId: number | undefined) {
  return useQuery({
    queryKey: dictKeys.items(dictId),
    queryFn: () => request.get<DictItem[]>(`/api/dicts/${dictId}/items`).then(unwrap),
    enabled: !!dictId,
  });
}

export function useDictItemDetail(dictId: number | undefined, itemId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: dictKeys.itemDetail(dictId, itemId),
    queryFn: () => request.get<DictItem>(`/api/dicts/${dictId}/items/${itemId}`).then(unwrap),
    enabled: enabled && dictId !== undefined && itemId !== undefined,
  });
}

export function useSaveDict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Dict> }) =>
      (id === undefined
        ? request.post<Dict>('/api/dicts', values)
        : request.put<Dict>(`/api/dicts/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dictKeys.all }),
  });
}

export function useDeleteDict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/dicts/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dictKeys.all }),
  });
}

export function useSaveDictItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dictId, itemId, values }: { dictId: number; itemId?: number; values: Partial<DictItem> }) =>
      (itemId === undefined
        ? request.post<DictItem>(`/api/dicts/${dictId}/items`, values)
        : request.put<DictItem>(`/api/dicts/${dictId}/items/${itemId}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dictKeys.all }),
  });
}

export function useDeleteDictItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dictId, itemId }: { dictId: number; itemId: number }) =>
      request.delete<null>(`/api/dicts/${dictId}/items/${itemId}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dictKeys.all }),
  });
}
