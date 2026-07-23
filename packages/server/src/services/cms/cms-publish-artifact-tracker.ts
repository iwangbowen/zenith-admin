import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import dayjs from 'dayjs';
import type { CmsPublishArtifactStatus, CmsPublishTargetType } from '@zenith/shared';
import { db } from '../../db';
import { cmsPublishArtifacts } from '../../db/schema';

export interface CmsPublishTrackingContext {
  taskId: number;
  siteId: number;
  targetType: CmsPublishTargetType;
  contentId?: number | null;
  channelId?: number | null;
  pageId?: number | null;
  themeCode?: string | null;
  themePackageId?: number | null;
  templateId?: number | null;
  templateVersion?: number | null;
  /** 发布通道 code → id；defaultCode 用于不带 __code/ 前缀的产物。 */
  publishChannelIds: Record<string, number>;
  defaultChannelCode: string;
  origins: Record<string, string | null>;
  onArtifact?: (artifact: {
    path: string;
    status: CmsPublishArtifactStatus;
    error: string | null;
    size: number | null;
  }) => Promise<void>;
}

const tracker = new AsyncLocalStorage<CmsPublishTrackingContext>();

export function withCmsPublishArtifactTracking<T>(
  context: CmsPublishTrackingContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(tracker.run(context, fn));
}

function channelFromPath(
  relPath: string,
  context: CmsPublishTrackingContext,
): { code: string; id: number | null; publicPath: string } {
  const normalized = relPath.replaceAll('\\', '/').replace(/^\/+/, '');
  const firstSlash = normalized.indexOf('/');
  const first = firstSlash >= 0 ? normalized.slice(0, firstSlash) : normalized;
  if (first.startsWith('__') && first.length > 2) {
    const code = first.slice(2);
    return {
      code,
      id: context.publishChannelIds[code] ?? null,
      publicPath: firstSlash >= 0 ? normalized.slice(firstSlash + 1) : '',
    };
  }
  return {
    code: context.defaultChannelCode,
    id: context.publishChannelIds[context.defaultChannelCode] ?? null,
    publicPath: normalized,
  };
}

function artifactUrl(origin: string | null | undefined, publicPath: string): string | null {
  if (!origin) return null;
  const suffix = publicPath ? `/${publicPath}` : '/';
  return `${origin.replace(/\/+$/, '')}${suffix}`;
}

export async function recordCmsPublishArtifact(input: {
  relPath: string;
  status: CmsPublishArtifactStatus;
  content?: string | Buffer | null;
  error?: string | null;
}): Promise<void> {
  const context = tracker.getStore();
  if (!context) return;
  const relPath = input.relPath.replaceAll('\\', '/').replace(/^\/+/, '') || 'index.html';
  const channel = channelFromPath(relPath, context);
  const bytes = input.content == null
    ? null
    : Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8');
  const size = bytes?.length ?? null;
  const checksum = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
  const now = dayjs().toDate();
  await db.insert(cmsPublishArtifacts).values({
    taskId: context.taskId,
    siteId: context.siteId,
    publishChannelId: channel.id,
    targetType: context.targetType,
    contentId: context.contentId ?? null,
    channelId: context.channelId ?? null,
    pageId: context.pageId ?? null,
    themeCode: context.themeCode ?? null,
    themePackageId: context.themePackageId ?? null,
    templateId: context.templateId ?? null,
    templateVersion: context.templateVersion ?? null,
    path: relPath,
    url: artifactUrl(context.origins[channel.code], channel.publicPath),
    checksum,
    size,
    status: input.status,
    error: input.error?.slice(0, 2000) ?? null,
    generatedAt: input.status === 'generated' ? now : null,
  }).onConflictDoUpdate({
    target: [cmsPublishArtifacts.taskId, cmsPublishArtifacts.path],
    set: {
      publishChannelId: sql`excluded.publish_channel_id`,
      contentId: sql`excluded.content_id`,
      channelId: sql`excluded.channel_id`,
      pageId: sql`excluded.page_id`,
      themeCode: sql`excluded.theme_code`,
      themePackageId: sql`excluded.theme_package_id`,
      templateId: sql`excluded.template_id`,
      templateVersion: sql`excluded.template_version`,
      url: sql`excluded.url`,
      checksum: sql`excluded.checksum`,
      size: sql`excluded.size`,
      status: sql`excluded.status`,
      error: sql`excluded.error`,
      generatedAt: sql`excluded.generated_at`,
      updatedAt: now,
    },
  });
  await context.onArtifact?.({
    path: relPath,
    status: input.status,
    error: input.error ?? null,
    size,
  });
}
