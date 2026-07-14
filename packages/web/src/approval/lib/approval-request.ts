import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse } from '@zenith/shared';
import { config } from '@/config';
import { HttpClient, type HttpRequestOptions } from '@/utils/http-client';

/**
 * 移动审批轻页专用 HTTP 客户端（与后台 admin request 隔离，但共享同一套管理员 token）。
 * - 携带 admin token（TOKEN_KEY，同域 localStorage：admin 已登录则免登）
 * - 401 自动走 /api/auth/refresh 刷新，失败跳轻页登录页
 * - HashRouter 入口：登录页为 /approval.html#/login
 * - 退出时仅清除 accessToken，保留 refreshToken 供 admin 端继续使用
 *
 * 通用逻辑见 @/utils/http-client.ts。
 */

export type ApprovalRequestOptions = HttpRequestOptions;

function approvalLoginUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') || '';
  return `${base}/approval.html#/login`;
}

class ApprovalRequest extends HttpClient {
  /** 保留原有语义：body 省略时发送空对象 `{}` 而非无 body */
  post<T>(url: string, body?: unknown, opts: ApprovalRequestOptions = {}) {
    return super.post<T>(url, body ?? {}, opts);
  }
}

export const approvalRequest = new ApprovalRequest({
  baseUrl: config.apiBaseUrl,
  tokenKey: TOKEN_KEY,
  refreshTokenKey: REFRESH_TOKEN_KEY,
  refreshPath: '/api/auth/refresh',
  loginUrl: approvalLoginUrl,
  logoutClearKeys: [TOKEN_KEY],
});

/** 统一解包：code!==0 抛错（配合 TanStack Query 错误态） */
export function unwrapApproval<T>(res: ApiResponse<T>): T {
  if (res.code !== 0) throw new Error(res.message || '请求失败');
  return res.data;
}
