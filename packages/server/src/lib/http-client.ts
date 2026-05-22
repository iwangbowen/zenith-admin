import { ProxyAgent, type Dispatcher } from 'undici';
import logger from './logger';

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

const REDACT_KEYS = /^(authorization|cookie|set-cookie|proxy-authorization|x-auth-token)$/i;
const REDACT_VALUE_KEYS = /(token|secret|password|api[_-]?key)/i;

function headerEntries(h: HeadersInit): Iterable<[string, string]> {
  if (h instanceof Headers) return h.entries();
  if (Array.isArray(h)) return h as Iterable<[string, string]>;
  return Object.entries(h) as Iterable<[string, string]>;
}

function redactHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of headerEntries(h)) {
    if (REDACT_KEYS.test(k) || REDACT_VALUE_KEYS.test(k)) {
      out[k] = '***';
    } else {
      out[k] = String(v);
    }
  }
  return out;
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

function normalizeBody(body: HttpRequestOptions['body'], headers: Headers): BodyInit | null | undefined {
  if (body === undefined || body === null) return body as null | undefined;
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
    headers: headersInit,
    method = 'GET',
    ...rest
  } = opts;

  const finalUrl = resolveUrl(url, baseURL);
  const host = breakerKey(finalUrl);
  breakerCheck(host);

  const headers = new Headers(headersInit);
  const reqBody = normalizeBody(body, headers);

  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

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
      url: finalUrl,
      headers: redactHeaders(headersInit),
      attempt,
      proxy: proxy ? new URL(proxy).host : undefined,
    };
    logger.debug('[http] request', logCtx);

    try {
      const resp = await performOnce(finalUrl, {
        method,
        headers,
        body: reqBody,
        signal: controller.signal,
        ...rest,
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

      return wrapResponse(resp, finalUrl);
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      lastErr = err;
      logger.warn('[http] error', { ...logCtx, ms: elapsed, err: (err as Error).message });
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
    url: finalUrl,
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
