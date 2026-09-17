import type { ApiResponse } from '@zenith/shared/core';
import { SESSION_CLIENT_HEADER, type SessionClientKind, type SessionRevokeReason } from '@zenith/shared/identity';
import { showRequestErrorToast, showRequestWarningToast } from './request-toast';
import { abortSubmit } from '@/lib/abort-submit';

/** ApiResponse 扩展：限流时携带 retryAfterSeconds */
export type ApiResponseWithMeta<T> = ApiResponse<T> & { retryAfterSeconds?: number };

/** 会话被动失效的原因标记（sessionStorage）：登录页读取后提示并清除 */
export const AUTH_INVALIDATED_REASON_KEY = 'zenith_auth_invalidated_reason';

/** 会话被动失效的结构化原因：登录页据 `reason` 决定展示方式（被挤下线 → 常驻横幅；其它 → 提示），`username` 用于预填 */
export interface AuthInvalidatedReason {
  message: string;
  /** 服务端 401 响应体回传的吊销原因；WS 被挤下线也写入 concurrent-login */
  reason?: SessionRevokeReason;
  /** 失效前登录的账号（从本地 access token 解出），登录页预填用户名 */
  username?: string;
}

const GENERIC_INVALIDATED_MESSAGE = '登录状态已失效：会话已过期，或已在其他设备被注销/被管理员下线，请重新登录';

export function writeAuthInvalidatedReason(detail: AuthInvalidatedReason): void {
  try {
    sessionStorage.setItem(AUTH_INVALIDATED_REASON_KEY, JSON.stringify(detail));
  } catch {
    // sessionStorage 不可用时跳过提示
  }
}

/** 读取并清除失效原因；兼容历史的纯文本值 */
export function takeAuthInvalidatedReason(): AuthInvalidatedReason | null {
  try {
    const raw = sessionStorage.getItem(AUTH_INVALIDATED_REASON_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(AUTH_INVALIDATED_REASON_KEY);
    if (!raw.startsWith('{')) return { message: raw };
    const parsed = JSON.parse(raw) as Partial<AuthInvalidatedReason>;
    return { message: parsed.message || GENERIC_INVALIDATED_MESSAGE, reason: parsed.reason, username: parsed.username };
  } catch {
    return null;
  }
}

/** 从 JWT 载荷解出用户名（不校验签名，仅用于登录页预填）；解析失败返回 undefined */
export function usernameFromAccessToken(token: string | null): string | undefined {
  if (!token) return undefined;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const username = (JSON.parse(new TextDecoder().decode(bytes)) as { username?: unknown }).username;
    return typeof username === 'string' && username ? username : undefined;
  } catch {
    return undefined;
  }
}

export interface HttpRequestOptions {
  /** 静默模式：为 true 时不自动弹出错误提示，由调用方自行处理 */
  silent?: boolean;
  /** 跳过 401 自动刷新/跳转：为 true 时 401 直接返回响应体，不触发 token 刷新或退出登录（用于密码校验、登录接口等场景） */
  skipAuth?: boolean;
  signal?: AbortSignal;
  /** 业务请求头；Authorization 由当前客户端的账户令牌决定，FormData 的 Content-Type 由浏览器生成 */
  headers?: HeadersInit;
}

/** 刷新结果三态：refreshed=已换发新 token；invalid=refresh token 确认失效（应登出）；
 * transient=瞬时失败（限流/服务端错误/网络抖动，不应清除凭证登出用户） */
type RefreshOutcome = 'refreshed' | 'invalid' | 'transient';

export interface HttpClientConfig {
  baseUrl: string;
  /** localStorage 中 accessToken 的 key */
  tokenKey: string;
  /** localStorage 中 refreshToken 的 key */
  refreshTokenKey: string;
  /** token 刷新接口路径（取自认证契约） */
  refreshPath: string;
  /** 认证失效时的登录页跳转地址 */
  loginUrl: () => string;
  /** 认证失效后的宿主回调；提供时由宿主切换登录状态，否则执行整页跳转 */
  onUnauthorized?: () => void;
  /** 退出登录时清除的 localStorage key（默认 [tokenKey, refreshTokenKey]） */
  logoutClearKeys?: string[];
  /** skipAuth 模式下 401 响应体解析失败时的兜底错误消息 */
  unauthorizedFallbackMessage?: string;
  /** 是否处理 503 维护模式（派发 maintenance:enabled 事件，仅 admin 端启用） */
  handleMaintenance?: boolean;
  /** 本端的登录终端类型（网页 / 移动审批 / 桌面端），随每个请求以 X-Zenith-Client 上报；服务端据此展示会话终端并按终端分别计算并发 */
  clientKind?: SessionClientKind | (() => SessionClientKind);
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
  private readonly onUnauthorized?: () => void;
  private readonly logoutClearKeys: string[];
  private readonly unauthorizedFallbackMessage: string;
  private readonly handleMaintenance: boolean;
  private readonly clientKind?: SessionClientKind | (() => SessionClientKind);
  private refreshing: Promise<RefreshOutcome> | null = null;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.tokenKey = config.tokenKey;
    this.refreshTokenKey = config.refreshTokenKey;
    this.refreshPath = config.refreshPath;
    this.loginUrl = config.loginUrl;
    this.onUnauthorized = config.onUnauthorized;
    this.logoutClearKeys = config.logoutClearKeys ?? [config.tokenKey, config.refreshTokenKey];
    this.unauthorizedFallbackMessage = config.unauthorizedFallbackMessage ?? '未授权';
    this.handleMaintenance = config.handleMaintenance ?? false;
    this.clientKind = config.clientKind;
  }

  protected getHeaders(body?: BodyInit | null, overrides?: HeadersInit): Headers {
    const headers = new Headers(overrides);
    if (body instanceof FormData) {
      // boundary 必须与浏览器编码的表单一致，不能沿用调用方手写的 Content-Type。
      headers.delete('content-type');
    } else if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    // 每次发送（含刷新重试）读取所属账户的最新令牌，业务头不能切换认证身份。
    headers.delete('authorization');
    for (const [name, value] of Object.entries(this.authHeaders())) headers.set(name, value);
    const client = typeof this.clientKind === 'function' ? this.clientKind() : this.clientKind;
    if (client) headers.set(SESSION_CLIENT_HEADER, client);
    return headers;
  }

  /** 当前登录态的鉴权头；每次调用重新读取 token，供第三方上传组件等无法经 request 层的场景使用 */
  authHeaders(): Record<string, string> {
    const token = localStorage.getItem(this.tokenKey);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** 最近一次 refresh 失效时服务端回传的原因（如 jti 被挤下线），供 clearAuthAndRedirect 兜底 */
  private lastInvalidation: AuthInvalidatedReason | null = null;

  /** 读取 401 响应体里的吊销原因（不消费原响应）；解析失败返回 null */
  protected async readInvalidation(res: Response): Promise<AuthInvalidatedReason | null> {
    try {
      const body = await res.clone().json() as { message?: unknown; reason?: unknown };
      if (typeof body.reason !== 'string') return null;
      return { reason: body.reason as SessionRevokeReason, message: typeof body.message === 'string' && body.message ? body.message : GENERIC_INVALIDATED_MESSAGE };
    } catch {
      return null;
    }
  }

  protected async tryRefreshToken(): Promise<RefreshOutcome> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async (): Promise<RefreshOutcome> => {
      const refreshToken = localStorage.getItem(this.refreshTokenKey);
      if (!refreshToken) return 'invalid';

      try {
        const client = typeof this.clientKind === 'function' ? this.clientKind() : this.clientKind;
        const res = await fetch(`${this.baseUrl}${this.refreshPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(client ? { [SESSION_CLIENT_HEADER]: client } : {}) },
          body: JSON.stringify({ refreshToken }),
        });
        // 仅 401/403 表示 refresh token 确认失效；429 限流、5xx 等瞬时故障不得清凭证登出
        if (res.status === 401 || res.status === 403) {
          this.lastInvalidation = await this.readInvalidation(res);
          return 'invalid';
        }
        if (!res.ok) return 'transient';
        const data = await res.json();
        if (data.code === 0 && data.data?.accessToken) {
          localStorage.setItem(this.tokenKey, data.data.accessToken);
          // 服务端续签同时轮换 refresh token（旧的立即失效），必须以新值覆盖本地保存
          if (typeof data.data.refreshToken === 'string' && data.data.refreshToken) {
            localStorage.setItem(this.refreshTokenKey, data.data.refreshToken);
          }
          return 'refreshed';
        }
        return data.code === 401 || data.code === 403 ? 'invalid' : 'transient';
      } catch {
        return 'transient';
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  /**
   * 清除本地凭证，并通知宿主或跳转登录页。
   * 被动失效（token 过期 / 在其他设备被注销 / 被管理员强退）与用户主动退出不同：留下原因标记，登录页展示提示，
   * 避免用户误以为系统故障；服务端回传了吊销原因（被挤下线 / 改密）时按原文案 + 机读原因写入，并带上失效账号供预填。
   */
  protected clearAuthAndRedirect(detail?: AuthInvalidatedReason | null): void {
    const username = usernameFromAccessToken(localStorage.getItem(this.tokenKey));
    for (const key of this.logoutClearKeys) {
      localStorage.removeItem(key);
    }
    const resolved = detail ?? this.lastInvalidation ?? { message: GENERIC_INVALIDATED_MESSAGE };
    this.lastInvalidation = null;
    writeAuthInvalidatedReason({ ...resolved, username });
    if (this.onUnauthorized) {
      this.onUnauthorized();
      return;
    }
    globalThis.location.href = this.loginUrl();
  }

  private fail<T>(silent: boolean | undefined, message: string, code = -1): ApiResponseWithMeta<T> {
    if (!silent) showRequestErrorToast(message);
    return { code, message, data: null as unknown as T };
  }

  /**
   * 带鉴权的原生 fetch：注入 token，401 时刷新并重试一次，返回原生 Response 供流式 / 二进制读取。
   * 非 401 的失败状态码原样返回，由调用方按业务处理；网络错误与认证失效已处理完毕（含提示与跳转）时返回 null。
   */
  async fetchRaw(url: string, options: RequestInit & Pick<HttpRequestOptions, 'silent'> = {}): Promise<Response | null> {
    const { silent, ...fetchOptions } = options;
    const doFetch = () => fetch(`${this.baseUrl}${url}`, {
      ...fetchOptions,
      headers: this.getHeaders(fetchOptions.body, fetchOptions.headers),
    });

    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (!silent) showRequestErrorToast('网络请求失败，请检查网络连接');
      return null;
    }
    if (res.status !== 401) return res;

    // 先记下首个 401 的吊销原因（被挤下线 / 改密），refresh 确认失效后按它提示——比 refresh 自身的失效文案更具体
    const invalidation = await this.readInvalidation(res);
    const outcome = await this.tryRefreshToken();
    if (outcome === 'transient') {
      if (!silent) showRequestErrorToast('登录状态刷新暂时不可用，请稍后重试');
      return null;
    }
    if (outcome === 'invalid') {
      this.clearAuthAndRedirect(invalidation);
      return null;
    }
    try {
      res = await doFetch();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (!silent) showRequestErrorToast('网络请求失败，请检查网络连接');
      return null;
    }
    if (res.status === 401) {
      this.clearAuthAndRedirect(await this.readInvalidation(res));
      return null;
    }
    return res;
  }
  async request<T>(url: string, options: RequestInit & HttpRequestOptions = {}): Promise<ApiResponseWithMeta<T>> {
    const { silent, skipAuth, ...fetchOptions } = options;
    const doFetch = () => fetch(`${this.baseUrl}${url}`, {
      ...fetchOptions,
      headers: this.getHeaders(fetchOptions.body, fetchOptions.headers),
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
      // Try refresh token before giving up（先记下首个 401 的吊销原因，refresh 确认失效后按它提示）
      const invalidation = await this.readInvalidation(res);
      const outcome = await this.tryRefreshToken();
      if (outcome === 'refreshed') {
        // Retry original request with new token
        try {
          res = await doFetch();
        } catch {
          return this.fail<T>(silent, '网络请求失败，请检查网络连接');
        }
        if (res.status === 401) {
          this.clearAuthAndRedirect(await this.readInvalidation(res));
          abortSubmit('Unauthorized');
        }
      } else if (outcome === 'invalid') {
        this.clearAuthAndRedirect(invalidation);
        abortSubmit('Unauthorized');
      } else {
        // 瞬时故障（限流/维护/网络抖动）：保留凭证，本次请求按失败返回，用户稍后重试即可
        return this.fail<T>(silent, '登录状态刷新暂时不可用，请稍后重试', 401);
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
        // 附上响应头里的链路 ID：用户报障时可直接复制给管理员按链路排查
        showRequestErrorToast(data.message || '操作失败', res.headers.get('X-Request-Id'));
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
