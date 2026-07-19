import { eq, desc, max } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContentVersions, cmsContents } from '../../db/schema';
import type { CmsContentRow, CmsContentVersionRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';

/** 每条内容保留的最大版本数（超出自动裁剪最旧版本） */
const MAX_VERSIONS = 20;

/** 从内容行提取可回滚快照字段 */
export function buildContentSnapshot(row: CmsContentRow): Record<string, unknown> {
  return {
    channelId: row.channelId,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    coverImage: row.coverImage,
    author: row.author,
    source: row.source,
    body: row.body,
    extend: row.extend,
    externalLink: row.externalLink,
    isTop: row.isTop,
    isRecommend: row.isRecommend,
    isHot: row.isHot,
    sort: row.sort,
    seoTitle: row.seoTitle,
    seoKeywords: row.seoKeywords,
    seoDescription: row.seoDescription,
  };
}

/** 写入版本快照并裁剪历史（在内容更新事务内调用） */
export async function snapshotContentVersion(executor: DbExecutor, row: CmsContentRow, remark: string): Promise<void> {
  const [{ latest }] = await executor
    .select({ latest: max(cmsContentVersions.version) })
    .from(cmsContentVersions)
    .where(eq(cmsContentVersions.contentId, row.id));
  const version = (latest ?? 0) + 1;
  await executor.insert(cmsContentVersions).values({
    contentId: row.id,
    version,
    title: row.title,
    snapshot: buildContentSnapshot(row),
    remark,
  });
  // 裁剪最旧版本
  const stale = await executor.select({ id: cmsContentVersions.id })
    .from(cmsContentVersions)
    .where(eq(cmsContentVersions.contentId, row.id))
    .orderBy(desc(cmsContentVersions.version))
    .offset(MAX_VERSIONS);
  if (stale.length > 0) {
    for (const s of stale) {
      await executor.delete(cmsContentVersions).where(eq(cmsContentVersions.id, s.id));
    }
  }
}

export function mapCmsContentVersion(row: CmsContentVersionRow, createdByName?: string | null) {
  return {
    id: row.id,
    contentId: row.contentId,
    version: row.version,
    title: row.title,
    snapshot: row.snapshot,
    remark: row.remark ?? null,
    createdByName: createdByName ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 内容的版本列表（新→旧） */
export async function listContentVersions(contentId: number) {
  const rows = await db.query.cmsContentVersions.findMany({
    where: eq(cmsContentVersions.contentId, contentId),
    with: { createdByUser: { columns: { nickname: true } } },
    orderBy: desc(cmsContentVersions.version),
  });
  return rows.map((r) => mapCmsContentVersion(r, r.createdByUser?.nickname));
}

export async function ensureVersionExists(contentId: number, versionId: number): Promise<CmsContentVersionRow> {
  const [row] = await db.select().from(cmsContentVersions)
    .where(eq(cmsContentVersions.id, versionId))
    .limit(1);
  if (!row || row.contentId !== contentId) throw new HTTPException(404, { message: '版本不存在' });
  return row;
}

/** 回滚到指定版本（回滚前自动为当前状态留档） */
export async function restoreContentVersion(contentId: number, versionId: number): Promise<Record<string, unknown>> {
  const version = await ensureVersionExists(contentId, versionId);
  const [current] = await db.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!current) throw new HTTPException(404, { message: '内容不存在' });
  await db.transaction(async (tx) => {
    await snapshotContentVersion(tx, current, `回滚到 v${version.version} 前留档`);
  });
  return version.snapshot;
}
