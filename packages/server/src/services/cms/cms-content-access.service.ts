import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContents, cmsContentWorkingCopies } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { currentCmsOpenApiAccess, currentUserOrNull } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { buildWhere } from '../../lib/where-helpers';
import { assertSiteAccess } from './cms-sites.service';
import { assertChannelAccess } from './cms-channels.service';

/** One object policy for detail, mutations, revisions, preview and batch callers. */
export async function cmsContentDataScope(executor: DbExecutor = db): Promise<SQL | undefined> {
  if (currentCmsOpenApiAccess()) return undefined;
  const user = currentUserOrNull();
  if (!user) throw new HTTPException(401, { message: '需要登录后访问内容' });
  return getDataScopeCondition({ executor, currentUserId: user.userId, deptColumn: cmsContents.deptId, ownerColumn: cmsContents.createdBy });
}

export async function requireCmsContentAccess(id: number, executor: DbExecutor = db) {
  const scope = await cmsContentDataScope(executor);
  const [row] = await executor.select().from(cmsContents).where(buildWhere(eq(cmsContents.id, id), scope)).limit(1);
  if (!row) throw new HTTPException(404, { message: '内容不存在或无权访问' });
  await assertSiteAccess(row.siteId);
  await assertChannelAccess(row.channelId);
  const [working] = await executor.select({ channelId: sql<number>`(${cmsContentWorkingCopies.snapshot}->>'channelId')::integer` }).from(cmsContentWorkingCopies).where(eq(cmsContentWorkingCopies.contentId, id)).limit(1);
  if (working && working.channelId !== row.channelId) await assertChannelAccess(working.channelId);
  return row;
}

export async function requireCmsContentsAccess(ids: readonly number[], executor: DbExecutor = db) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const scope = await cmsContentDataScope(executor);
  const rows = await executor.select().from(cmsContents).where(buildWhere(inArray(cmsContents.id, uniqueIds), scope));
  if (rows.length !== uniqueIds.length) throw new HTTPException(404, { message: '所选内容包含不存在或无权访问的对象' });
  for (const siteId of new Set(rows.map((row) => row.siteId))) await assertSiteAccess(siteId);
  for (const channelId of new Set(rows.map((row) => row.channelId))) await assertChannelAccess(channelId);
  const working = await executor.select({ channelId: sql<number>`(${cmsContentWorkingCopies.snapshot}->>'channelId')::integer` }).from(cmsContentWorkingCopies).where(inArray(cmsContentWorkingCopies.contentId, uniqueIds));
  for (const channelId of new Set(working.map((row) => row.channelId))) await assertChannelAccess(channelId);
  return rows;
}
