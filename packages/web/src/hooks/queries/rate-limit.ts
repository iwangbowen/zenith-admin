import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceKeyOf } from '@zenith/shared/core';
import {
  rateLimitContract,
  type CreateRateLimitRuleInput,
  type RateLimitAlgorithm,
  type RateLimitKeyType,
  type RateLimitMode,
  type RateLimitMountSource,
  type RateLimitRule,
  type UpdateRateLimitRuleInput,
} from '@zenith/shared/platform';
import { config } from '@/config';
import { request } from '@/utils/request';
import { api, contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { unwrap, LOOKUP_STALE_TIME } from '@/lib/query';

export type { RateLimitAlgorithm, RateLimitKeyType, RateLimitMode, RateLimitMountSource };

export const rateLimitKeys = {
  all: [resourceKeyOf(rateLimitContract.basePath)] as const,
  rules: contractKey(rateLimitContract.rules),
  stats: contractKey(rateLimitContract.stats),
  bans: contractKey(rateLimitContract.bans),
  apiPaths: [resourceKeyOf(rateLimitContract.basePath), 'api-paths'] as const,
};

/** 规则配置：仅管理操作后失效，不随统计轮询刷新 */
export function useRateLimitRules() {
  return useApiQuery(rateLimitContract.rules);
}

/** 统计数据：30 秒轮询 */
export function useRateLimitStats() {
  return useApiQuery(rateLimitContract.stats, { refetchInterval: 30 * 1000 });
}

export function useRateLimitApiPaths() {
  return useQuery({
    queryKey: rateLimitKeys.apiPaths,
    // OpenAPI 路径集在部署内不变，长缓存避免反复拉取 260kB 文档
    staleTime: LOOKUP_STALE_TIME,
    queryFn: async () => {
      // openapi.json 返回原始 OpenAPI 文档（非 ApiResponse 信封），不走 request；但仍需拼接 API 基址
      const res = await fetch(`${config.apiBaseUrl}/api/openapi.json`);
      const spec = (await res.json()) as { paths?: Record<string, unknown> };
      return Object.keys(spec.paths ?? {})
        .filter((p) => p.startsWith('/api/'))
        .sort((a, b) => a.localeCompare(b))
        .map((p) => ({ label: p, value: p }));
    },
  });
}

/** 统计接口的规则元信息（enabled/mode/窗口）派生自规则配置，两者都需失效 */
function invalidateRuleViews(qc: import('@tanstack/react-query').QueryClient) {
  void qc.invalidateQueries({ queryKey: rateLimitKeys.rules });
  void qc.invalidateQueries({ queryKey: rateLimitKeys.stats });
}

/** 无 id 走 POST /rules 新增，有 id 走 PATCH /rules/{id} 部分更新（规则名称不可更改） */
export function useSaveRateLimitRule() {
  const qc = useQueryClient();
  return useMutation<RateLimitRule, Error, { id?: number; values: Partial<CreateRateLimitRuleInput> }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(rateLimitContract.createRule, { body: values as CreateRateLimitRuleInput })
      : api(rateLimitContract.updateRule, { params: { id }, body: values as UpdateRateLimitRuleInput })),
    onSuccess: () => invalidateRuleViews(qc),
  });
}

export function useDeleteRateLimitRule() {
  return useApiMutation(rateLimitContract.removeRule, { invalidate: invalidateRuleViews });
}

/** 解封返回服务端结果消息（成功 / 未找到活跃计数窗口），由调用方展示 */
export function useUnblockRateLimitKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, key }: { name: string; key: string }) => {
      const res = await request.post<null>(urlOf(rateLimitContract.unblock), { name, key });
      unwrap(res);
      return res.message;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateLimitKeys.stats });
    },
  });
}

export function useResetRateLimitStats() {
  return useApiMutation(rateLimitContract.resetStats, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: rateLimitKeys.stats }),
  });
}

/** 活跃封禁列表：30 秒轮询（TTL 持续变化） */
export function useRateLimitBans() {
  return useApiQuery(rateLimitContract.bans, { refetchInterval: 30 * 1000 });
}

export function useBanRateLimitKey() {
  return useApiMutation(rateLimitContract.ban, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: rateLimitKeys.bans }),
  });
}

/** 解除封禁返回服务端结果消息（成功 / 封禁不存在），由调用方展示 */
export function useUnbanRateLimitKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, key }: { name: string; key: string }) => {
      const res = await request.post<null>(urlOf(rateLimitContract.unban), { name, key });
      unwrap(res);
      return res.message;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateLimitKeys.bans });
    },
  });
}
