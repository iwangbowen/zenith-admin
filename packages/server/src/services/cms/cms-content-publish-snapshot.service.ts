import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { CmsContentPublishSnapshot } from '@zenith/shared';
import { CMS_CHANNEL_SEGMENT_PREFIX } from '@zenith/shared';
import type { DbExecutor } from '../../db/types';
import {
  asyncTasks,
  cmsChannels,
  cmsContents,
  cmsPublishArtifacts,
  cmsPublishChannels,
  type CmsContentRow,
} from '../../db/schema';
import { contentUrl, splitBodyPages } from './cms-render.service';
import { virtualDefaultChannel, type PublishChannelInfo } from './cms-publish-channels.service';

async function activePublishChannels(executor: DbExecutor, siteId: number): Promise<PublishChannelInfo[]> {
  const rows = await executor.select().from(cmsPublishChannels)
    .where(and(eq(cmsPublishChannels.siteId, siteId), eq(cmsPublishChannels.status, 'enabled')))
    .orderBy(asc(cmsPublishChannels.sort), asc(cmsPublishChannels.id));
  const channels = rows.map((row) => ({
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    code: row.code,
    domain: row.domain ?? null,
    uaRegex: row.uaRegex ?? null,
    isDefault: row.isDefault,
  }));
  return channels.some((channel) => channel.isDefault)
    ? channels
    : [virtualDefaultChannel(siteId), ...channels];
}

function staticPath(channel: PublishChannelInfo, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '');
  return channel.isDefault ? clean : `${CMS_CHANNEL_SEGMENT_PREFIX}${channel.code}/${clean}`;
}

export function buildCmsContentSnapshotTargets(
  content: Pick<CmsContentRow, 'id' | 'slug'>,
  channelPath: string,
  bodyPages: number,
  publishChannels: readonly PublishChannelInfo[],
) {
  return publishChannels.map((publishChannel) => ({
    publishChannelCode: publishChannel.code,
    paths: Array.from({ length: bodyPages }, (_, index) =>
      staticPath(publishChannel, contentUrl('', channelPath, content, index + 1))),
  }));
}

async function bodyPageCount(executor: DbExecutor, row: CmsContentRow): Promise<number> {
  if (!row.mappingSourceId) return splitBodyPages(row.body).length;
  const [source] = await executor.select({ body: cmsContents.body }).from(cmsContents)
    .where(and(eq(cmsContents.id, row.mappingSourceId), isNull(cmsContents.deletedAt))).limit(1);
  return splitBodyPages(source?.body).length;
}

export async function captureCmsContentPublishSnapshot(
  executor: DbExecutor,
  row: CmsContentRow,
  options?: {
    build?: boolean;
    purged?: boolean;
    includeExistingArtifacts?: boolean;
    refreshChannelIds?: number[];
  },
): Promise<{ snapshot: CmsContentPublishSnapshot; deletePaths: string[] }> {
  const [channel] = await executor.select({ id: cmsChannels.id, path: cmsChannels.path }).from(cmsChannels)
    .where(eq(cmsChannels.id, row.channelId)).limit(1);
  if (!channel) throw new Error(`内容 #${row.id} 的栏目不存在`);
  const publishChannels = await activePublishChannels(executor, row.siteId);
  const bodyPages = await bodyPageCount(executor, row);
  const targets = buildCmsContentSnapshotTargets(row, channel.path, bodyPages, publishChannels);
  const existing = options?.includeExistingArtifacts
    ? await executor.select({ path: cmsPublishArtifacts.path }).from(cmsPublishArtifacts).where(and(
        eq(cmsPublishArtifacts.siteId, row.siteId),
        eq(cmsPublishArtifacts.contentId, row.id),
        eq(cmsPublishArtifacts.status, 'generated'),
      ))
    : [];
  const pendingTasks = options?.includeExistingArtifacts
    ? await executor.select({ payload: asyncTasks.payload }).from(asyncTasks).where(and(
        eq(asyncTasks.taskType, 'cms-publish-build'),
        sql`${asyncTasks.status} in ('pending', 'running')`,
        sql`(${asyncTasks.payload}->'contentIds') @> ${JSON.stringify([row.id])}::jsonb`,
      ))
    : [];
  const pendingPaths = pendingTasks.flatMap(({ payload }) => {
    const task = payload as unknown as { deletePaths?: unknown; contentSnapshots?: unknown };
    const deleted = Array.isArray(task.deletePaths) ? task.deletePaths.filter((item): item is string => typeof item === 'string') : [];
    const built = Array.isArray(task.contentSnapshots)
      ? task.contentSnapshots.flatMap((snapshot) => {
          if (!snapshot || typeof snapshot !== 'object') return [];
          const targets = (snapshot as { targets?: unknown }).targets;
          return Array.isArray(targets)
            ? targets.flatMap((target) => target && typeof target === 'object' && Array.isArray((target as { paths?: unknown }).paths)
              ? (target as { paths: unknown[] }).paths.filter((item): item is string => typeof item === 'string')
              : [])
            : [];
        })
      : [];
    return [...deleted, ...built];
  });
  const deletePaths = [...new Set([
    ...targets.flatMap((target) => target.paths),
    ...existing.map((artifact) => artifact.path),
    ...pendingPaths,
  ])].sort();
  return {
    snapshot: {
      contentId: row.id,
      siteId: row.siteId,
      contentVersion: row.version,
      channelId: row.channelId,
      channelPath: channel.path,
      slug: String(row.slug ?? row.id),
      bodyPages,
      build: options?.build ?? (row.status === 'published' && !row.deletedAt && !row.externalLink?.trim()),
      purged: options?.purged,
      targets,
      refreshChannelIds: [...new Set(options?.refreshChannelIds ?? [row.channelId])].sort((a, b) => a - b),
    },
    deletePaths,
  };
}
