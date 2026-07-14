import type { ApiResponse } from '@zenith/shared';
import { showRequestErrorToast, showRequestWarningToast } from './request-toast';

/** ApiResponse 扩展：限流时携带 retryAfterSeconds */
export type ApiResponseWithMeta<T> = ApiResponse<T> & { retryAfterSeconds?: number };

export interface HttpRequestOptions {
  /** 静默模式：为 true 时不自动弹出错误提示，由调用方自行处理 */
  silent?: boolean;
  /** 跳过 401 自动刷新/跳转：为 true 时 401 直接返回响应体，不触发 token 刷新或退出登录（用于密码校验、登录接口等场景） */
  skipAuth?: boolean;
  signal?: AbortSignal;
  headers?: HeadersInit;
}

export interface HttpClientConfig {
  baseUrl: string;
  /** localStorage 中 accessToken 的 key */
  tokenKey: string;
  /** localStorage 中 refreshToken 的 key */
  refreshTokenKey: string;
  /** token 刷新接口路径，如 '/api/auth/refresh' */
  refreshPath: string;
  /** 认证失效时的登录页跳转地址 */
  loginUrl: () => string;
  /** 退出登录时清除的 localStorage key（默认 [tokenKey, refreshTokenKey]） */
  logoutClearKeys?: string[];
  /** skipAuth 模式下 401 响应体解析失败时的兜底错误消息 */
  unauthorizedFallbackMessage?: string;
  /** 是否处理 503 维护模式（派发 maintenance:enabled 事件，仅 admin 端启用） */
  handleMaintenance?: boolean;
}

/**
 * 通用 HTTP 客户端核心（admin / member / approval 三端共用）。
 *
 * 统一实现：Bearer token 注入、401 单飞（single-flight）刷新与重试、
 * 刷新失败清除凭证并跳登录页、429 限流提示、统一错误提示与响应解析。
 * 各端通过 HttpClientConfig 参数化 token key、刷新接口与登录页地址。
 */
export class HttpClient {
  protected readonly baseUrl: string;
  private readonly tokenKey: string;
  private readonly refreshTokenKey: string;
  private readonly refreshPath: string;
  private readonly loginUrl: () => string;
  private readonly logoutClearKeys: string[];
  private readonly unauthorizedFallbackMessage: string;
  private readonly handleMaintenance: boolean;
  private refreshing: Promise<boolean> | null = null;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.tokenKey = config.tokenKey;
    this.refreshTokenKey = config.refreshTokenKey;
    this.refreshPath = config.refreshPath;
    this.loginUrl = config.loginUrl;
    this.logoutClearKeys = config.logoutClearKeys ?? [config.tokenKey, config.refreshTokenKey];
    this.unauthorizedFallbackMessage = config.unauthorizedFallbackMessage ?? '未授权';
    this.handleMaintenance = config.handleMaintenance ?? false;
  }

  protected getHeaders(body?: BodyInit | null): HeadersInit {
    const headers: HeadersInit = {};
    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const token = localStorage.getItem(this.tokenKey);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  protected async tryRefreshToken(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      const refreshToken = localStorage.getItem(this.refreshTokenKey);
      if (!refreshToken) return false;

      try {
        const res = await fetch(`${this.baseUrl}${this.refreshPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.code === 0 && data.data?.accessToken) {
          localStorage.setItem(this.tokenKey, data.data.accessToken);
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

  /** 清除本地凭证并跳转登录页 */
  protected clearAuthAndRedirect(): void {
    for (const key of this.logoutClearKeys) {
      localStorage.removeItem(key);
    }
    globalThis.location.href = this.loginUrl();
  }

  private fail<T>(silent: boolean | undefined, message: string, code = -1): ApiResponseWithMeta<T> {
    if (!silent) showRequestErrorToast(message);
    return { code, message, data: null as unknown as T };
  }

  async request<T>(url: string, options: RequestInit & HttpRequestOptions = {}): Promise<ApiResponseWithMeta<T>> {
    const { silent, skipAuth, ...fetchOptions } = options;
    const doFetch = () => fetch(`${this.baseUrl}${url}`, {
      ...fetchOptions,
      headers: { ...this.getHeaders(fetchOptions.body), ...fetchOptions.headers },
    });

    let res: Response;
    try {
      res = await doFetch();
    } catch {
      return this.fail<T>(silent, '网络请求失败，请检查网络连接');
    }

    if (res.status === 401) {
      // skipAuth=true 时直接解析响应体返回，不触发刷新/跳转（用于密码校验、登录接口等场景）
      if (skipAuth) {
        try {
          const data: ApiResponse<T> = await res.json();
          return data;
        } catch {
          return { code: 401, message: this.unauthorizedFallbackMessage, data: null as unknown as T };
        }
      }
      // Try refresh token before giving up
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        // Retry original request with new token
        try {
          res = await doFetch();
        } catch {
          return this.fail<T>(silent, '网络请求失败，请检查网络连接');
        }
        if (res.status === 401) {
          this.clearAuthAndRedirect();
          throw new Error('Unauthorized');
        }
      } else {
        this.clearAuthAndRedirect();
        throw new Error('Unauthorized');
      }
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;
      try {
        const data = await res.json() as ApiResponse<T>;
        if (!silent) showRequestErrorToast(data.message || '请求过于频繁，请稍后再试');
        return retryAfterSeconds ? { ...data, retryAfterSeconds } : data;
      } catch {
        const msg = '请求过于频繁，请稍后再试';
        if (!silent) showRequestErrorToast(msg);
        return { code: 429, message: msg, data: null as unknown as T, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
      }
    }

    if (this.handleMaintenance && res.status === 503) {
      let detail: { message?: string; estimatedEndAt?: string | null; startedAt?: string | null } = {};
      try {
        const parsed = await res.json() as { message: string; data: typeof detail };
        detail = parsed.data ?? {};
        globalThis.dispatchEvent(new CustomEvent('maintenance:enabled', { detail }));
        if (!silent) showRequestWarningToast(parsed.message || '系统维护中，请稍后重试');
        return { code: 503, message: parsed.message || '系统维护中，请稍后重试', data: null as unknown as T };
      } catch {
        globalThis.dispatchEvent(new CustomEvent('maintenance:enabled', { detail }));
        return { code: 503, message: '系统维护中，请稍后重试', data: null as unknown as T };
      }
    }

    try {
      const data: ApiResponse<T> = await res.json();
      if (data.code !== 0 && !silent) {
        showRequestErrorToast(data.message || '操作失败');
      }
      return data;
    } catch {
      return this.fail<T>(silent, '响应解析失败');
    }
  }

  get<T>(url: string, opts: HttpRequestOptions = {}) {
    return this.request<T>(url, { method: 'GET', ...opts });
  }

  post<T>(url: string, body?: unknown, opts: HttpRequestOptions = {}) {
    return this.request<T>(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body), ...opts });
  }

  put<T>(url: string, body?: unknown, opts: HttpRequestOptions = {}) {
    return this.request<T>(url, { method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body), ...opts });
  }

  patch<T>(url: string, body?: unknown, opts: HttpRequestOptions = {}) {
    return this.request<T>(url, { method: 'PATCH', body: body instanceof FormData ? body : JSON.stringify(body), ...opts });
  }

  delete<T>(url: string, body?: unknown, opts: HttpRequestOptions = {}) {
    const bodyInit = body === undefined ? {} : { body: JSON.stringify(body) };
    return this.request<T>(url, { method: 'DELETE', ...bodyInit, ...opts });
  }
}
