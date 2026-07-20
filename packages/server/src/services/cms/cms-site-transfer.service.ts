import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsSites, cmsChannels, cmsContents, cmsTags, cmsContentTags, cmsContentChannels, cmsContentRelations,
  cmsFragments, cmsFriendLinks, cmsRedirects, cmsLinkWords, cmsAdSlots, cmsAds, cmsForms, cmsPages,
} from '../../db/schema';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { buildSearchVector } from './cms-search.service';
import { ensureCmsSiteExists, assertSiteAccess } from './cms-sites.service';

/**
 * 站点导入导出（P5 企业级治理）：整站结构与内容打包为 JSON，用于备份迁移 / 环境同步。
 * 覆盖范围：站点配置、栏目树、标签、内容（含附加栏目/相关文章/标签关联）、碎片、
 * 友情链接、重定向、内链词、广告位+广告、自定义表单定义、搭建页面。
 * 不含运行数据（访问/搜索日志、互动记录、评论、表单提交、版本历史、操作日志、用户绑定）。
 */

export const CMS_SITE_EXPORT_VERSION = 1;

/** 导出时统一剔除的列（导入侧由数据库默认值/当前用户重新生成） */
const OMIT_COMMON = new Set(['createdBy', 'updatedBy', 'createdAt', 'updatedAt']);

type PlainRow = Record<string, unknown>;

function exportRow(row: PlainRow, omit: string[] = []): PlainRow {
  const omitSet = new Set(omit);
  const out: PlainRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (OMIT_COMMON.has(key) || omitSet.has(key)) continue;
    out[key] = value instanceof Date ? formatDateTime(value) : value;
  }
  return out;
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

export async function exportCmsSite(siteId: number) {
  await assertSiteAccess(siteId);
  const site = await ensureCmsSiteExists(siteId);

  const [channels, tags, contents, fragments, friendLinks, redirects, linkWords, adSlots, forms, pages] = await Promise.all([
    db.select().from(cmsChannels).where(eq(cmsChannels.siteId, siteId)),
    db.select().from(cmsTags).where(eq(cmsTags.siteId, siteId)),
    // 回收站内容不导出；归档内容保留
    db.select().from(cmsContents).where(and(eq(cmsContents.siteId, siteId), isNull(cmsContents.deletedAt))),
    db.select().from(cmsFragments).where(eq(cmsFragments.siteId, siteId)),
    db.select().from(cmsFriendLinks).where(eq(cmsFriendLinks.siteId, siteId)),
    db.select().from(cmsRedirects).where(eq(cmsRedirects.siteId, siteId)),
    db.select().from(cmsLinkWords).where(eq(cmsLinkWords.siteId, siteId)),
    db.select().from(cmsAdSlots).where(eq(cmsAdSlots.siteId, siteId)),
    db.select().from(cmsForms).where(eq(cmsForms.siteId, siteId)),
    db.select().from(cmsPages).where(eq(cmsPages.siteId, siteId)),
  ]);

  const contentIds = contents.map((c) => c.id);
  const slotIds = adSlots.map((s) => s.id);
  const [contentTags, contentChannels, contentRelations, ads] = await Promise.all([
    contentIds.length > 0 ? db.select().from(cmsContentTags).where(inArray(cmsContentTags.contentId, contentIds)) : Promise.resolve([]),
    contentIds.length > 0 ? db.select().from(cmsContentChannels).where(inArray(cmsContentChannels.contentId, contentIds)) : Promise.resolve([]),
    contentIds.length > 0 ? db.select().from(cmsContentRelations).where(inArray(cmsContentRelations.contentId, contentIds)) : Promise.resolve([]),
    slotIds.length > 0 ? db.select().from(cmsAds).where(inArray(cmsAds.slotId, slotIds)) : Promise.resolve([]),
  ]);

  // 映射内容：正文/扩展字段透传来源行，导出时物化为独立内容（跨环境不携带映射关系）
  const contentById = new Map(contents.map((c) => [c.id, c]));
  const exportedContents = await Promise.all(contents.map(async (c) => {
    let { body, extend } = c;
    if (c.mappingSourceId) {
      const source = contentById.get(c.mappingSourceId)
        ?? await db.query.cmsContents.findFirst({ where: eq(cmsContents.id, c.mappingSourceId) });
      if (source) {
        body = source.body;
        extend = source.extend;
      }
    }
    return exportRow({ ...c, body, extend }, [
      'siteId', 'searchVector', 'viewCount', 'likeCount', 'favoriteCount', 'version',
      'deletedAt', 'mappingSourceId', 'memberId', 'deptId', 'rejectReason',
    ]);
  }));

  return {
    version: CMS_SITE_EXPORT_VERSION,
    exportedAt: formatDateTime(new Date()),
    site: exportRow(site, ['id', 'isDefault', 'domain', 'aliasDomains', 'tenantId']),
    channels: channels.map((r) => exportRow(r, ['siteId'])),
    tags: tags.map((r) => exportRow(r, ['siteId', 'contentCount'])),
    contents: exportedContents,
    contentTags: contentTags.map((r) => ({ contentId: r.contentId, tagId: r.tagId })),
    contentChannels: contentChannels.map((r) => ({ contentId: r.contentId, channelId: r.channelId })),
    contentRelations: contentRelations.map((r) => ({ contentId: r.contentId, relatedId: r.relatedId, sort: r.sort })),
    fragments: fragments.map((r) => exportRow(r, ['siteId'])),
    friendLinks: friendLinks.map((r) => exportRow(r, ['id', 'siteId'])),
    redirects: redirects.map((r) => exportRow(r, ['id', 'siteId'])),
    linkWords: linkWords.map((r) => exportRow(r, ['id', 'siteId'])),
    adSlots: adSlots.map((r) => exportRow(r, ['siteId'])),
    ads: ads.map((r) => exportRow(r, ['id', 'clickCount', 'viewCount'])),
    forms: forms.map((r) => exportRow(r, ['id', 'siteId'])),
    pages: pages.map((r) => exportRow(r, ['id', 'siteId', 'isHome'])),
  };
}

export type CmsSiteExportPackage = Awaited<ReturnType<typeof exportCmsSite>>;

// ─── 导入 ─────────────────────────────────────────────────────────────────────

/** 站点 code 冲突时自动追加序号找空位 */
async function resolveSiteCode(code: string): Promise<string> {
  const base = String(code || 'imported-site').slice(0, 44);
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await db.query.cmsSites.findFirst({ where: eq(cmsSites.code, candidate), columns: { id: true } });
    if (!exists) return candidate;
  }
  throw new HTTPException(400, { message: '无法为导入站点分配唯一标识，请修改导出包中的站点 code' });
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** 导入整站：创建新站点并重映射全部内部引用。返回新站点 id 与各实体导入数量 */
export async function importCmsSite(payload: unknown) {
  const pkg = payload as Partial<CmsSiteExportPackage> | null;
  if (!pkg || typeof pkg !== 'object' || pkg.version !== CMS_SITE_EXPORT_VERSION || !pkg.site || typeof pkg.site !== 'object') {
    throw new HTTPException(400, { message: '导入文件格式不正确或版本不兼容' });
  }
  const site = pkg.site as PlainRow;
  const code = await resolveSiteCode(str(site.code) ?? 'imported-site');

  return db.transaction(async (tx) => {
    // 1. 站点（域名/默认站标记不迁移，避免与现有站点冲突）
    const [newSite] = await tx.insert(cmsSites).values({
      name: str(site.name) ?? '导入站点',
      code,
      title: str(site.title),
      keywords: str(site.keywords),
      description: str(site.description),
      logo: str(site.logo),
      favicon: str(site.favicon),
      icp: str(site.icp),
      copyright: str(site.copyright),
      theme: str(site.theme) ?? 'default',
      staticMode: (str(site.staticMode) as typeof cmsSites.$inferInsert.staticMode) ?? 'hybrid',
      robots: str(site.robots),
      settings: (site.settings ?? {}) as Record<string, unknown>,
      status: (str(site.status) as typeof cmsSites.$inferInsert.status) ?? 'enabled',
      sort: num(site.sort) ?? 0,
      remark: str(site.remark),
    }).returning();
    const siteId = newSite.id;

    // 2. 栏目树：先父后子逐层插入，重映射 id/parentId
    const channelIdMap = new Map<number, number>();
    const pendingChannels = [...(pkg.channels ?? [])] as PlainRow[];
    let guard = pendingChannels.length * 2 + 10;
    while (pendingChannels.length > 0 && guard-- > 0) {
      const idx = pendingChannels.findIndex((ch) => {
        const parentId = num(ch.parentId) ?? 0;
        return parentId === 0 || channelIdMap.has(parentId);
      });
      if (idx === -1) break; // 剩余栏目父节点缺失：按顶级挂载兜底
      const ch = pendingChannels.splice(idx, 1)[0];
      const oldId = num(ch.id);
      const [created] = await tx.insert(cmsChannels).values({
        siteId,
        parentId: channelIdMap.get(num(ch.parentId) ?? 0) ?? 0,
        name: str(ch.name) ?? '未命名栏目',
        slug: str(ch.slug) ?? `channel-${oldId}`,
        path: str(ch.path) ?? `channel-${oldId}`,
        type: (str(ch.type) as typeof cmsChannels.$inferInsert.type) ?? 'list',
        linkUrl: str(ch.linkUrl),
        listTemplate: str(ch.listTemplate),
        detailTemplate: str(ch.detailTemplate),
        pageSize: num(ch.pageSize) ?? 20,
        pageContent: str(ch.pageContent),
        seoTitle: str(ch.seoTitle),
        seoKeywords: str(ch.seoKeywords),
        seoDescription: str(ch.seoDescription),
        image: str(ch.image),
        visible: ch.visible !== false,
        status: (str(ch.status) as typeof cmsChannels.$inferInsert.status) ?? 'enabled',
        sort: num(ch.sort) ?? 0,
        settings: (ch.settings ?? {}) as Record<string, unknown>,
      }).returning({ id: cmsChannels.id });
      if (oldId !== null) channelIdMap.set(oldId, created.id);
    }
    // 父节点缺失的孤儿栏目挂顶级
    for (const ch of pendingChannels) {
      const oldId = num(ch.id);
      const [created] = await tx.insert(cmsChannels).values({
        siteId, parentId: 0,
        name: str(ch.name) ?? '未命名栏目',
        slug: str(ch.slug) ?? `channel-${oldId}`,
        path: str(ch.slug) ?? `channel-${oldId}`,
        type: 'list',
      }).returning({ id: cmsChannels.id });
      if (oldId !== null) channelIdMap.set(oldId, created.id);
    }

    // 3. 标签
    const tagIdMap = new Map<number, number>();
    for (const tag of (pkg.tags ?? []) as PlainRow[]) {
      const oldId = num(tag.id);
      const [created] = await tx.insert(cmsTags).values({
        siteId,
        name: str(tag.name) ?? `tag-${oldId}`,
        slug: str(tag.slug) ?? `tag-${oldId}`,
      }).returning({ id: cmsTags.id });
      if (oldId !== null) tagIdMap.set(oldId, created.id);
    }

    // 4. 内容（searchVector 重建；发布时间等业务时间保留）
    const contentIdMap = new Map<number, number>();
    for (const c of (pkg.contents ?? []) as PlainRow[]) {
      const oldId = num(c.id);
      const channelId = channelIdMap.get(num(c.channelId) ?? 0);
      if (!channelId) continue; // 栏目缺失的内容跳过
      const title = str(c.title) ?? '未命名内容';
      const [created] = await tx.insert(cmsContents).values({
        siteId,
        channelId,
        modelId: null, // 内容模型为全局实体，跨环境 id 不可靠，导入后由栏目模型重新关联
        contentType: (str(c.contentType) as typeof cmsContents.$inferInsert.contentType) ?? 'article',
        mediaData: (c.mediaData ?? {}) as Record<string, unknown>,
        title,
        subTitle: str(c.subTitle),
        shortTitle: str(c.shortTitle),
        slug: str(c.slug),
        summary: str(c.summary),
        coverImage: str(c.coverImage),
        coverThumb: str(c.coverThumb),
        author: str(c.author),
        editor: str(c.editor),
        source: str(c.source),
        sourceUrl: str(c.sourceUrl),
        isOriginal: c.isOriginal === true,
        body: str(c.body),
        extend: (c.extend ?? {}) as Record<string, unknown>,
        externalLink: str(c.externalLink),
        detailTemplate: str(c.detailTemplate),
        isTop: c.isTop === true,
        topWeight: num(c.topWeight) ?? 0,
        topExpireAt: parseDateTimeInput(str(c.topExpireAt) ?? undefined),
        isRecommend: c.isRecommend === true,
        isHot: c.isHot === true,
        status: (str(c.status) as typeof cmsContents.$inferInsert.status) ?? 'draft',
        publishedAt: parseDateTimeInput(str(c.publishedAt) ?? undefined),
        scheduledAt: parseDateTimeInput(str(c.scheduledAt) ?? undefined),
        expireAt: parseDateTimeInput(str(c.expireAt) ?? undefined),
        archivedAt: parseDateTimeInput(str(c.archivedAt) ?? undefined),
        sort: num(c.sort) ?? 0,
        seoTitle: str(c.seoTitle),
        seoKeywords: str(c.seoKeywords),
        seoDescription: str(c.seoDescription),
        searchVector: buildSearchVector({
          title,
          seoKeywords: str(c.seoKeywords),
          summary: str(c.summary),
          body: str(c.body),
        }),
      }).returning({ id: cmsContents.id });
      if (oldId !== null) contentIdMap.set(oldId, created.id);
    }

    // 5. 内容关联（标签 / 附加栏目 / 相关文章）
    const remappedContentTags = ((pkg.contentTags ?? []) as PlainRow[])
      .map((r) => ({ contentId: contentIdMap.get(num(r.contentId) ?? 0), tagId: tagIdMap.get(num(r.tagId) ?? 0) }))
      .filter((r): r is { contentId: number; tagId: number } => !!r.contentId && !!r.tagId);
    if (remappedContentTags.length > 0) {
      await tx.insert(cmsContentTags).values(remappedContentTags).onConflictDoNothing();
      await tx.update(cmsTags)
        .set({ contentCount: sql<number>`(select count(*)::int from ${cmsContentTags} where ${cmsContentTags.tagId} = ${cmsTags.id})` })
        .where(eq(cmsTags.siteId, siteId));
    }
    const remappedExtraChannels = ((pkg.contentChannels ?? []) as PlainRow[])
      .map((r) => ({ contentId: contentIdMap.get(num(r.contentId) ?? 0), channelId: channelIdMap.get(num(r.channelId) ?? 0) }))
      .filter((r): r is { contentId: number; channelId: number } => !!r.contentId && !!r.channelId);
    if (remappedExtraChannels.length > 0) {
      await tx.insert(cmsContentChannels).values(remappedExtraChannels).onConflictDoNothing();
    }
    const remappedRelations = ((pkg.contentRelations ?? []) as PlainRow[])
      .map((r) => ({ contentId: contentIdMap.get(num(r.contentId) ?? 0), relatedId: contentIdMap.get(num(r.relatedId) ?? 0), sort: num(r.sort) ?? 0 }))
      .filter((r): r is { contentId: number; relatedId: number; sort: number } => !!r.contentId && !!r.relatedId);
    if (remappedRelations.length > 0) {
      await tx.insert(cmsContentRelations).values(remappedRelations).onConflictDoNothing();
    }

    // 6. 站点附属实体
    for (const f of (pkg.fragments ?? []) as PlainRow[]) {
      await tx.insert(cmsFragments).values({
        siteId,
        code: str(f.code) ?? `fragment-${num(f.id)}`,
        name: str(f.name) ?? '未命名碎片',
        type: (str(f.type) as typeof cmsFragments.$inferInsert.type) ?? 'html',
        content: str(f.content),
        status: (str(f.status) as typeof cmsFragments.$inferInsert.status) ?? 'enabled',
        remark: str(f.remark),
      });
    }
    for (const l of (pkg.friendLinks ?? []) as PlainRow[]) {
      await tx.insert(cmsFriendLinks).values({
        siteId,
        name: str(l.name) ?? '未命名链接',
        url: str(l.url) ?? '#',
        logo: str(l.logo),
        status: (str(l.status) as typeof cmsFriendLinks.$inferInsert.status) ?? 'enabled',
        sort: num(l.sort) ?? 0,
        remark: str(l.remark),
      });
    }
    for (const r of (pkg.redirects ?? []) as PlainRow[]) {
      if (!str(r.fromPath) || !str(r.toUrl)) continue;
      await tx.insert(cmsRedirects).values({
        siteId,
        fromPath: str(r.fromPath)!,
        toUrl: str(r.toUrl)!,
        redirectType: num(r.redirectType) ?? 301,
        status: (str(r.status) as typeof cmsRedirects.$inferInsert.status) ?? 'enabled',
        remark: str(r.remark),
      });
    }
    for (const w of (pkg.linkWords ?? []) as PlainRow[]) {
      if (!str(w.keyword) || !str(w.url)) continue;
      await tx.insert(cmsLinkWords).values({
        siteId,
        keyword: str(w.keyword)!,
        url: str(w.url)!,
        maxReplaces: num(w.maxReplaces) ?? 1,
        status: (str(w.status) as typeof cmsLinkWords.$inferInsert.status) ?? 'enabled',
      });
    }
    const slotIdMap = new Map<number, number>();
    for (const s of (pkg.adSlots ?? []) as PlainRow[]) {
      const oldId = num(s.id);
      const [created] = await tx.insert(cmsAdSlots).values({
        siteId,
        code: str(s.code) ?? `slot-${oldId}`,
        name: str(s.name) ?? '未命名广告位',
        remark: str(s.remark),
      }).returning({ id: cmsAdSlots.id });
      if (oldId !== null) slotIdMap.set(oldId, created.id);
    }
    for (const a of (pkg.ads ?? []) as PlainRow[]) {
      const slotId = slotIdMap.get(num(a.slotId) ?? 0);
      if (!slotId) continue;
      await tx.insert(cmsAds).values({
        slotId,
        name: str(a.name) ?? '未命名广告',
        image: str(a.image),
        linkUrl: str(a.linkUrl),
        startAt: parseDateTimeInput(str(a.startAt) ?? undefined),
        endAt: parseDateTimeInput(str(a.endAt) ?? undefined),
        sort: num(a.sort) ?? 0,
        status: (str(a.status) as typeof cmsAds.$inferInsert.status) ?? 'enabled',
      });
    }
    for (const f of (pkg.forms ?? []) as PlainRow[]) {
      await tx.insert(cmsForms).values({
        siteId,
        code: str(f.code) ?? `form-${num(f.id)}`,
        name: str(f.name) ?? '未命名表单',
        fields: (f.fields ?? []) as typeof cmsForms.$inferInsert.fields,
        successMessage: str(f.successMessage),
        notifyEmail: str(f.notifyEmail),
        status: (str(f.status) as typeof cmsForms.$inferInsert.status) ?? 'enabled',
      });
    }
    for (const p of (pkg.pages ?? []) as PlainRow[]) {
      await tx.insert(cmsPages).values({
        siteId,
        name: str(p.name) ?? '未命名页面',
        slug: str(p.slug) ?? `page-${num(p.id)}`,
        isHome: false,
        blocks: (p.blocks ?? []) as typeof cmsPages.$inferInsert.blocks,
        seoTitle: str(p.seoTitle),
        seoKeywords: str(p.seoKeywords),
        seoDescription: str(p.seoDescription),
        status: (str(p.status) as typeof cmsPages.$inferInsert.status) ?? 'enabled',
        remark: str(p.remark),
      });
    }

    return {
      siteId,
      siteName: newSite.name,
      siteCode: newSite.code,
      counts: {
        channels: channelIdMap.size,
        tags: tagIdMap.size,
        contents: contentIdMap.size,
        fragments: (pkg.fragments ?? []).length,
        friendLinks: (pkg.friendLinks ?? []).length,
        redirects: (pkg.redirects ?? []).length,
        linkWords: (pkg.linkWords ?? []).length,
        adSlots: slotIdMap.size,
        ads: (pkg.ads ?? []).length,
        forms: (pkg.forms ?? []).length,
        pages: (pkg.pages ?? []).length,
      },
    };
  });
}
