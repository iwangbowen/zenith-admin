/**
 * 全套测试共用的 Redis 替身。
 *
 * `lib/redis` 在模块加载时就 `client.connect()`——任何测试文件只要传递依赖
 * 摸到它（lib/permissions、middleware 栈、大量 service），就会向本机发起真实
 * TCP 连接：本地有 Redis 时全量跑一次曾产生 65 条真实连接（日志噪音 + 跨 worker
 * 共享真实状态的竞态面），CI 没有 Redis 时则留下 ioredis 重连定时器与 worker
 * 退出互相竞争。因此由 `src/test-setup.ts` 全局替换，单个测试文件如需断言
 * 调用细节，仍可用自己的 `vi.mock('../lib/redis', ...)` 覆盖（后注册者生效）。
 *
 * 用 Proxy 而非逐个列举方法：限流、幂等、会话、黑名单会用到十几个不同命令，
 * 逐个补是维护负担，漏一个就是一条 unhandled rejection。
 */
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

/**
 * 进程内 pub/sub 替身经纪：所有替身实例（含 duplicate() 出来的）共享一条总线，
 * 使「两个隔离加载的 ws-manager 模块实例 + 各自的 redis 替身」能像两个进程一样互相收到信封。
 * 挂在 globalThis 上是因为 vi.resetModules() 会重新执行本模块，模块级单例会被切断。
 */
const BROKER_KEY = '__zenithRedisStubBroker__';
type Broker = EventEmitter;
function getBroker(): Broker {
  const g = globalThis as unknown as Record<string, Broker | undefined>;
  if (!g[BROKER_KEY]) {
    const broker = new EventEmitter();
    broker.setMaxListeners(0); // 每个替身实例都挂一个监听器，数量随测试内的模块重置增长
    g[BROKER_KEY] = broker;
  }
  return g[BROKER_KEY];
}

/** multi()/pipeline() 的链式替身：任意命令返回自身，exec 归空 */
function createChainStub(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(target, prop: string) {
      if (prop === 'exec') return vi.fn().mockResolvedValue([]);
      if (prop === 'then') return undefined;
      if (!(prop in target)) target[prop] = vi.fn(() => createChainStub());
      return target[prop];
    },
  });
}

/** 一个「怎么调都返回 null」的 Redis 替身，覆盖已知命令的特殊返回形状 */
export function createRedisStub(): Record<string, unknown> {
  const broker = getBroker();
  const emitter = new EventEmitter();
  const subscribed = new Set<string>();
  // 订阅方收到经纪转发的消息：只转发自己订阅过的频道，与 ioredis 的 `message` 事件形状一致
  broker.on('message', (channel: string, message: string) => {
    if (subscribed.has(channel)) emitter.emit('message', channel, message);
  });

  const stub: Record<string, unknown> = {
    // hono-rate-limiter 的 RedisStore 在构造时立即 SCRIPT LOAD
    script: vi.fn().mockResolvedValue('stub-sha'),
    // 限流脚本约定返回 [窗口计数, 重置毫秒数]，兜底 null 会让解构处抛
    // "(intermediate value) is not iterable" 并打进日志
    eval: vi.fn().mockResolvedValue([1, 60_000]),
    evalsha: vi.fn().mockResolvedValue([1, 60_000]),
    keys: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(['0', []]),
    exists: vi.fn().mockResolvedValue(0),
    // 幂等中间件用 SET NX 判断是否首次请求，'OK' 表示放行
    set: vi.fn().mockResolvedValue('OK'),
    // pub/sub：publish 同步经经纪投给所有订阅了该频道的替身（含跨模块实例）
    publish: vi.fn(async (channel: string, message: string) => {
      broker.emit('message', channel, message);
      return 1;
    }),
    subscribe: vi.fn(async (...channels: string[]) => {
      for (const ch of channels) subscribed.add(ch);
      return subscribed.size;
    }),
    unsubscribe: vi.fn(async (...channels: string[]) => {
      for (const ch of channels) subscribed.delete(ch);
      return subscribed.size;
    }),
    duplicate: vi.fn(() => createRedisStub()),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => { emitter.on(event, fn); return stub; }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => { emitter.off(event, fn); return stub; }),
    once: vi.fn((event: string, fn: (...args: unknown[]) => void) => { emitter.once(event, fn); return stub; }),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
    // rate-limit 的 hit stats 走 multi().incr().expire().exec()
    pipeline: vi.fn(() => createChainStub()),
    multi: vi.fn(() => createChainStub()),
    status: 'ready',
  };

  return new Proxy(stub, {
    get(target, prop: string) {
      if (prop === 'then') return undefined; // 避免被当成 thenable
      if (!(prop in target)) target[prop] = vi.fn().mockResolvedValue(null);
      return target[prop];
    },
  });
}
