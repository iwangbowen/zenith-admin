import { QueryClient } from '@tanstack/react-query';
import type { ApiResponse } from '@zenith/shared';

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

/** 变化频率低的 lookup 数据（字典项、部门树、用户下拉源等）的默认 staleTime */
export const LOOKUP_STALE_TIME = 5 * 60 * 1000;

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
