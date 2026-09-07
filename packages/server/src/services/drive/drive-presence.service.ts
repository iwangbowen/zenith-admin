import { inArray } from 'drizzle-orm';
import { DRIVE_PRESENCE_TTL_SECONDS, type DrivePresenceUser } from '@zenith/shared/drive';
import { db } from '../../db';
import { users } from '../../db/schema';
import { config } from '../../config';
import { currentUserId } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import redis from '../../lib/redis';
import { ensureNodeRole } from './drive-access.service';
import { ensureDriveNodeExists } from './drive-nodes.service';

/**
 * 节点在线状态：谁正在查看某个文件 / 文件夹。
 * Redis ZSET（score = 最近心跳毫秒时间戳）跨实例共享；前端每 25 秒心跳，60 秒无心跳即离开。
 * Redis 不可用时降级为空列表，不影响主流程。
 */

const KEY_PREFIX = `${config.redis.keyPrefix}drive:presence:`;

async function readPresence(nodeId: number, heartbeatUserId: number | null): Promise<DrivePresenceUser[]> {
  const key = `${KEY_PREFIX}${nodeId}`;
  const now = Date.now();
  let entries: string[];
  try {
    const pipeline = redis.pipeline();
    if (heartbeatUserId !== null) pipeline.zadd(key, now, String(heartbeatUserId));
    pipeline.zremrangebyscore(key, '-inf', String(now - DRIVE_PRESENCE_TTL_SECONDS * 1000));
    pipeline.zrange(key, '0', '-1', 'WITHSCORES');
    pipeline.expire(key, DRIVE_PRESENCE_TTL_SECONDS * 2);
    const results = await pipeline.exec();
    const range = results?.[heartbeatUserId !== null ? 2 : 1];
    entries = (range?.[1] as string[] | undefined) ?? [];
  } catch (err) {
    logger.warn({ err, nodeId }, 'drive: presence 读取失败，降级为空');
    return [];
  }
  const seen = new Map<number, number>();
  for (let i = 0; i < entries.length; i += 2) {
    const userId = Number(entries[i]);
    const score = Number(entries[i + 1]);
    if (Number.isInteger(userId) && userId > 0) seen.set(userId, score);
  }
  if (seen.size === 0) return [];
  const rows = await db.select({ id: users.id, nickname: users.nickname, username: users.username, avatar: users.avatar }).from(users)
    .where(inArray(users.id, [...seen.keys()]));
  return rows
    .map((r) => ({ userId: r.id, name: r.nickname || r.username, avatar: r.avatar ?? null, lastSeenAt: formatDateTime(new Date(seen.get(r.id) ?? now)) }))
    .sort((a, b) => a.userId - b.userId);
}

export async function listDriveNodePresence(nodeId: number): Promise<DrivePresenceUser[]> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  return readPresence(node.id, null);
}

export async function heartbeatDriveNodePresence(nodeId: number): Promise<DrivePresenceUser[]> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  return readPresence(node.id, currentUserId());
}

/** 用户离开节点时立即移除（关闭抽屉 / 切换目录），不等心跳过期 */
export async function leaveDriveNodePresence(nodeId: number): Promise<void> {
  try {
    await redis.zrem(`${KEY_PREFIX}${nodeId}`, String(currentUserId()));
  } catch (err) {
    logger.warn({ err, nodeId }, 'drive: presence 移除失败');
  }
}
