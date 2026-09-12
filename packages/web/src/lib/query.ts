import { QueryClient } from '@tanstack/react-query';
import type { ApiResponse } from '@zenith/shared/core';

/** 业务错误：统一响应 code !== 0 时由 unwrap 抛出（request 层已自动 toast，调用方通常无需重复提示） */
export class ApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message || `请求失败（code=${code}）`);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** 解包统一响应：成功返回 data，失败抛 ApiError（供 queryFn / mutationFn 使用） */
export function unwrap<T>(res: ApiResponse<T>): T {
  if (res.code !== 0) throw new ApiError(res.code, res.message);
  return res.data;
}

/** 构建查询字符串：自动过滤 undefined / null / 空字符串，非空时带 `?` 前缀 */
export function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** 从对象类型中剔除「未填」形态（`undefined` / `null` / 空串），键全部变为可选 */
export type CompactParams<T> = { [K in keyof T]?: Exclude<T[K], null | undefined | ''> };

/**
 * 已提交筛选 → 契约查询参数：丢弃 `undefined` / `null` / 空串，保留 `0` / `false`，并**保留键的类型**，
 * 结果可直接展开进 `QueryOf<typeof xxxContract.list>`。列表查询、导出条件、深链都从同一份映射派生，
 * 页面不再为列表写一份 `x || undefined`、为导出再写一份 `compactQuery({...})`。
 *
 * @example
 * const filterQuery = useMemo(() => compactParams({
 *   keyword: submittedParams.keyword,
 *   status: enumValueOf(XXX_STATUSES, submittedParams.status),
 *   ...formatDateTimeRangeForApi(submittedParams.timeRange),
 * }), [submittedParams]);
 * const listQuery = useXxxList({ page, pageSize, ...filterQuery });
 * <ExportButton entity="system.xxxs" query={filterQuery} permission="system:xxx:export" />
 */
export function compactParams<T extends Record<string, unknown>>(params: T): CompactParams<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    result[key] = value;
  }
  return result as CompactParams<T>;
}

/** `compactParams` 的弱类型形态：结果为 `Record<string, T>`，用于不需要契约类型的场景（拼查询串、透传给非契约通道） */
export function compactQuery<T extends string | number | boolean>(
  params: Record<string, T | null | undefined>,
): Record<string, T> {
  return compactParams(params) as Record<string, T>;
}

/** 变化频率低的 lookup 数据（字典项、部门树、用户下拉源等）的默认 staleTime */
export const LOOKUP_STALE_TIME = 5 * 60 * 1000;

/**
 * 轻量并发信号量：限制同类请求的最大并发数。
 * 用于仪表盘/设计器组件取数（一屏可能扇出数十个数据集查询），防止一次性打爆后端。
 */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
