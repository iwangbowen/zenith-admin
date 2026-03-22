import { TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse } from '@zenith/shared';
import { config } from '../config';

class Request {
  private readonly baseUrl: string;

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

  async request<T>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${url}`, {
        ...options,
        headers: { ...this.getHeaders(options.body), ...options.headers },
      });
    } catch {
      return { code: -1, message: '网络请求失败，请检查网络连接', data: null as unknown as T };
    }

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      globalThis.location.href = '/login';
      throw new Error('Unauthorized');
    }

    try {
      const data: ApiResponse<T> = await res.json();
      return data;
    } catch {
      return { code: -1, message: '响应解析失败', data: null as unknown as T };
    }
  }

  get<T>(url: string) {
    return this.request<T>(url, { method: 'GET' });
  }

  post<T>(url: string, body?: unknown) {
    return this.request<T>(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) });
  }

  put<T>(url: string, body?: unknown) {
    return this.request<T>(url, { method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body) });
  }

  delete<T>(url: string) {
    return this.request<T>(url, { method: 'DELETE' });
  }

  postForm<T>(url: string, body: FormData) {
    return this.request<T>(url, { method: 'POST', body });
  }
}

export const request = new Request(config.apiBaseUrl);
