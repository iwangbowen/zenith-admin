import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { formatDateTime } from './datetime';
import { config } from '../config';
import logger from './logger';
import { assertSafeOutboundUrl, createSafeOutboundLookup } from './outbound-url';
import {
  resolveLevel,
  redactHeaders,
  headersToRecord,
  truncateBody,
  tryParseJson,
  safeRedactBodyForLog,
  writeHttpLogEntry,
  type HttpLogEntry,
} from './http-logger';import type { HttpLogLevel, HttpLogFormat } from '../config';
export interface HttpRequestOptions extends Omit<RequestInit, 'signal' | 'body'> {
  /** Base URL prefix; only applied when `url` is not absolute */
  baseURL?: string;
  /** Request body; objects are JSON-stringified */
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  /** Hard timeout in ms. 0 / undefined = no timeout (default) */
  timeout?: number;
  /** Retry attempts for 5xx and network errors (excluding aborts). Default 0 */
  retries?: number;
  /** Base delay (ms) for exponential backoff. Default 300 */
  retryDelay?: number;
  /** Caller-supplied proxy URL, e.g. 'http://127.0.0.1:7890'. Env vars are NOT read. */
  proxy?: string;
  /** Caller-supplied AbortSignal; combined with timeout signal */
  signal?: AbortSignal;
  /** Log truncation length for body in pino logs. Default 2048; set 0 to disable body logging */
  logBodyLimit?: number;
  /** Block localhost/private/reserved destinations and automatic redirects. */
  ssrfProtection?: boolean;
  /**
   * 覆盖本次请求的出站 HTTP 日志配置，优先级高于全局 config.httpLog.outgoing。
   *
   * @example
   * ```typescript
   * // 对这个单次调用开启全量日志（包含请求/响应 body）
   * await httpRequest('/api/webhook', { method: 'POST', body: payload, httpLog: { level: 'full' } });
   *
   * // 对包含敏感数据的调用完全禁用日志
   * await httpRequest('/api/payment', { method: 'POST', body: card, httpLog: { level: 'off' } });
   * ```
   */
  httpLog?: {
    /** 覆盖日志级别 */
    level?: HttpLogLevel;
    /** 覆盖输出格式 */
    format?: HttpLogFormat;
    /** 覆盖是否记录响应体 */
    logResponseBody?: boolean;
  };
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  url: string;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  /** Raw underlying Response */
  raw: Response;
}

const ssrfSafeDispatcher = new Agent({
  connect: { lookup: createSafeOutboundLookup() },
});

export class HttpClientError extends Error {
  readonly status: number;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly bodySnippet: string;
  readonly cause?: unknown;

  constructor(message: string, init: {
    status: number;
    url: string;
    headers?: Record<string, string>;
    bodySnippet?: string;
    cause?: unknown;
  }) {
    super(message);
    this.name = 'HttpClientError';
    this.status = init.status;
    this.url = init.url;
    this.headers = init.headers ?? {};
    this.bodySnippet = init.bodySnippet ?? '';
    this.cause = init.cause;
  }
}

// ── Circuit breaker (per host) ────────────────────────────────────────────────

interface BreakerState {
  failures: number;
  openedAt: number; // 0 = closed
}

const breakerThreshold = 5;
const breakerCooldownMs = 30_000;
const breakers = new Map<string, BreakerState>();

function breakerKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function breakerCheck(host: string): void {
  const s = breakers.get(host);
  if (!s || s.openedAt === 0) return;
  if (Date.now() - s.openedAt < breakerCooldownMs) {
    throw new HttpClientError(`Circuit open for host ${host}`, {
      status: 0,
      url: host,
    });
  }
  // half-open: reset
  breakers.set(host, { failures: 0, openedAt: 0 });
}

function breakerOnSuccess(host: string): void {
  const s = breakers.get(host);
  if (s) breakers.set(host, { failures: 0, openedAt: 0 });
}

function breakerOnFailure(host: string): void {
  const s = breakers.get(host) ?? { failures: 0, openedAt: 0 };
  s.failures += 1;
  if (s.failures >= breakerThreshold) s.openedAt = Date.now();
  breakers.set(host, s);
}

/** Test-only: clear breaker state */
export function resetHttpCircuitBreakers(): void {
  breakers.clear();
}

// ── Header redaction ──────────────────────────────────────────────────────────
// redactHeaders 已统一在 http-logger.ts 中实现，此处提供兼容包装

function headerEntries(h: HeadersInit): Iterable<[string, string]> {
  if (h instanceof Headers) return h.entries();
  if (Array.isArray(h)) return h as Iterable<[string, string]>;
  return Object.entries(h) as Iterable<[string, string]>;
}

function redactHeadersInit(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  const tmp: Record<string, string> = {};
  for (const [k, v] of headerEntries(h)) tmp[k] = String(v);
  // 复用 http-logger.ts 中统一的脱敏逻辑
  return redactHeaders(tmp);
}

function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max})` : s;
}

// ── Core ──────────────────────────────────────────────────────────────────────

function resolveUrl(url: string, baseURL?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseURL) return url;
  return `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

/** 出站日志中需脱敏的敏感 query 参数名（小写比较） */
const SENSITIVE_QUERY_KEYS = new Set([
  'access_token', 'secret', 'appsecret', 'app_secret', 'client_secret',
  'password', 'refresh_token', 'api_key', 'apikey', 'token', 'sign', 'signature',
]);

/** 脱敏 URL 中的敏感 query 值（用于日志），避免 access_token / appSecret 等写入应用日志 */
function redactUrl(rawUrl: string): string {
  const qIdx = rawUrl.indexOf('?');
  if (qIdx === -1) return rawUrl;
  const base = rawUrl.slice(0, qIdx);
  const parts = rawUrl.slice(qIdx + 1).split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) return pair;
    const key = pair.slice(0, eq);
    return SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? `${key}=***` : pair;
  });
  return `${base}?${parts.join('&')}`;
}

function normalizeBody(body: HttpRequestOptions['body'], headers: Headers): BodyInit | null | undefined {
  if (body === undefined || body === null) return body;
  if (typeof body === 'string') return body;
  if (
    body instanceof URLSearchParams
    || body instanceof ArrayBuffer
    || body instanceof Uint8Array
    || body instanceof Blob
    || body instanceof FormData
    || body instanceof ReadableStream
  ) {
    return body as BodyInit;
  }
  // object / array → JSON
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return JSON.stringify(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function performOnce(
  finalUrl: string,
  init: RequestInit,
  dispatcher: Dispatcher | undefined,
): Promise<Response> {
  // undici accepts `dispatcher` via the second arg even though TS Response init doesn't list it
  const extra = dispatcher ? { dispatcher } : {};
  return fetch(finalUrl, { ...init, ...extra });
}

export async function httpRequest(
  url: string,
  opts: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const {
    baseURL,
    body,
    timeout = 0,
    retries = 0,
    retryDelay = 300,
    proxy,
    signal: callerSignal,
    logBodyLimit = 2048,
    ssrfProtection = false,
    httpLog: callHttpLog,
    headers: headersInit,
    method = 'GET',
    ...rest
  } = opts;

  const finalUrl = resolveUrl(url, baseURL);
  if (ssrfProtection) await assertSafeOutboundUrl(finalUrl);
  const safeUrl = redactUrl(finalUrl);
  const host = breakerKey(finalUrl);
  breakerCheck(host);

  const headers = new Headers(headersInit);
  const reqBody = normalizeBody(body, headers);

  if (ssrfProtection && proxy) {
    throw new HttpClientError('SSRF-protected requests cannot use a proxy', { status: 0, url: safeUrl });
  }
  const dispatcher = proxy
    ? new ProxyAgent(proxy)
    : ssrfProtection
      ? ssrfSafeDispatcher
      : undefined;

  let lastErr: unknown;
  const maxAttempts = retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = timeout > 0 ? setTimeout(() => controller.abort(new Error('Request timeout')), timeout) : null;
    const onCallerAbort = (): void => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const startedAt = Date.now();
    const logCtx = {
      method,
      url: safeUrl,
      headers: redactHeadersInit(headersInit),
      attempt,
      proxy: proxy ? new URL(proxy).host : undefined,
    };
    logger.debug('[http] request', logCtx);

    // ── 出站日志：请求阶段 ────────────────────────────────────────────────
    const outCfg = config.httpLog.outgoing;
    // 优先级：per-call 覆盖 > 方法级覆盖 > 全局默认
    const outLevel = callHttpLog?.level ?? resolveLevel(method, outCfg.level, outCfg.methods);
    const outFormat = callHttpLog?.format ?? outCfg.format;
    const outLogResponseBody = callHttpLog?.logResponseBody ?? outCfg.logResponseBody;
    const outSeparateFile = outCfg.separateFile;
    const shouldLogOut = outCfg.enabled && outLevel !== 'off';

    if (shouldLogOut && outLevel !== 'access') {
      const reqEntry: HttpLogEntry = {
        correlation: `out-${Date.now()}-${attempt}`,
        direction: 'outgoing',
        phase: 'request',
        method,
        url: safeUrl,
        requestHeaders: (outLevel === 'headers' || outLevel === 'full')
          ? redactHeaders(logCtx.headers)
          : undefined,
        requestBody: (outLevel === 'body' || outLevel === 'full') && body !== undefined && body !== null
          ? safeRedactBodyForLog(body, outCfg.maxBodyBytes)
          : undefined,
        attempt: attempt > 1 ? attempt : undefined,
        timestamp: formatDateTime(new Date()),
      };
      writeHttpLogEntry(reqEntry, outFormat, outSeparateFile);
    }

    try {
      const resp = await performOnce(finalUrl, {
        method,
        headers,
        body: reqBody,
        signal: controller.signal,
        ...rest,
        ...(ssrfProtection ? { redirect: 'error' as const } : {}),
      }, dispatcher);
      const elapsed = Date.now() - startedAt;

      if (resp.status >= 500 && attempt < maxAttempts) {
        const snippet = truncate(await resp.clone().text().catch(() => ''), logBodyLimit);
        logger.warn('[http] retry on 5xx', { ...logCtx, status: resp.status, ms: elapsed, body: snippet });
        breakerOnFailure(host);
        await sleep(retryDelay * 2 ** (attempt - 1));
        continue;
      }

      logger.info('[http] response', { ...logCtx, status: resp.status, ms: elapsed });
      if (resp.ok) breakerOnSuccess(host);
      else breakerOnFailure(host);

      // ── 出站日志：响应阶段 ──────────────────────────────────────────────
      if (shouldLogOut) {
        let responseBody: unknown;
        if (outLogResponseBody && (outLevel === 'body' || outLevel === 'full')) {
          const ct = resp.headers.get('content-type') ?? '';
          if (ct.includes('application/json') || ct.includes('text/')) {
            try {
              const text = await resp.clone().text();
              responseBody = truncateBody(tryParseJson(text), outCfg.maxBodyBytes);
            } catch {
              // 读取失败，跳过
            }
          }
        }
        const resEntry: HttpLogEntry = {
          correlation: `out-${startedAt}-${attempt}`,
          direction: 'outgoing',
          phase: 'response',
          method,
          url: safeUrl,
          statusCode: resp.status,
          durationMs: elapsed,
          responseHeaders: (outLevel === 'headers' || outLevel === 'full')
            ? redactHeaders(headersToRecord(resp.headers))
            : undefined,
          responseBody,
          attempt: attempt > 1 ? attempt : undefined,
          timestamp: formatDateTime(new Date()),
        };
        writeHttpLogEntry(resEntry, outFormat, outSeparateFile);
      }

      return wrapResponse(resp, finalUrl);
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      lastErr = err;
      logger.warn('[http] error', { ...logCtx, ms: elapsed, err: (err as Error).message });
      // ── 出站日志：错误阶段 ──────────────────────────────────────────────
      if (shouldLogOut) {
        const errEntry: HttpLogEntry = {
          correlation: `out-${startedAt}-${attempt}`,
          direction: 'outgoing',
          phase: 'response',
          method,
          url: safeUrl,
          durationMs: elapsed,
          attempt: attempt > 1 ? attempt : undefined,
          error: (err as Error).message,
          timestamp: formatDateTime(new Date()),
        };
        writeHttpLogEntry(errEntry, outFormat, outSeparateFile);
      }
      breakerOnFailure(host);
      const aborted = (err as Error).name === 'AbortError' || callerSignal?.aborted;
      if (aborted || attempt >= maxAttempts) break;
      await sleep(retryDelay * 2 ** (attempt - 1));
    } finally {
      if (timer) clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }

  throw new HttpClientError(`HTTP request failed: ${(lastErr as Error)?.message ?? 'unknown'}`, {
    status: 0,
    url: safeUrl,
    cause: lastErr,
  });
}

function wrapResponse(resp: Response, url: string): HttpResponse {
  return {
    status: resp.status,
    ok: resp.ok,
    headers: resp.headers,
    url,
    text: () => resp.text(),
    json: <T,>() => resp.json() as Promise<T>,
    arrayBuffer: () => resp.arrayBuffer(),
    raw: resp,
  };
}

// ── Convenience helpers ───────────────────────────────────────────────────────

export function httpGet(url: string, opts?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse> {
  return httpRequest(url, { ...opts, method: 'GET' });
}

export function httpPost(url: string, body?: HttpRequestOptions['body'], opts?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse> {
  return httpRequest(url, { ...opts, method: 'POST', body });
}

export function httpPut(url: string, body?: HttpRequestOptions['body'], opts?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse> {
  return httpRequest(url, { ...opts, method: 'PUT', body });
}

export function httpPatch(url: string, body?: HttpRequestOptions['body'], opts?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse> {
  return httpRequest(url, { ...opts, method: 'PATCH', body });
}

export function httpDelete(url: string, opts?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse> {
  return httpRequest(url, { ...opts, method: 'DELETE' });
}
