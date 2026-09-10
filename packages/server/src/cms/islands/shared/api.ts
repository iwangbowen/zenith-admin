/** 服务端统一响应包裹（与 lib/response 约定一致：code 0 成功） */
export interface ApiResult<T = unknown> {
  code: number;
  message?: string;
  data?: T;
}

/** 组装请求头：JSON 体时带 Content-Type，有会员 token 时带 Authorization */
export function apiHeaders(token: string | null, json: boolean): Record<string, string> {
  const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** fetch + 解析 JSON；网络或解析失败时 reject，由调用方决定兜底 */
export async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(url, init);
  return (await res.json()) as ApiResult<T>;
}

export function isOk<T>(result: ApiResult<T> | null | undefined): result is ApiResult<T> & { data: T } {
  return !!result && result.code === 0;
}
