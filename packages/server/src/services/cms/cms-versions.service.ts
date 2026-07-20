import { eq, desc, max, inArray } from 'drizzle-orm';
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
    subTitle: row.subTitle,
    shortTitle: row.shortTitle,
    slug: row.slug,
    summary: row.summary,
    coverImage: row.coverImage,
    coverThumb: row.coverThumb,
    author: row.author,
    editor: row.editor,
    source: row.source,
    sourceUrl: row.sourceUrl,
    isOriginal: row.isOriginal,
    body: row.body,
    extend: row.extend,
    mediaData: row.mediaData,
    externalLink: row.externalLink,
    isTop: row.isTop,
    topWeight: row.topWeight,
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
  // 裁剪最旧版本（单条 DELETE 子查询，避免逐条删除）
  const staleIds = executor.select({ id: cmsContentVersions.id })
    .from(cmsContentVersions)
    .where(eq(cmsContentVersions.contentId, row.id))
    .orderBy(desc(cmsContentVersions.version))
    .offset(MAX_VERSIONS);
  await executor.delete(cmsContentVersions).where(inArray(cmsContentVersions.id, staleIds));
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

// ─── 版本差异对比 ─────────────────────────────────────────────────────────────
const SNAPSHOT_FIELD_LABELS: Record<string, string> = {
  channelId: '所属栏目',
  title: '标题',
  subTitle: '副标题',
  shortTitle: '短标题',
  slug: 'URL 标识',
  summary: '摘要',
  coverImage: '封面图',
  coverThumb: '封面缩略图',
  author: '作者',
  editor: '责任编辑',
  source: '来源',
  sourceUrl: '来源链接',
  isOriginal: '原创',
  body: '正文',
  extend: '扩展字段',
  mediaData: '形态数据（图集/音视频）',
  externalLink: '外链地址',
  isTop: '置顶',
  topWeight: '置顶权重',
  isRecommend: '推荐',
  isHot: '热门',
  sort: '排序权重',
  seoTitle: 'SEO 标题',
  seoKeywords: 'SEO 关键词',
  seoDescription: 'SEO 描述',
};

export interface CmsVersionDiffItem {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

/** 对比版本快照与当前内容（before=历史版本值，after=当前值），仅返回有差异的字段 */
export async function diffContentVersion(contentId: number, versionId: number): Promise<CmsVersionDiffItem[]> {
  const version = await ensureVersionExists(contentId, versionId);
  const [current] = await db.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!current) throw new HTTPException(404, { message: '内容不存在' });
  const currentSnapshot = buildContentSnapshot(current);
  const versionSnapshot = version.snapshot as Record<string, unknown>;
  const diffs: CmsVersionDiffItem[] = [];
  for (const [field, label] of Object.entries(SNAPSHOT_FIELD_LABELS)) {
    const before = versionSnapshot[field] ?? null;
    const after = currentSnapshot[field] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push({ field, label, before, after });
    }
  }
  return diffs;
}
