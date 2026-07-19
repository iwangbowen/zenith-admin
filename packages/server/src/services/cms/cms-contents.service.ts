import { eq, asc, desc, and, or, like, inArray, isNull, isNotNull, ne, lt, gt, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContents, cmsContentTags, cmsTags, cmsChannels } from '../../db/schema';
import type { CmsContentRow, CmsTagRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { buildSearchVector } from './cms-search.service';
import { listCmsModelFields } from './cms-models.service';
import { ensureCmsChannelExists } from './cms-channels.service';
import { snapshotContentVersion, restoreContentVersion } from './cms-versions.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { isWorkflowAuditEnabled, startCmsContentWorkflow, assertNoActiveContentWorkflow } from './cms-workflow.service';
import type { CreateCmsContentInput, UpdateCmsContentInput, CmsContentStatus } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsContent(row: CmsContentRow, extra?: { channelName?: string | null; tags?: CmsTagRow[] }) {
  return {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelName: extra?.channelName ?? null,
    modelId: row.modelId ?? null,
    title: row.title,
    slug: row.slug ?? null,
    summary: row.summary ?? null,
    coverImage: row.coverImage ?? null,
    author: row.author ?? null,
    source: row.source ?? null,
    body: row.body ?? null,
    extend: row.extend ?? {},
    externalLink: row.externalLink ?? null,
    isTop: row.isTop,
    isRecommend: row.isRecommend,
    isHot: row.isHot,
    status: row.status,
    rejectReason: row.rejectReason ?? null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    scheduledAt: formatNullableDateTime(row.scheduledAt),
    viewCount: row.viewCount,
    sort: row.sort,
    seoTitle: row.seoTitle ?? null,
    seoKeywords: row.seoKeywords ?? null,
    seoDescription: row.seoDescription ?? null,
    memberId: row.memberId ?? null,
    ...(extra?.tags ? {
      tags: extra.tags.map((t) => ({
        id: t.id, siteId: t.siteId, name: t.name, slug: t.slug, contentCount: t.contentCount,
        createdAt: formatDateTime(t.createdAt), updatedAt: formatDateTime(t.updatedAt),
      })),
      tagIds: extra.tags.map((t) => t.id),
    } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsContentExists(id: number): Promise<CmsContentRow> {
  const [row] = await db.select().from(cmsContents).where(eq(cmsContents.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '内容不存在' });
  return row;
}

export async function getCmsContent(id: number) {
  const row = await db.query.cmsContents.findFirst({
    where: eq(cmsContents.id, id),
    with: {
      channel: { columns: { name: true } },
      contentTags: { with: { tag: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '内容不存在' });
  return mapCmsContent(row, { channelName: row.channel?.name, tags: row.contentTags.map((ct) => ct.tag) });
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsContentsQuery {
  siteId: number;
  channelId?: number;
  status?: CmsContentStatus;
  keyword?: string;
  isTop?: boolean;
  isRecommend?: boolean;
  isHot?: boolean;
  /** true = 回收站列表 */
  deleted?: boolean;
  startTime?: string;
  endTime?: string;
  page: number;
  pageSize: number;
}

export async function listCmsContents(q: ListCmsContentsQuery) {
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsContents.siteId, q.siteId)];
  conditions.push(q.deleted ? isNotNull(cmsContents.deletedAt) : isNull(cmsContents.deletedAt));
  if (q.channelId) conditions.push(eq(cmsContents.channelId, q.channelId));
  if (q.status) conditions.push(eq(cmsContents.status, q.status));
  if (q.isTop !== undefined) conditions.push(eq(cmsContents.isTop, q.isTop));
  if (q.isRecommend !== undefined) conditions.push(eq(cmsContents.isRecommend, q.isRecommend));
  if (q.isHot !== undefined) conditions.push(eq(cmsContents.isHot, q.isHot));
  if (q.keyword) {
    const kw = or(
      like(cmsContents.title, `%${escapeLike(q.keyword)}%`),
      like(cmsContents.author, `%${escapeLike(q.keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  const start = parseDateTimeInput(q.startTime);
  const end = parseDateTimeInput(q.endTime);
  if (start) conditions.push(gt(cmsContents.createdAt, start));
  if (end) conditions.push(lt(cmsContents.createdAt, end));

  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    db.query.cmsContents.findMany({
      where,
      with: { channel: { columns: { name: true } } },
      orderBy: [desc(cmsContents.isTop), desc(cmsContents.id)],
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    }),
  ]);
  return {
    list: rows.map((r) => mapCmsContent(r, { channelName: r.channel?.name })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

// ─── 写入辅助 ─────────────────────────────────────────────────────────────────

/** 模型 searchable 字段的 extend 文本值（纳入全文索引） */
async function collectSearchableExtendTexts(modelId: number | null | undefined, extend: Record<string, unknown>): Promise<string[]> {
  if (!modelId) return [];
  const fields = await listCmsModelFields(modelId);
  return fields
    .filter((f) => f.searchable)
    .map((f) => extend[f.name])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** 先删后插替换内容标签，并重算受影响标签的 contentCount */
async function setContentTags(executor: DbExecutor, contentId: number, siteId: number, tagIds: number[]): Promise<void> {
  const previous = await executor.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags).where(eq(cmsContentTags.contentId, contentId));
  await executor.delete(cmsContentTags).where(eq(cmsContentTags.contentId, contentId));
  if (tagIds.length > 0) {
    const validTags = await executor.select({ id: cmsTags.id }).from(cmsTags)
      .where(and(inArray(cmsTags.id, tagIds), eq(cmsTags.siteId, siteId)));
    if (validTags.length !== tagIds.length) {
      throw new HTTPException(400, { message: '存在无效标签或标签不属于当前站点' });
    }
    await executor.insert(cmsContentTags).values(tagIds.map((tagId) => ({ contentId, tagId })));
  }
  const affected = [...new Set([...previous.map((p) => p.tagId), ...tagIds])];
  for (const tagId of affected) {
    await executor.update(cmsTags)
      .set({ contentCount: await executor.$count(cmsContentTags, eq(cmsContentTags.tagId, tagId)) })
      .where(eq(cmsTags.id, tagId));
  }
}

/** 校验栏目归属与类型（内容只能挂在本站点的列表栏目下） */
async function ensureChannelForContent(siteId: number, channelId: number) {
  const channel = await ensureCmsChannelExists(channelId);
  if (channel.siteId !== siteId) throw new HTTPException(400, { message: '栏目不属于当前站点' });
  if (channel.type !== 'list') throw new HTTPException(400, { message: '只有列表栏目可以发布内容' });
  return channel;
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsContent(data: CreateCmsContentInput) {
  await assertSiteAccess(data.siteId);
  const channel = await ensureChannelForContent(data.siteId, data.channelId);
  const { tagIds = [], scheduledAt, ...rest } = data;
  const extend = (rest.extend ?? {}) as Record<string, unknown>;
  const modelId = channel.modelId ?? null;
  const extendTexts = await collectSearchableExtendTexts(modelId, extend);
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(cmsContents).values({
        ...rest,
        extend,
        modelId,
        scheduledAt: parseDateTimeInput(scheduledAt),
        searchVector: buildSearchVector({
          title: rest.title,
          seoKeywords: rest.seoKeywords,
          summary: rest.summary,
          body: rest.body,
          extendTexts,
        }),
      }).returning();
      await setContentTags(tx, created.id, data.siteId, tagIds);
      return created;
    });
    return getCmsContent(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 URL 标识的内容');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsContent(id: number, data: UpdateCmsContentInput) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  let modelId = current.modelId;
  if (data.channelId && data.channelId !== current.channelId) {
    const channel = await ensureChannelForContent(current.siteId, data.channelId);
    modelId = channel.modelId ?? null;
  }
  const { tagIds, scheduledAt, ...rest } = data;
  const nextExtend = (rest.extend ?? current.extend ?? {}) as Record<string, unknown>;
  const extendTexts = await collectSearchableExtendTexts(modelId, nextExtend);
  try {
    await db.transaction(async (tx) => {
      // 更新前自动留档版本快照（可在编辑页回滚）
      await snapshotContentVersion(tx, current, '更新前留档');
      const [updated] = await tx.update(cmsContents).set({
        ...rest,
        modelId,
        ...(scheduledAt !== undefined ? { scheduledAt: parseDateTimeInput(scheduledAt) } : {}),
        searchVector: buildSearchVector({
          title: rest.title ?? current.title,
          seoKeywords: rest.seoKeywords !== undefined ? rest.seoKeywords : current.seoKeywords,
          summary: rest.summary !== undefined ? rest.summary : current.summary,
          body: rest.body !== undefined ? rest.body : current.body,
          extendTexts,
        }),
      }).where(eq(cmsContents.id, id)).returning();
      if (!updated) throw new HTTPException(404, { message: '内容不存在' });
      if (tagIds) {
        await setContentTags(tx, id, current.siteId, tagIds);
      }
    });
    return getCmsContent(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 URL 标识的内容');
  }
}

// ─── 状态流转 ─────────────────────────────────────────────────────────────────
const STATUS_TRANSITIONS: Record<string, CmsContentStatus[]> = {
  submit: ['draft', 'rejected'],
  publish: ['draft', 'pending', 'rejected', 'offline'],
  reject: ['pending'],
  offline: ['published'],
};

async function transitionStatus(id: number, action: keyof typeof STATUS_TRANSITIONS, patch: Partial<typeof cmsContents.$inferInsert>) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  if (current.deletedAt) throw new HTTPException(400, { message: '回收站中的内容不可操作，请先恢复' });
  if (!STATUS_TRANSITIONS[action].includes(current.status)) {
    throw new HTTPException(400, { message: `当前状态（${current.status}）不允许此操作` });
  }
  await db.update(cmsContents).set(patch).where(eq(cmsContents.id, id));
  return getCmsContent(id);
}

/** 提交审核：站点开启工作流审核模式时自动发起审核流程 */
export async function submitCmsContent(id: number) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  const site = await ensureCmsSiteExists(current.siteId);
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  const result = await transitionStatus(id, 'submit', { status: 'pending', rejectReason: null });
  if (isWorkflowAuditEnabled(settings)) {
    try {
      const channel = await db.query.cmsChannels.findFirst({
        where: eq(cmsChannels.id, current.channelId),
        columns: { name: true },
      });
      await startCmsContentWorkflow({
        contentId: id,
        title: current.title,
        siteName: site.name,
        channelName: channel?.name ?? '',
        settings,
      });
    } catch (err) {
      // 流程发起失败回退待审状态，避免内容卡在 pending 无人处理
      await db.update(cmsContents).set({ status: current.status }).where(eq(cmsContents.id, id));
      throw err;
    }
  }
  return result;
}

/** 发布（直接发布或审核通过）；工作流审核期间禁止手动发布 */
export async function publishCmsContent(id: number, opts?: { fromWorkflow?: boolean }) {
  if (!opts?.fromWorkflow) await assertNoActiveContentWorkflow(id);
  return transitionStatus(id, 'publish', { status: 'published', publishedAt: new Date(), rejectReason: null });
}

/** 驳回；工作流审核期间禁止手动驳回 */
export async function rejectCmsContent(id: number, reason: string, opts?: { fromWorkflow?: boolean }) {
  if (!opts?.fromWorkflow) await assertNoActiveContentWorkflow(id);
  return transitionStatus(id, 'reject', { status: 'rejected', rejectReason: reason });
}

/** 下线 */
export async function offlineCmsContent(id: number) {
  return transitionStatus(id, 'offline', { status: 'offline' });
}

// ─── 回收站 ───────────────────────────────────────────────────────────────────
async function assertBatchSiteAccess(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db.select({ siteId: cmsContents.siteId }).from(cmsContents).where(inArray(cmsContents.id, ids));
  for (const siteId of new Set(rows.map((r) => r.siteId))) {
    await assertSiteAccess(siteId);
  }
}

export async function recycleCmsContents(ids: number[]) {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const rows = await db.update(cmsContents)
    .set({ deletedAt: new Date(), status: 'offline' })
    .where(and(inArray(cmsContents.id, ids), isNull(cmsContents.deletedAt)))
    .returning({ id: cmsContents.id });
  return rows.length;
}

export async function restoreCmsContents(ids: number[]) {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const rows = await db.update(cmsContents)
    .set({ deletedAt: null, status: 'draft' })
    .where(and(inArray(cmsContents.id, ids), isNotNull(cmsContents.deletedAt)))
    .returning({ id: cmsContents.id });
  return rows.length;
}

/** 彻底删除（仅限回收站中的内容） */
export async function purgeCmsContents(ids: number[]) {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const targets = await db.select({ id: cmsContents.id }).from(cmsContents)
    .where(and(inArray(cmsContents.id, ids), isNotNull(cmsContents.deletedAt)));
  if (targets.length === 0) return 0;
  const targetIds = targets.map((t) => t.id);
  await db.transaction(async (tx) => {
    const tagRows = await tx.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags).where(inArray(cmsContentTags.contentId, targetIds));
    await tx.delete(cmsContents).where(inArray(cmsContents.id, targetIds));
    for (const tagId of [...new Set(tagRows.map((t) => t.tagId))]) {
      await tx.update(cmsTags)
        .set({ contentCount: await tx.$count(cmsContentTags, eq(cmsContentTags.tagId, tagId)) })
        .where(eq(cmsTags.id, tagId));
    }
  });
  return targetIds.length;
}

/** 回滚内容到指定版本（复用更新管道：重算检索向量并留档） */
export async function restoreCmsContentToVersion(contentId: number, versionId: number) {
  const snapshot = await restoreContentVersion(contentId, versionId);
  return updateCmsContent(contentId, snapshot as UpdateCmsContentInput);
}

// ─── 前台查询（渲染上下文使用）────────────────────────────────────────────────
const publishedWhere = (siteId: number) => and(
  eq(cmsContents.siteId, siteId),
  eq(cmsContents.status, 'published'),
  isNull(cmsContents.deletedAt),
)!;

/** 栏目下已发布内容分页（置顶优先，发布时间倒序） */
export async function listPublishedContents(siteId: number, channelId: number, page: number, pageSize: number) {
  const where = and(publishedWhere(siteId), eq(cmsContents.channelId, channelId))!;
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    withPagination(
      db.select().from(cmsContents).where(where)
        .orderBy(desc(cmsContents.isTop), desc(cmsContents.sort), desc(cmsContents.publishedAt), desc(cmsContents.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { total, rows };
}

/** 首页区块：最新 / 推荐 / 热门 */
export async function listHomeContents(siteId: number, limit = 10) {
  const base = publishedWhere(siteId);
  const [latest, recommended, hot] = await Promise.all([
    db.select().from(cmsContents).where(base).orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id)).limit(limit),
    db.select().from(cmsContents).where(and(base, eq(cmsContents.isRecommend, true))).orderBy(desc(cmsContents.publishedAt)).limit(limit),
    db.select().from(cmsContents).where(and(base, eq(cmsContents.isHot, true))).orderBy(desc(cmsContents.viewCount)).limit(limit),
  ]);
  return { latest, recommended, hot };
}

/** 前台详情（按 id 或 slug）；返回 null 表示 404 */
export async function getPublishedContent(siteId: number, channelId: number, idOrSlug: string): Promise<CmsContentRow | null> {
  const numericId = /^\d+$/.test(idOrSlug) ? Number(idOrSlug) : null;
  const matcher = numericId !== null ? eq(cmsContents.id, numericId) : eq(cmsContents.slug, idOrSlug);
  const [row] = await db.select().from(cmsContents)
    .where(and(publishedWhere(siteId), eq(cmsContents.channelId, channelId), matcher))
    .limit(1);
  return row ?? null;
}

/** 上一篇 / 下一篇（同栏目按发布时间序） */
export async function getAdjacentContents(row: CmsContentRow) {
  const base = and(publishedWhere(row.siteId), eq(cmsContents.channelId, row.channelId), ne(cmsContents.id, row.id))!;
  const anchor = row.publishedAt ?? row.createdAt;
  const [prevRows, nextRows] = await Promise.all([
    db.select().from(cmsContents).where(and(base, lt(cmsContents.publishedAt, anchor))).orderBy(desc(cmsContents.publishedAt)).limit(1),
    db.select().from(cmsContents).where(and(base, gt(cmsContents.publishedAt, anchor))).orderBy(asc(cmsContents.publishedAt)).limit(1),
  ]);
  return { prev: prevRows[0] ?? null, next: nextRows[0] ?? null };
}

/** 浏览计数（动态渲染路径下累加；静态页不计数为已知取舍） */
export async function increaseViewCount(id: number): Promise<void> {
  await db.update(cmsContents)
    .set({ viewCount: sql`${cmsContents.viewCount} + 1` })
    .where(eq(cmsContents.id, id));
}

/** 内容标签（前台详情页展示） */
export async function listContentTags(contentId: number): Promise<CmsTagRow[]> {
  const rows = await db.query.cmsContentTags.findMany({
    where: eq(cmsContentTags.contentId, contentId),
    with: { tag: true },
  });
  return rows.map((r) => r.tag);
}

// ═══ P3 Batch1 ════════════════════════════════════════════════════════════════

/** 标签聚合页：按标签取已发布内容分页 */
export async function listPublishedContentsByTag(siteId: number, tagId: number, page: number, pageSize: number) {
  const idsQuery = db.select({ contentId: cmsContentTags.contentId }).from(cmsContentTags).where(eq(cmsContentTags.tagId, tagId));
  const where = and(publishedWhere(siteId), inArray(cmsContents.id, idsQuery))!;
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    withPagination(
      db.select().from(cmsContents).where(where)
        .orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { total, rows };
}

/** 批量移动栏目（目标须为本站点列表栏目；重算 modelId） */
export async function batchMoveCmsContents(ids: number[], channelId: number): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const rows = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId }).from(cmsContents).where(inArray(cmsContents.id, ids));
  const siteIds = new Set(rows.map((r) => r.siteId));
  if (siteIds.size > 1) throw new HTTPException(400, { message: '仅支持同站点内容批量移动' });
  const siteId = [...siteIds][0];
  if (siteId === undefined) return 0;
  const channel = await ensureChannelForContent(siteId, channelId);
  const updated = await db.update(cmsContents)
    .set({ channelId, modelId: channel.modelId ?? null })
    .where(inArray(cmsContents.id, rows.map((r) => r.id)))
    .returning({ id: cmsContents.id });
  return updated.length;
}

/** 批量设置属性（置顶/推荐/热门，仅更新传入的字段） */
export async function batchSetCmsContentFlags(ids: number[], flags: { isTop?: boolean; isRecommend?: boolean; isHot?: boolean }): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const patch: Record<string, boolean> = {};
  if (flags.isTop !== undefined) patch.isTop = flags.isTop;
  if (flags.isRecommend !== undefined) patch.isRecommend = flags.isRecommend;
  if (flags.isHot !== undefined) patch.isHot = flags.isHot;
  if (Object.keys(patch).length === 0) return 0;
  const updated = await db.update(cmsContents).set(patch)
    .where(and(inArray(cmsContents.id, ids), isNull(cmsContents.deletedAt)))
    .returning({ id: cmsContents.id });
  return updated.length;
}

/** 批量追加标签（跳过已存在的绑定，重算计数） */
export async function batchAddCmsContentTags(ids: number[], tagIds: number[]): Promise<number> {
  if (ids.length === 0 || tagIds.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const rows = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId }).from(cmsContents).where(inArray(cmsContents.id, ids));
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const validTags = await tx.select({ id: cmsTags.id }).from(cmsTags)
        .where(and(inArray(cmsTags.id, tagIds), eq(cmsTags.siteId, row.siteId)));
      if (validTags.length > 0) {
        await tx.insert(cmsContentTags)
          .values(validTags.map((t) => ({ contentId: row.id, tagId: t.id })))
          .onConflictDoNothing();
      }
    }
    for (const tagId of tagIds) {
      await tx.update(cmsTags)
        .set({ contentCount: await tx.$count(cmsContentTags, eq(cmsContentTags.tagId, tagId)) })
        .where(eq(cmsTags.id, tagId));
    }
  });
  return rows.length;
}

/** 复制内容为草稿（标题加后缀，slug 置空避免唯一冲突，标签一并复制） */
export async function duplicateCmsContent(id: number) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  const tagRows = await db.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags).where(eq(cmsContentTags.contentId, id));
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(cmsContents).values({
      siteId: current.siteId,
      channelId: current.channelId,
      modelId: current.modelId,
      title: `${current.title}（副本）`.slice(0, 255),
      slug: null,
      summary: current.summary,
      coverImage: current.coverImage,
      author: current.author,
      source: current.source,
      body: current.body,
      extend: current.extend ?? {},
      externalLink: current.externalLink,
      isTop: false,
      isRecommend: current.isRecommend,
      isHot: current.isHot,
      status: 'draft',
      sort: current.sort,
      seoTitle: current.seoTitle,
      seoKeywords: current.seoKeywords,
      seoDescription: current.seoDescription,
      searchVector: buildSearchVector({
        title: `${current.title}（副本）`,
        seoKeywords: current.seoKeywords,
        summary: current.summary,
        body: current.body,
      }),
    }).returning();
    if (tagRows.length > 0) {
      await tx.insert(cmsContentTags).values(tagRows.map((t) => ({ contentId: created.id, tagId: t.tagId })));
      for (const t of tagRows) {
        await tx.update(cmsTags)
          .set({ contentCount: await tx.$count(cmsContentTags, eq(cmsContentTags.tagId, t.tagId)) })
          .where(eq(cmsTags.id, t.tagId));
      }
    }
    return created;
  });
  return getCmsContent(row.id);
}

/** 站群内容分发：复制到目标站点栏目（草稿，标签不跨站复制） */
export async function distributeCmsContents(ids: number[], targetSiteId: number, targetChannelId: number): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  await assertSiteAccess(targetSiteId);
  const channel = await ensureChannelForContent(targetSiteId, targetChannelId);
  const rows = await db.select().from(cmsContents).where(inArray(cmsContents.id, ids));
  let copied = 0;
  for (const current of rows) {
    if (current.siteId === targetSiteId) continue; // 同站分发无意义，跳过
    await db.insert(cmsContents).values({
      siteId: targetSiteId,
      channelId: targetChannelId,
      modelId: channel.modelId ?? null,
      title: current.title,
      slug: null,
      summary: current.summary,
      coverImage: current.coverImage,
      author: current.author,
      source: current.source,
      body: current.body,
      extend: current.extend ?? {},
      externalLink: current.externalLink,
      status: 'draft',
      seoTitle: current.seoTitle,
      seoKeywords: current.seoKeywords,
      seoDescription: current.seoDescription,
      searchVector: buildSearchVector({
        title: current.title,
        seoKeywords: current.seoKeywords,
        summary: current.summary,
        body: current.body,
      }),
    });
    copied += 1;
  }
  return copied;
}

/** 回收站自动清理：彻底删除进入回收站超过 N 天的内容（系统周期任务调用） */
export async function cleanupCmsRecycleBin(retentionDays = 30): Promise<number> {
  const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const targets = await db.select({ id: cmsContents.id }).from(cmsContents)
    .where(and(isNotNull(cmsContents.deletedAt), lt(cmsContents.deletedAt, threshold)));
  if (targets.length === 0) return 0;
  return purgeCmsContents(targets.map((t) => t.id));
}
