/**
 * WebSocket 跨进程 fan-out：Redis pub/sub 单频道。
 *
 * `ws-manager` / IoT 网关的连接表都是进程内存，推送在哪个进程发生就只能到达该进程持有的 socket。
 * 多 api 副本、以及 api / worker 角色拆分后（作业进度、站内信、工作流通知全部在 worker 进程产生），
 * 发出方与持有连接的进程通常不是同一个。所有推送因此改为「本地投递 + 发布信封」，
 * 每个持有连接的进程订阅本频道，收到后投给自己的本地 socket；发布方自己的信封按 `from` 跳过。
 *
 * 可靠性语义（与失效总线一致，都是提示性消息）：
 * - at-most-once：订阅断线期间的信封丢失；客户端重连后按需 refetch，不做补偿；
 * - 发布走共享客户端（自动流水线），订阅用独立连接（SUBSCRIBE 会让连接进入订阅模式）；
 * - ioredis 重连后自动重订阅；首次订阅失败由 `ready` 事件兜底重试，不阻断启动。
 *
 * 为什么不用 PG NOTIFY：载荷上限 8000 字节（聊天消息可超），且推送流量不应压在数据库上。
 */
import type Redis from 'ioredis';
import type { WsMessage } from '@zenith/shared/platform';
import { config } from '../config';
import logger from './logger';
import { PROCESS_ID } from './process-identity';
import redis from './redis';

export const WS_FANOUT_CHANNEL = `${config.redis.keyPrefix}ws:fanout`;

/** 设备帧跨节点送达后由持有连接的节点回写的状态（源节点无法得知是否送达） */
export type DeviceDeliveryAck =
  | { kind: 'command'; commandId: number }
  | { kind: 'ota'; taskId: number; deviceId: number };

export type WsFanoutEnvelope =
  | { kind: 'user'; target: number; message: WsMessage }
  | { kind: 'users'; targets: number[]; message: WsMessage }
  | { kind: 'token'; target: string; message: WsMessage }
  | { kind: 'broadcast'; message: WsMessage }
  | { kind: 'closeToken'; target: string; reason: string }
  | { kind: 'closeUser'; target: number; reason: string }
  | { kind: 'device'; target: string; frame: string; ack?: DeviceDeliveryAck }
  /** 发送方节点的本地上下线增量（不是合并视图）：接收方据此更新对该节点的镜像 */
  | { kind: 'presence'; changes: Array<{ userId: number; online: boolean; lastSeen: number | null }> }
  /** 发送方节点的本地在线全量快照：周期发送，让镜像在丢包 / 重启后自愈 */
  | { kind: 'presenceSnapshot'; online: number[]; lastSeen: Array<[userId: number, lastSeenMs: number]> };

export type WsFanoutKind = WsFanoutEnvelope['kind'];

type WireEnvelope = WsFanoutEnvelope & { v: 1; from: string };

/** 处理器收到的信封带发送方进程标识（presence 镜像按节点归档） */
type FanoutHandler<K extends WsFanoutKind> = (envelope: Extract<WsFanoutEnvelope, { kind: K }> & { from: string }) => void | Promise<void>;
type AnyFanoutHandler = (envelope: WsFanoutEnvelope & { from: string }) => void | Promise<void>;

const handlers = new Map<WsFanoutKind, AnyFanoutHandler>();

const counters = { published: 0, publishFailed: 0, delivered: 0, dropped: 0 };

let subscriber: Redis | null = null;
let state: 'idle' | 'subscribed' | 'degraded' = 'idle';
let lastWarnAt = 0;

/** Redis 不可用时每次发布都会失败；告警按分钟节流，避免刷屏 */
function warnThrottled(message: string, err: unknown): void {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  logger.warn(`[ws-fanout] ${message}`, err);
}

/** 登记某类信封的本地投递函数；同一 kind 只允许一个处理器（后注册者覆盖，返回取消函数） */
export function onWsFanout<K extends WsFanoutKind>(kind: K, handler: FanoutHandler<K>): () => void {
  // 处理器按 kind 收窄了入参；派发端已按 wire.kind 查表，这里的放宽只是类型层面的
  const wrapped = handler as unknown as AnyFanoutHandler;
  handlers.set(kind, wrapped);
  return () => {
    if (handlers.get(kind) === wrapped) handlers.delete(kind);
  };
}

/** 发布一封信封（fire-and-forget）；调用方已完成本地投递 */
export function publishWsFanout(envelope: WsFanoutEnvelope): void {
  const wire: WireEnvelope = { v: 1, from: PROCESS_ID, ...envelope };
  redis.publish(WS_FANOUT_CHANNEL, JSON.stringify(wire)).then(
    () => { counters.published += 1; },
    (err: unknown) => {
      counters.publishFailed += 1;
      warnThrottled('发布失败，其他进程持有的连接收不到本次推送', err);
    },
  );
}

/** 供测试与本地回环直接派发（不经 Redis） */
export async function dispatchWsFanout(raw: string): Promise<void> {
  let wire: WireEnvelope;
  try {
    wire = JSON.parse(raw) as WireEnvelope;
  } catch {
    counters.dropped += 1;
    logger.warn('[ws-fanout] ignored malformed envelope', { raw: raw.slice(0, 200) });
    return;
  }
  if (wire.v !== 1 || typeof wire.from !== 'string') {
    counters.dropped += 1;
    return;
  }
  if (wire.from === PROCESS_ID) return; // 自己发出的信封已本地投递
  const handler = handlers.get(wire.kind);
  if (!handler) {
    counters.dropped += 1;
    return;
  }
  try {
    await handler(wire);
    counters.delivered += 1;
  } catch (err) {
    counters.dropped += 1;
    logger.error('[ws-fanout] handler failed', { kind: wire.kind, err });
  }
}

/**
 * 建立订阅（持有 WS 连接的进程调用，即 api 角色）。
 * 幂等；连接失败不抛出——ioredis 按 retryStrategy 重连，`ready` 时补订阅。
 */
export async function startWsFanoutSubscriber(): Promise<void> {
  if (subscriber) return;
  // 订阅连接不能复用共享客户端：SUBSCRIBE 后连接只接受订阅类命令，且与自动流水线不兼容
  const sub = redis.duplicate({ enableAutoPipelining: false, lazyConnect: true });
  subscriber = sub;
  sub.on('error', (err: Error) => {
    state = 'degraded';
    warnThrottled('订阅连接错误，跨进程推送暂时不可达', err);
  });
  sub.on('message', (channel: string, raw: string) => {
    if (channel !== WS_FANOUT_CHANNEL) return;
    void dispatchWsFanout(raw);
  });
  const subscribe = async () => {
    await sub.subscribe(WS_FANOUT_CHANNEL);
    state = 'subscribed';
  };
  // 每次（重）连就绪都补一次订阅：首次失败进入离线队列被拒后，重连不会自动补上
  sub.on('ready', () => {
    void subscribe().catch((err: unknown) => warnThrottled('重订阅失败', err));
  });
  try {
    await sub.connect();
    await subscribe();
  } catch (err) {
    state = 'degraded';
    logger.warn('[ws-fanout] 首次订阅失败，进入降级并等待重连', err);
  }
}

export async function stopWsFanoutSubscriber(): Promise<void> {
  const sub = subscriber;
  subscriber = null;
  state = 'idle';
  if (!sub) return;
  try {
    await sub.quit();
  } catch {
    sub.disconnect();
  }
}

/** 当前订阅状态：`subscribed` 正常；`degraded` 未建立 / 已断开；`idle` 本进程不持有连接（worker）或尚未启动 */
export function wsFanoutState(): 'idle' | 'subscribed' | 'degraded' {
  return state;
}

export function getWsFanoutCounters(): Readonly<typeof counters> {
  return counters;
}

/** 仅测试：清空处理器与计数（模块级状态在 vi.resetModules 之外复用时使用） */
export function resetWsFanoutForTest(): void {
  handlers.clear();
  counters.published = 0;
  counters.publishFailed = 0;
  counters.delivered = 0;
  counters.dropped = 0;
  subscriber = null;
  state = 'idle';
  lastWarnAt = 0;
}
