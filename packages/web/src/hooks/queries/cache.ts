import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export interface CacheItem {
  key: string;
  displayKey: string;
  segment: string;
  category: string;
  type: string;
  ttl: number;
  size: number;
  value: string | null;
}

export interface CacheOverview {
  connected: boolean;
  version: string;
  uptimeSeconds: number;
  connectedClients: number;
  usedMemory: number;
  usedMemoryHuman: string;
  maxMemory: number;
  memFragmentationRatio: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRate: number;
  totalKeys: number;
  keyPrefix: string;
}

export const cacheKeys = {
  all: ['cache'] as const,
  lists: ['cache', 'list'] as const,
  list: ['cache', 'list'] as const,
  overview: ['cache', 'overview'] as const,
  value: (key: string | undefined) => ['cache', 'value', key] as const,
};

export function useCacheList() {
  return useQuery({
    queryKey: cacheKeys.list,
    queryFn: () => request.get<{ list: CacheItem[]; total: number }>('/api/cache').then(unwrap),
  });
}

export function useCacheOverview() {
  return useQuery({
    queryKey: cacheKeys.overview,
    queryFn: () => request.get<CacheOverview>('/api/cache/overview', { silent: true }).then(unwrap),
  });
}

export function useCacheValue(key: string | undefined, enabled = true) {
  return useQuery({
    queryKey: cacheKeys.value(key),
    queryFn: () => request.get<string | null>(`/api/cache/value?key=${encodeURIComponent(key ?? '')}`).then(unwrap),
    enabled: enabled && key !== undefined,
  });
}

export function useDeleteCacheKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => request.delete<null>('/api/cache', { key }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKeys.all }),
  });
}

export function useBatchDeleteCacheKeys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keys: string[]) => request.delete<{ count: number }>('/api/cache/batch', { keys }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKeys.all }),
  });
}

export function useDeleteCacheCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (segment: string) => request.delete<{ count: number }>('/api/cache/by-category', { segment }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKeys.all }),
  });
}

export function useClearAllCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.delete<{ count: number }>('/api/cache/all', {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKeys.all }),
  });
}

export function useUpdateCacheTtl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ttl }: { key: string; ttl: number }) => request.put<null>('/api/cache/ttl', { key, ttl }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKeys.all }),
  });
}

export function useUpdateCacheValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => request.put<null>('/api/cache/value', { key, value }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cacheKeys.all }),
  });
}
