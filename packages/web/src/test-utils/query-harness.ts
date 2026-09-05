/**
 * 缓存一致性观测工具（S0 度量基线）
 *
 * 用途：为「收敛 mutation 失效粒度」提供可证伪的验收手段。
 *
 * 为什么需要它：`invalidateQueries` 默认只立即重拉**活跃**查询
 * （query-core `queryClient.js`：`type: refetchType ?? type ?? 'active'`），
 * 未挂载的查询只是被标脏。因此「失效了哪个 key」既不等于「发了几个请求」，
 * 也不等于「用户看到的数据是否正确」。
 *
 * 断言必须落在可观测行为上：
 *  - 这次动作实际发了几个请求、都打到哪些 URL（{@link ApiRecorder}）
 *  - 哪些查询真的重新进入了 fetching（{@link observeFetches}）
 *  - 动作后缓存里的数据与新鲜度（{@link getCacheEntry} / {@link isFresh}）
 *
 * **禁止**只 spy「调用了 invalidateQueries(someKey)」：`xxxKeys.all` 是
 * `xxxKeys.detail(id)` 的前缀，两者同时调用时后者只是空转，这类 spy 断言
 * 在「冗余现状」与「收敛后被改坏」两种情况下都会通过。
 */
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Query, QueryKey } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// 请求录制器
// ────────────────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RecordedCall {
  method: HttpMethod;
  url: string;
  /** 请求体（GET 无） */
  body?: unknown;
  /** 请求选项里的请求头（小写头名 → 值；未传时无此键） */
  headers?: Record<string, string>;
}

type Responder = (call: RecordedCall) => unknown;

interface Stub {
  method: HttpMethod | '*';
  match: (url: string) => boolean;
  responder: Responder;
}

/**
 * 记录所有经 `@/utils/request` 发出的调用，并按注册的桩返回数据。
 *
 * 统一响应外壳由本录制器补齐（`{ code: 0, message: 'success', data }`），
 * 桩函数只需返回 `data` 部分；域 hooks 里的 `unwrap` 会正常解包。
 */
export class ApiRecorder {
  readonly calls: RecordedCall[] = [];
  private stubs: Stub[] = [];

  /**
   * 注册一个响应桩。`url` 传字符串时按「完整相等或去掉 query 后相等」匹配，
   * 传正则时按正则匹配；后注册的同名桩覆盖先注册的。
   */
  on(method: HttpMethod | '*', url: string | RegExp, responder: Responder | unknown): this {
    const match =
      url instanceof RegExp
        ? (u: string) => url.test(u)
        : (u: string) => u === url || u.split('?')[0] === url;
    const fn: Responder = typeof responder === 'function' ? (responder as Responder) : () => responder;
    this.stubs.unshift({ method, match, responder: fn });
    return this;
  }

  /** 供 `vi.mock('@/utils/request')` 的工厂调用；返回统一响应外壳 */
  dispatch(method: HttpMethod, url: string, body?: unknown, opts?: { headers?: HeadersInit }): Promise<unknown> {
    const headers = opts?.headers ? Object.fromEntries(new Headers(opts.headers)) : undefined;
    const call: RecordedCall = {
      method,
      url,
      ...(body === undefined ? {} : { body }),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    };
    this.calls.push(call);
    const stub = this.stubs.find((s) => (s.method === '*' || s.method === method) && s.match(url));
    if (!stub) {
      return Promise.reject(
        new Error(
          `[ApiRecorder] 未注册响应桩：${method} ${url}（已注册 ${this.stubs.length} 条桩，已记录 ${this.calls.length} 次调用）`,
        ),
      );
    }
    return Promise.resolve({ code: 0, message: 'success', data: stub.responder(call) });
  }

  /** 命中指定 URL 的调用次数；`url` 省略时统计该方法的全部调用 */
  countOf(method: HttpMethod, url?: string | RegExp): number {
    return this.calls.filter((c) => {
      if (c.method !== method) return false;
      if (url === undefined) return true;
      return url instanceof RegExp ? url.test(c.url) : c.url === url || c.url.split('?')[0] === url;
    }).length;
  }

  /** 已记录的 URL 列表（按发生顺序，含 query string） */
  urls(method?: HttpMethod): string[] {
    return this.calls.filter((c) => method === undefined || c.method === method).map((c) => c.url);
  }

  /** 只清空调用记录，保留已注册的响应桩（用于「动作前重置、动作后断言」） */
  resetCalls(): void {
    this.calls.length = 0;
  }

  /** 清空调用记录与响应桩 */
  reset(): void {
    this.calls.length = 0;
    this.stubs = [];
  }
}

/**
 * 生成 `vi.mock('@/utils/request')` 工厂所需的 request 替身。
 *
 * 用法（`getRecorder` 必须是 thunk —— vi.mock 工厂先于模块顶层 const 求值）：
 * ```ts
 * const api = new ApiRecorder();
 * vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));
 * ```
 */
export function createRequestMock(getRecorder: () => ApiRecorder) {
  type Opts = { headers?: HeadersInit };
  return {
    get: (url: string, opts?: Opts) => getRecorder().dispatch('GET', url, undefined, opts),
    post: (url: string, body?: unknown, opts?: Opts) => getRecorder().dispatch('POST', url, body, opts),
    put: (url: string, body?: unknown, opts?: Opts) => getRecorder().dispatch('PUT', url, body, opts),
    patch: (url: string, body?: unknown, opts?: Opts) => getRecorder().dispatch('PATCH', url, body, opts),
    delete: (url: string, body?: unknown, opts?: Opts) => getRecorder().dispatch('DELETE', url, body, opts),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// QueryClient 与 fetch 观测
// ────────────────────────────────────────────────────────────────────────────

/**
 * 构造与生产一致的测试 QueryClient。
 *
 * 保持 `staleTime: 30_000`（同 `lib/query.ts`）是刻意的：只有 staleTime 生效时，
 * 「未被失效的查询应保持 fresh、不重拉」这类断言才有意义。
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache(),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
}

export function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

export interface FetchObserver {
  /** 每次有查询进入 fetching 就记一条（同一 key 多次会重复记录） */
  readonly events: QueryKey[];
  /** 进入 fetching 的总次数 —— 这是「无谓重拉」的核心指标 */
  readonly count: number;
  /** 去重后的 key 序列化列表，便于直观断言 */
  keys(): string[];
  /** 某个 key（前缀匹配）进入 fetching 的次数 */
  countOf(prefix: QueryKey): number;
  reset(): void;
  stop(): void;
}

/**
 * 统计「实际进入 fetching」的查询。
 *
 * query-core 在真正发起请求时 dispatch `{ type: 'fetch' }`
 * （`query.js`：`this.#dispatch({ type: 'fetch', ... })`），
 * 因此监听 cache 的 `updated` 事件即可精确捕获重拉，而不受「被标脏但未重拉」干扰。
 */
export function observeFetches(client: QueryClient): FetchObserver {
  const events: QueryKey[] = [];
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'fetch') {
      events.push(event.query.queryKey);
    }
  });

  return {
    events,
    get count() {
      return events.length;
    },
    keys: () => [...new Set(events.map((k) => JSON.stringify(k)))],
    countOf: (prefix) => events.filter((k) => matchesPrefix(k, prefix)).length,
    reset: () => {
      events.length = 0;
    },
    stop: unsubscribe,
  };
}

function matchesPrefix(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((seg, i) => JSON.stringify(seg) === JSON.stringify(key[i]));
}

// ────────────────────────────────────────────────────────────────────────────
// 缓存断言辅助
// ────────────────────────────────────────────────────────────────────────────

function findQuery(client: QueryClient, key: QueryKey): Query | undefined {
  return client
    .getQueryCache()
    .getAll()
    .find((q) => JSON.stringify(q.queryKey) === JSON.stringify(key));
}

/** 缓存条目是否存在（删除后应为 false） */
export function hasCacheEntry(client: QueryClient, key: QueryKey): boolean {
  return findQuery(client, key) !== undefined;
}

/** 读取缓存数据（不存在返回 undefined） */
export function getCacheEntry<T>(client: QueryClient, key: QueryKey): T | undefined {
  return client.getQueryData<T>(key);
}

/**
 * 是否仍然新鲜（未被失效且未超过 staleTime）。
 * 用于断言「无关的 lookup 不应被 mutation 波及」。
 */
export function isFresh(client: QueryClient, key: QueryKey): boolean {
  const query = findQuery(client, key);
  return query !== undefined && !query.isStale();
}

/** 是否被显式失效（`invalidateQueries` 标记） */
export function isInvalidated(client: QueryClient, key: QueryKey): boolean {
  return findQuery(client, key)?.state.isInvalidated ?? false;
}
