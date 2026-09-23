import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsChannels, cmsContents, cmsContentWorkingCopies, cmsContentRevisions, cmsReleases } from '../../db/schema';
import { buildWhere } from '../../lib/where-helpers';
import { cmsContentDataScope, requireCmsContentsAccess } from './cms-content-access.service';
import { assertAllCmsSiteChannelsAccess, assertChannelAccess, getAccessibleChannelIds } from './cms-channels.service';
import { assertSiteAccess } from './cms-sites.service';

/** Whole releases are visible only when every selected object remains visible. */
export async function cmsReleaseScope(siteId: number): Promise<SQL> {
  await assertSiteAccess(siteId);
  const channels = await getAccessibleChannelIds();
  const scope = await cmsContentDataScope();
  const ownChannels = channels === null ? [] : await db.select({ id: cmsChannels.id }).from(cmsChannels).where(eq(cmsChannels.siteId, siteId));
  const wholeSite = channels === null || ownChannels.every((row) => channels.includes(row.id));
  const contentScope = buildWhere(eq(cmsContents.siteId, siteId), scope,
    channels === null ? undefined : inArray(cmsContents.channelId, channels),
    channels === null ? undefined : sql`coalesce((${cmsContentWorkingCopies.snapshot}->>'channelId')::integer,${cmsContents.channelId}) IN (${channels.length ? sql.join(channels.map((id) => sql`${id}`), sql`,`) : sql`NULL`})`,
  );
  const revisionChannel = channels === null ? sql`true` : sql`(
    item->>'revisionId' IS NULL OR EXISTS (
      SELECT 1 FROM ${cmsContentRevisions} WHERE ${cmsContentRevisions.id}=(item->>'revisionId')::integer
      AND (${cmsContentRevisions.snapshot}->>'channelId')::integer IN (${channels.length ? sql.join(channels.map((id) => sql`${id}`), sql`,`) : sql`NULL`})
    )
  )`;
  return sql`(${wholeSite ? sql`true` : sql`jsonb_array_length(${cmsReleases.configurationItems})=0 AND jsonb_array_length(${cmsReleases.items})>0`})
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${cmsReleases.items}) item WHERE NOT (${revisionChannel}) OR NOT EXISTS (
      SELECT 1 FROM ${cmsContents} LEFT JOIN ${cmsContentWorkingCopies} ON ${cmsContentWorkingCopies.contentId}=${cmsContents.id}
      WHERE ${cmsContents.id}=(item->>'contentId')::integer AND ${contentScope ?? sql`true`}
    ))`;
}

export async function assertCmsReleaseSelectionAccess(siteId: number, revisionIds: readonly number[], withdrawIds: readonly number[], hasConfiguration: boolean): Promise<void> {
  await assertSiteAccess(siteId);
  if (hasConfiguration) await assertAllCmsSiteChannelsAccess(siteId);
  const unique = [...new Set(revisionIds)];
  const revisions = unique.length ? await db.select({ id: cmsContentRevisions.id, contentId: cmsContentRevisions.contentId, channelId: sql<number>`(${cmsContentRevisions.snapshot}->>'channelId')::integer` }).from(cmsContentRevisions).where(inArray(cmsContentRevisions.id, unique)) : [];
  if (revisions.length !== unique.length) throw new HTTPException(404, { message: '所选修订不存在或无权访问' });
  const rows = await requireCmsContentsAccess([...revisions.map((row) => row.contentId), ...withdrawIds]);
  if (rows.some((row) => row.siteId !== siteId)) throw new HTTPException(404, { message: '所选内容不属于当前站点' });
  for (const channelId of new Set(revisions.map((row) => row.channelId))) await assertChannelAccess(channelId);
}
