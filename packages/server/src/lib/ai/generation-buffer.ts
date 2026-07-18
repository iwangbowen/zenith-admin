import { randomUUID } from 'node:crypto';
import redis from '../redis';
import { config } from '../../config';
import logger from '../logger';

/**
 * AI 生成缓冲（SSE 断线续传）：
 * 生成过程与客户端连接解耦 —— 生成任务把每个 SSE 事件写入 Redis list，
 * 客户端（首次请求 / 刷新后恢复）从任意 offset 开始 tail 缓冲。
 *
 * Keys（TTL 10min）：
 * - {prefix}ai:gen:{genId}:events  — SSE 事件 JSON 列表
 * - {prefix}ai:gen:{genId}:meta    — hash { status: running|done, userId, conversationId }
 * - {prefix}ai:gen:{genId}:cancel  — 停止生成标记
 * - {prefix}ai:gen:active:{conversationId} — 该对话进行中的 genId（恢复入口）
 */

const PREFIX = `${config.redis.keyPrefix}ai:gen:`;
const TTL_SECONDS = 600;

export interface GenEvent {
  event: string;
  data: string;
}

const eventsKey = (genId: string) => `${PREFIX}${genId}:events`;
const metaKey = (genId: string) => `${PREFIX}${genId}:meta`;
const cancelKey = (genId: string) => `${PREFIX}${genId}:cancel`;
const activeKey = (conversationId: number) => `${PREFIX}active:${conversationId}`;

export function newGenerationId(): string {
  return randomUUID().replaceAll('-', '');
}

export async function initGeneration(genId: string, conversationId: number, userId: number): Promise<void> {
  await redis
    .multi()
    .hset(metaKey(genId), { status: 'running', userId: String(userId), conversationId: String(conversationId) })
    .expire(metaKey(genId), TTL_SECONDS)
    .set(activeKey(conversationId), genId, 'EX', TTL_SECONDS)
    .exec();
}

export async function pushGenEvent(genId: string, event: string, data: string): Promise<void> {
  try {
    await redis
      .multi()
      .rpush(eventsKey(genId), JSON.stringify({ event, data } satisfies GenEvent))
      .expire(eventsKey(genId), TTL_SECONDS)
      .exec();
  } catch (err) {
    logger.warn('[ai-gen] push event failed', err);
  }
}

export async function finishGeneration(genId: string, conversationId: number): Promise<void> {
  try {
    await redis
      .multi()
      .hset(metaKey(genId), 'status', 'done')
      .del(activeKey(conversationId))
      .exec();
  } catch (err) {
    logger.warn('[ai-gen] finish failed', err);
  }
}

export interface GenMeta {
  status: 'running' | 'done';
  userId: number;
  conversationId: number;
}

export async function getGenerationMeta(genId: string): Promise<GenMeta | null> {
  const meta = await redis.hgetall(metaKey(genId));
  if (!meta || !meta.status) return null;
  return {
    status: meta.status === 'done' ? 'done' : 'running',
    userId: Number(meta.userId),
    conversationId: Number(meta.conversationId),
  };
}

/** 读取 offset 起的缓冲事件 */
export async function readGenEvents(genId: string, offset: number): Promise<GenEvent[]> {
  const raw = await redis.lrange(eventsKey(genId), offset, -1);
  const events: GenEvent[] = [];
  for (const item of raw) {
    try {
      events.push(JSON.parse(item) as GenEvent);
    } catch { /* 忽略坏数据 */ }
  }
  return events;
}

/** 查询对话是否有进行中的生成（前端刷新后恢复流用） */
export async function getActiveGeneration(conversationId: number): Promise<string | null> {
  const genId = await redis.get(activeKey(conversationId));
  if (!genId) return null;
  const meta = await getGenerationMeta(genId);
  if (!meta || meta.status !== 'running') return null;
  return genId;
}

/** 请求停止生成（校验归属）。返回是否成功下发 */
export async function requestCancelGeneration(genId: string, userId: number): Promise<boolean> {
  const meta = await getGenerationMeta(genId);
  if (!meta || meta.userId !== userId) return false;
  await redis.set(cancelKey(genId), '1', 'EX', TTL_SECONDS);
  return true;
}

export async function isCancelRequested(genId: string): Promise<boolean> {
  return (await redis.exists(cancelKey(genId))) === 1;
}
