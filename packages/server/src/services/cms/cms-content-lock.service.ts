import { requireRow } from '../../lib/db-assert';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContents } from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { assertChannelAccess } from './cms-channels.service';
import { logContentOp } from './cms-content-op-logs.service';
import { assertSiteAccess } from './cms-sites.service';

function lockedMessage(row: Pick<CmsContentRow, 'id' | 'lockReason'>): string {
  return `内容 #${row.id} 已被持久锁定${row.lockReason ? `：${row.lockReason}` : ''}`;
}

export function assertCmsContentUnlocked(
  row: Pick<CmsContentRow, 'id' | 'lockedAt' | 'lockReason'>,
): void {
  if (row.lockedAt) throw new HTTPException(423, { message: lockedMessage(row) });
}

export async function assertCmsContentsUnlocked(ids: number[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const [locked] = await db.select({
    id: cmsContents.id,
    lockedAt: cmsContents.lockedAt,
    lockReason: cmsContents.lockReason,
  }).from(cmsContents).where(and(
    inArray(cmsContents.id, unique),
    isNotNull(cmsContents.lockedAt),
  )).limit(1);
  if (locked) throw new HTTPException(423, { message: lockedMessage(locked) });
}

/** 映射副本锁定时，来源正文也不可变更，避免锁定页面内容随来源静默漂移。 */
export async function assertNoLockedCmsMappedCopies(sourceIds: number | number[]): Promise<void> {
  const unique = [...new Set(Array.isArray(sourceIds) ? sourceIds : [sourceIds])];
  if (unique.length === 0) return;
  const [locked] = await db.select({
    id: cmsContents.id,
    lockedAt: cmsContents.lockedAt,
    lockReason: cmsContents.lockReason,
  }).from(cmsContents).where(and(
    inArray(cmsContents.mappingSourceId, unique),
    isNotNull(cmsContents.lockedAt),
  )).limit(1);
  if (locked) throw new HTTPException(423, { message: lockedMessage(locked) });
}

export async function lockCmsContent(id: number, reason: string) {
  const current = requireRow(await db.query.cmsContents.findFirst({ where: eq(cmsContents.id, id) }), '内容不存在');
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(current.channelId);
  if (current.lockedAt) throw new HTTPException(409, { message: lockedMessage(current) });
  const user = currentUser();
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(cmsContents).set({
      lockedAt: now,
      lockedBy: user.userId,
      lockReason: reason.trim(),
      scheduledAt: null,
      version: sql`${cmsContents.version} + 1`,
    }).where(and(eq(cmsContents.id, id), isNull(cmsContents.lockedAt))).returning();
    const locked = requireRow(row, '内容锁状态已变化，请刷新后重试', 409);
    await logContentOp(tx, id, 'locked', reason.trim());
    return locked;
  });
  return {
    lockedAt: formatDateTime(updated.lockedAt!),
    lockedBy: updated.lockedBy,
    lockReason: updated.lockReason,
  };
}

export async function unlockCmsContent(id: number) {
  const current = requireRow(await db.query.cmsContents.findFirst({ where: eq(cmsContents.id, id) }), '内容不存在');
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(current.channelId);
  if (!current.lockedAt) return;
  await db.transaction(async (tx) => {
    const [row] = await tx.update(cmsContents).set({
      lockedAt: null,
      lockedBy: null,
      lockReason: null,
      version: sql`${cmsContents.version} + 1`,
    }).where(and(eq(cmsContents.id, id), isNotNull(cmsContents.lockedAt))).returning({ id: cmsContents.id });
    requireRow(row, '内容锁状态已变化，请刷新后重试', 409);
    await logContentOp(tx, id, 'unlocked');
  });
}
