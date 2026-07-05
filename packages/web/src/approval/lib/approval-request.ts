import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse } from '@zenith/shared';
import { config } from '@/config';
import { showRequestErrorToast } from '@/utils/request-toast';

/**
 * 移动审批轻页专用 HTTP 客户端（与后台 admin request 隔离，但共享同一套管理员 token）。
 * - 携带 admin token（TOKEN_KEY，同域 localStorage：admin 已登录则免登）
 * - 401 自动走 /api/auth/refresh 刷新，失败跳轻页登录页
 * - HashRouter 入口：登录页为 /approval.html#/login
 */

export interface ApprovalRequestOptions {
  /** 静默模式：为 true 时不自动弹出错误提示，由调用方自行处理 */
  silent?: boolean;
  /** 跳过 401 自动刷新/跳转（登录接口自身使用） */
  skipAuth?: boolean;
  headers?: Record<string, string>;
}

function approvalLoginUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') || '';
  return `${base}/approval.html#/login`;
}

class ApprovalRequest {
  private readonly baseUrl: string;
  private refreshing: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  private async tryRefreshToken(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.code === 0 && data.data?.accessToken) {
          localStorage.setItem(TOKEN_KEY, data.data.accessToken);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private clearAndRedirect(): void {
    localStorage.removeItem(TOKEN_KEY);
    globalThis.location.href = approvalLoginUrl();
  }

  async request<T>(url: string, options: RequestInit & ApprovalRequestOptions = {}): Promise<ApiResponse<T>> {
    const { silent, skipAuth, ...fetchOptions } = options;
    const doFetch = () => fetch(`${this.baseUrl}${url}`, {
      ...fetchOptions,
      headers: { ...this.getHeaders(), ...fetchOptions.headers },
    });
    let res: Response;
    try {
      res = await doFetch();
    } catch {
      const errResp = { code: -1, message: '网络请求失败，请检查网络连接', data: null as unknown as T };
      if (!silent) showRequestErrorToast(errResp.message);
      return errResp;
    }

    if (res.status === 401 && !skipAuth) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        try {
          res = await doFetch();
        } catch {
          const errResp = { code: -1, message: '网络请求失败，请检查网络连接', data: null as unknown as T };
          if (!silent) showRequestErrorToast(errResp.message);
          return errResp;
        }
      }
      if (res.status === 401) {
        this.clearAndRedirect();
        throw new Error('Unauthorized');
      }
    }

    try {
      const data: ApiResponse<T> = await res.json();
      if (data.code !== 0 && !silent) {
        showRequestErrorToast(data.message || '操作失败');
      }
      return data;
    } catch {
      const errResp = { code: -1, message: '响应解析失败', data: null as unknown as T };
      if (!silent) showRequestErrorToast(errResp.message);
      return errResp;
    }
  }

  get<T>(url: string, opts: ApprovalRequestOptions = {}) {
    return this.request<T>(url, { method: 'GET', ...opts });
  }

  post<T>(url: string, body?: unknown, opts: ApprovalRequestOptions = {}) {
    return this.request<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}), ...opts });
  }
}

export const approvalRequest = new ApprovalRequest(config.apiBaseUrl);

/** 统一解包：code!==0 抛错（配合 TanStack Query 错误态） */
export function unwrapApproval<T>(res: ApiResponse<T>): T {
  if (res.code !== 0) throw new Error(res.message || '请求失败');
  return res.data;
}
