import { TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse } from '@zenith/shared';
import { config } from '../config';

class Request {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async request<T>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${url}`, {
      ...options,
      headers: { ...this.getHeaders(), ...options.headers },
    });

    const data: ApiResponse<T> = await res.json();

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    return data;
  }

  get<T>(url: string) {
    return this.request<T>(url, { method: 'GET' });
  }

  post<T>(url: string, body?: unknown) {
    return this.request<T>(url, { method: 'POST', body: JSON.stringify(body) });
  }

  put<T>(url: string, body?: unknown) {
    return this.request<T>(url, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete<T>(url: string) {
    return this.request<T>(url, { method: 'DELETE' });
  }
}

export const request = new Request(config.apiBaseUrl);
