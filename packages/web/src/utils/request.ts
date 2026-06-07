import { Toast } from '@douyinfe/semi-ui';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse } from '@zenith/shared';
import { config } from '@/config';

export interface RequestOptions {
  /** 静默模式：为 true 时不自动弹出错误提示，由调用方自行处理 */
  silent?: boolean;
}

class Request {
  private readonly baseUrl: string;
  private refreshing: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(body?: BodyInit | null): HeadersInit {
    const headers: HeadersInit = {};
    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
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

  async request<T>(url: string, options: RequestInit & RequestOptions = {}): Promise<ApiResponse<T>> {
    const { silent, ...fetchOptions } = options;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${url}`, {
        ...fetchOptions,
        headers: { ...this.getHeaders(fetchOptions.body), ...fetchOptions.headers },
      });
    } catch {
      const errResp = { code: -1, message: '网络请求失败，请检查网络连接', data: null as unknown as T };
      if (!silent) Toast.error(errResp.message);
      return errResp;
    }

    if (res.status === 401) {
      // Try refresh token before giving up
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        // Retry original request with new token
        try {
          res = await fetch(`${this.baseUrl}${url}`, {
            ...fetchOptions,
            headers: { ...this.getHeaders(fetchOptions.body), ...fetchOptions.headers },
          });
        } catch {
          const errResp = { code: -1, message: '网络请求失败，请检查网络连接', data: null as unknown as T };
          if (!silent) Toast.error(errResp.message);
          return errResp;
        }
        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          globalThis.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '') || ''}/login`;
          throw new Error('Unauthorized');
        }
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        globalThis.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '') || ''}/login`;
        throw new Error('Unauthorized');
      }
    }

    if (res.status === 503) {
      let detail: { message?: string; estimatedEndAt?: string | null; startedAt?: string | null } = {};
      try {
        const parsed = await res.json() as { message: string; data: typeof detail };
        detail = parsed.data ?? {};
        globalThis.dispatchEvent(new CustomEvent('maintenance:enabled', { detail }));
        if (!silent) Toast.warning(parsed.message || '系统维护中，请稍后重试');
        return { code: 503, message: parsed.message || '系统维护中，请稍后重试', data: null as unknown as T };
      } catch {
        globalThis.dispatchEvent(new CustomEvent('maintenance:enabled', { detail }));
        return { code: 503, message: '系统维护中，请稍后重试', data: null as unknown as T };
      }
    }

    try {
      const data: ApiResponse<T> = await res.json();
      if (data.code !== 0 && !silent) {
        Toast.error(data.message || '操作失败');
      }
      return data;
    } catch {
      const errResp = { code: -1, message: '响应解析失败', data: null as unknown as T };
      if (!silent) Toast.error(errResp.message);
      return errResp;
    }
  }

  get<T>(url: string, opts: RequestOptions = {}) {
    return this.request<T>(url, { method: 'GET', ...opts });
  }

  post<T>(url: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request<T>(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body), ...opts });
  }

  put<T>(url: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request<T>(url, { method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body), ...opts });
  }

  patch<T>(url: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request<T>(url, { method: 'PATCH', body: body instanceof FormData ? body : JSON.stringify(body), ...opts });
  }

  delete<T>(url: string, body?: unknown, opts: RequestOptions = {}) {
    const bodyInit = body === undefined ? {} : { body: JSON.stringify(body) };
    return this.request<T>(url, { method: 'DELETE', ...bodyInit, ...opts });
  }

  postForm<T>(url: string, body: FormData, opts: RequestOptions = {}) {
    return this.request<T>(url, { method: 'POST', body, ...opts });
  }

  /** Download a file (binary response) - used for Excel export */
  async download(url: string, filename: string): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${url}`, { headers });
    } catch {
      Toast.error('网络请求失败，请检查网络连接');
      return;
    }

    if (res.status === 401) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        const retryHeaders: HeadersInit = {};
        const newToken = localStorage.getItem(TOKEN_KEY);
        if (newToken) retryHeaders['Authorization'] = `Bearer ${newToken}`;
        try {
          res = await fetch(`${this.baseUrl}${url}`, { headers: retryHeaders });
        } catch {
          Toast.error('网络请求失败，请检查网络连接');
          return;
        }
        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          globalThis.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '') || ''}/login`;
          return;
        }
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        globalThis.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '') || ''}/login`;
        return;
      }
    }

    if (!res.ok) {
      try {
        const data = await res.json();
        Toast.error(data?.message || '下载失败');
      } catch {
        Toast.error('下载失败');
      }
      return;
    }

    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

export const request = new Request(config.apiBaseUrl);
