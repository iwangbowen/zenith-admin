import { pgClient } from '../db';
import logger from './logger';

/**
 * 跨实例缓存失效总线：PostgreSQL LISTEN/NOTIFY，单频道 `cache_invalidate`。
 *
 * 数据库侧由触发器在事务**提交后**投递 `{ topic, key }`（topic = 表名，见 drizzle/0001_extensions.sql 的
 * `notify_cache_invalidate()`），任何写路径——业务代码、seed、迁移脚本、手工 SQL——都会被覆盖，
 * 不依赖调用方记得手动失效。进程内缓存通过 `onInvalidate(topic, handler)` 订阅。
 *
 * 可靠性语义：
 * - 监听使用 postgres.js 的专用连接（不占业务连接池），断线按退避自动重连；
 * - 断线期间的通知会丢失，因此每次（重）建立监听都会触发所有订阅者的**全量清空**（`onlisten` 回调）；
 * - 初次建立失败不阻断启动：转入降级模式并定时重试，各缓存退回自身 TTL 兜底，`/api/health` 暴露 `degraded`；
 * - 经 pgBouncer 事务池等中间件时 NOTIFY 不可透传 → 永久降级，新鲜度 = 各缓存 TTL。
 */
export const CACHE_INVALIDATE_CHANNEL = 'cache_invalidate';

export interface InvalidationMessage {
  readonly topic: string;
  readonly key?: string | null;
}

type Handler = (message: InvalidationMessage) => void;

const handlers = new Map<string, Set<Handler>>();
const resetHandlers = new Set<() => void>();

let state: 'idle' | 'listening' | 'degraded' = 'idle';
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

const RETRY_DELAY_MS = 60_000;

/** 订阅某个 topic（通常是表名）的失效通知；返回取消订阅函数 */
export function onInvalidate(topic: string, handler: Handler): () => void {
  const set = handlers.get(topic) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(topic, set);
  return () => { set.delete(handler); };
}

/** 监听（重）建立时的全量重置回调：订阅者应清空自身全部缓存 */
export function onInvalidationReset(handler: () => void): () => void {
  resetHandlers.add(handler);
  return () => { resetHandlers.delete(handler); };
}

/** 当前监听状态：`listening` 正常；`degraded` 未建立 / 已断开，缓存新鲜度退回 TTL；`idle` 尚未启动 */
export function invalidationBusState(): 'idle' | 'listening' | 'degraded' {
  return state;
}

/** 供测试与本地写路径直接派发（不经数据库） */
export function dispatchInvalidation(message: InvalidationMessage): void {
  for (const handler of handlers.get(message.topic) ?? []) {
    try {
      handler(message);
    } catch (err) {
      logger.error('[invalidation-bus] handler failed', { topic: message.topic, err });
    }
  }
}

function resetAll(): void {
  for (const handler of resetHandlers) {
    try {
      handler();
    } catch (err) {
      logger.error('[invalidation-bus] reset handler failed', err);
    }
  }
}

function handlePayload(payload: string): void {
  let message: InvalidationMessage;
  try {
    const parsed = JSON.parse(payload) as { topic?: unknown; key?: unknown };
    if (typeof parsed.topic !== 'string' || !parsed.topic) throw new Error('missing topic');
    message = { topic: parsed.topic, key: typeof parsed.key === 'string' ? parsed.key : null };
  } catch {
    logger.warn('[invalidation-bus] ignored malformed payload', { payload: payload.slice(0, 200) });
    return;
  }
  dispatchInvalidation(message);
}

async function listen(): Promise<void> {
  await pgClient.listen(
    CACHE_INVALIDATE_CHANNEL,
    handlePayload,
    () => {
      // 初次连接与每次重连都会进入：断线期间可能漏掉通知，全量清空一次
      const recovered = state === 'degraded';
      state = 'listening';
      resetAll();
      logger.info(recovered ? '[invalidation-bus] listener reconnected, caches cleared' : '[invalidation-bus] listening');
    },
  );
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void listen().catch((err) => {
      logger.warn(`[invalidation-bus] listen retry failed, staying degraded: ${err instanceof Error ? err.message : String(err)}`);
      scheduleRetry();
    });
  }, RETRY_DELAY_MS);
  retryTimer.unref?.();
}

/**
 * 启动监听。只能由进程入口（`src/index.ts`）调用一次——`app.ts` / 路由 / lib 顶层不得 import 本函数，
 * 否则 OpenAPI 预热 worker 等每个装配 app 的线程都会多开一条 LISTEN 连接。
 * 失败不抛出：记录 warn、进入降级并定时重试。
 */
export async function startInvalidationBus(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await listen();
  } catch (err) {
    state = 'degraded';
    logger.warn(`[invalidation-bus] listen failed, caches fall back to TTL: ${err instanceof Error ? err.message : String(err)}`);
    scheduleRetry();
  }
}

/** 仅供测试重置模块状态 */
export function resetInvalidationBusForTest(): void {
  handlers.clear();
  resetHandlers.clear();
  state = 'idle';
  started = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
