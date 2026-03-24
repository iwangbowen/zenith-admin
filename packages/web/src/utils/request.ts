import { Toast } from '@douyinfe/semi-ui';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse } from '@zenith/shared';
import { config } from '../config';

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
          globalThis.location.href = '/login';
          throw new Error('Unauthorized');
        }
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        globalThis.location.href = '/login';
        throw new Error('Unauthorized');
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

  delete<T>(url: string, opts: RequestOptions = {}) {
    return this.request<T>(url, { method: 'DELETE', ...opts });
  }

  postForm<T>(url: string, body: FormData, opts: RequestOptions = {}) {
    return this.request<T>(url, { method: 'POST', body, ...opts });
  }

  /** Download a file (binary response) - used for Excel export */
  async download(url: string, filename: string): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${url}`, { headers });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

export const request = new Request(config.apiBaseUrl);
