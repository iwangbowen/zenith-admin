import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Region } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface RegionTreeParams {
  keyword?: string;
  status?: string;
  level?: string;
}

export const regionKeys = {
  all: ['regions'] as const,
  trees: ['regions', 'tree'] as const,
  tree: (params: RegionTreeParams) => ['regions', 'tree', params] as const,
  flat: ['regions', 'flat'] as const,
  detail: (id: number | undefined) => ['regions', 'detail', id] as const,
};

export function useRegionTree(params: RegionTreeParams) {
  return useQuery({
    queryKey: regionKeys.tree(params),
    queryFn: () => request.get<Region[]>(`/api/regions${toQueryString(params)}`).then(unwrap),
  });
}

export function useFlatRegions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: regionKeys.flat,
    queryFn: () => request.get<Region[]>('/api/regions/flat').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useRegionDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: regionKeys.detail(id),
    queryFn: () => request.get<Region>(`/api/regions/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Region> }) =>
      (id === undefined
        ? request.post<Region>('/api/regions', values)
        : request.put<Region>(`/api/regions/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: regionKeys.all }),
  });
}

export function useDeleteRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/regions/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: regionKeys.all }),
  });
}
