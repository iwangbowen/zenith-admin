/**
 * CMS 内容编辑锁（Redis 心跳锁，防多人同时编辑相互覆盖）。
 *
 * 打开编辑页 → acquire（NX 抢锁或同人续期）；编辑期间前端每 30s 心跳续期；
 * 离开页面 → release（仅持有人可释放）。锁 TTL 120s，心跳中断后自动过期。
 * 锁是「软锁」：仅用于提示他人正在编辑，不强制阻断保存（保存冲突由乐观锁兜底）。
 */
import { eq } from 'drizzle-orm';
import { config } from '../../config';
import redis from '../../lib/redis';
import { db } from '../../db';
import { users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { ensureCmsContentExists } from './cms-contents.service';
import { assertSiteAccess } from './cms-sites.service';
import { assertChannelAccess } from './cms-channels.service';

const LOCK_PREFIX = `${config.redis.keyPrefix}cms:edit-lock:`;
const LOCK_TTL_SECONDS = 120;

export interface CmsEditLockHolder {
  userId: number;
  nickname: string;
  lockedAt: string;
}

export interface CmsEditLockResult {
  /** true = 当前用户持有锁（新抢占或续期成功） */
  acquired: boolean;
  /** 他人持锁时返回持有人信息 */
  holder: CmsEditLockHolder | null;
}

function lockKey(contentId: number): string {
  return `${LOCK_PREFIX}${contentId}`;
}

function parseHolder(raw: string | null): CmsEditLockHolder | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CmsEditLockHolder;
    return typeof parsed.userId === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

async function currentNickname(): Promise<string> {
  const user = currentUser();
  const [row] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, user.userId)).limit(1);
  return row?.nickname || user.username;
}

/** 抢占/续期编辑锁（同一用户重复调用即心跳续期） */
export async function acquireContentEditLock(contentId: number): Promise<CmsEditLockResult> {
  const row = await ensureCmsContentExists(contentId);
  await assertSiteAccess(row.siteId);
  await assertChannelAccess(row.channelId);
  const user = currentUser();
  const key = lockKey(contentId);
  const value = JSON.stringify({
    userId: user.userId,
    nickname: await currentNickname(),
    lockedAt: formatDateTime(new Date()),
  } satisfies CmsEditLockHolder);
  const created = await redis.set(key, value, 'EX', LOCK_TTL_SECONDS, 'NX');
  if (created) return { acquired: true, holder: null };
  const holder = parseHolder(await redis.get(key));
  if (!holder) {
    // 锁值损坏/恰好过期：直接覆盖抢占
    await redis.set(key, value, 'EX', LOCK_TTL_SECONDS);
    return { acquired: true, holder: null };
  }
  if (holder.userId === user.userId) {
    await redis.expire(key, LOCK_TTL_SECONDS);
    return { acquired: true, holder: null };
  }
  return { acquired: false, holder };
}

/** 释放编辑锁（仅持有人可释放，他人调用为空操作） */
export async function releaseContentEditLock(contentId: number): Promise<void> {
  const row = await ensureCmsContentExists(contentId);
  await assertSiteAccess(row.siteId);
  await assertChannelAccess(row.channelId);
  const user = currentUser();
  const key = lockKey(contentId);
  const holder = parseHolder(await redis.get(key));
  if (holder && holder.userId === user.userId) {
    await redis.del(key);
  }
}
