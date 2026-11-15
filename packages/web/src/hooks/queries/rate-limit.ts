// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf } from '@zenith/shared/core';
import { rateLimitContract, type RateLimitAlgorithm, type RateLimitKeyType, type RateLimitMode, type RateLimitMountSource } from '@zenith/shared/platform';
import { useSaveMutation, apiRaw, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';

export type { RateLimitAlgorithm, RateLimitKeyType, RateLimitMode, RateLimitMountSource };

export const rateLimitKeys = {
  rules: contractKey(rateLimitContract.rules),
  stats: contractKey(rateLimitContract.stats),
  bans: contractKey(rateLimitContract.bans),
  /** OpenAPI 路径集来自 /api/openapi.json（非契约操作），沿用本域资源键 + 区分段 */
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
  return useApiQuery(rateLimitContract.operations, { select: items => items.map(item => ({ label: item.method + ' ' + item.path + ' · ' + item.summary, value: item.path })) });
}
export function useDiagnoseRateLimit() { return useApiMutation(rateLimitContract.diagnose); }
export function useRateLimitDetailStats(id: number | null) { return useApiQuery(rateLimitContract.detailStats, { params: { id: id ?? 0 } }, { enabled: id !== null, refetchInterval: 30_000 }); }
export function useRateLimitEvents(query: import('@zenith/shared/core').QueryOf<typeof rateLimitContract.events>, enabled = true) { return useApiQuery(rateLimitContract.events, { query }, { enabled, refetchInterval: enabled ? 30_000 : false }); }

/** 统计接口的规则元信息（enabled/mode/窗口）派生自规则配置，两者都需失效 */
function invalidateRuleViews(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: rateLimitKeys.rules });
  void qc.invalidateQueries({ queryKey: rateLimitKeys.stats });
  void qc.invalidateQueries({ queryKey: contractKey(rateLimitContract.detailStats) });
  void qc.invalidateQueries({ queryKey: contractKey(rateLimitContract.events) });
}

/** 无 id 新增，有 id 部分更新（规则名称不可更改） */
export function useSaveRateLimitRule() {
  return useSaveMutation(rateLimitContract.createRule, rateLimitContract.updateRule, {
    invalidate: (qc) => invalidateRuleViews(qc),
  });
}

export function useDeleteRateLimitRule() {
  return useApiMutation(rateLimitContract.removeRule, { invalidate: invalidateRuleViews });
}

/** 解封返回服务端结果消息（成功 / 未找到活跃计数窗口），由调用方展示（H5：需读取信封 message，api() 会丢弃） */
export function useUnblockRateLimitKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, key }: { name: string; key: string }) => {
      const res = await apiRaw(rateLimitContract.unblock, { body: { name, key } });
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
    invalidate: (qc) => invalidateRuleViews(qc),
  });
}

/** 活跃封禁列表：30 秒轮询（TTL 持续变化） */
export function useRateLimitBans(enabled = true) {
  return useApiQuery(rateLimitContract.bans, { enabled, refetchInterval: 30 * 1000 });
}

export function useBanRateLimitKey() {
  return useApiMutation(rateLimitContract.ban, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: rateLimitKeys.bans }),
  });
}

/** 解除封禁返回服务端结果消息（成功 / 封禁不存在），由调用方展示（H5：需读取信封 message，api() 会丢弃） */
export function useUnbanRateLimitKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, key }: { name: string; key: string }) => {
      const res = await apiRaw(rateLimitContract.unban, { body: { name, key } });
      unwrap(res);
      return res.message;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateLimitKeys.bans });
    },
  });
}
