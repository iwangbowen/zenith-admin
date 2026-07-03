import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export type RateLimitKeyType = 'ip' | 'user' | 'ip_path';

export interface RateLimitRule {
  id: number;
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: RateLimitKeyType;
  enabled: boolean;
  blockedMessage: string | null;
  pathPatterns: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RecentBlock {
  at: string;
  key: string;
  path: string;
}

export interface RateLimitStatItem {
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: string;
  enabled: boolean;
  hitCount: number;
  blockedCount: number;
  blockRate: number;
  recentBlocks: RecentBlock[];
  hourlySeries: { hour: string; hits: number; blocked: number }[];
}

export interface RateLimitStats {
  items: RateLimitStatItem[];
}

export const rateLimitKeys = {
  all: ['rate-limit'] as const,
  dashboard: ['rate-limit', 'dashboard'] as const,
  apiPaths: ['rate-limit', 'api-paths'] as const,
};

export function useRateLimitDashboard() {
  return useQuery({
    queryKey: rateLimitKeys.dashboard,
    queryFn: async () => {
      const [rules, stats] = await Promise.all([
        request.get<RateLimitRule[]>('/api/rate-limit/rules').then(unwrap),
        request.get<RateLimitStats>('/api/rate-limit/stats').then(unwrap),
      ]);
      return { rules, stats };
    },
    refetchInterval: 30 * 1000,
  });
}

export function useRateLimitApiPaths() {
  return useQuery({
    queryKey: rateLimitKeys.apiPaths,
    queryFn: async () => {
      const res = await fetch('/api/openapi.json');
      const spec = (await res.json()) as { paths?: Record<string, unknown> };
      return Object.keys(spec.paths ?? {})
        .filter((p) => p.startsWith('/api/'))
        .sort((a, b) => a.localeCompare(b))
        .map((p) => ({ label: p, value: p }));
    },
  });
}

export function useSaveRateLimitRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<RateLimitRule> }) =>
      (id === undefined
        ? request.post<RateLimitRule>('/api/rate-limit/rules', values)
        : request.patch<RateLimitRule>(`/api/rate-limit/rules/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: rateLimitKeys.all }),
  });
}

export function useDeleteRateLimitRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/rate-limit/rules/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: rateLimitKeys.all }),
  });
}

export function useUnblockRateLimitKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, key }: { name: string; key: string }) =>
      request.post<null>('/api/rate-limit/unblock', { name, key }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: rateLimitKeys.all }),
  });
}

export function useResetRateLimitStats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => request.post<null>('/api/rate-limit/reset-stats', { name }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: rateLimitKeys.all }),
  });
}
