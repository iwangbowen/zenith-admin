import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { eq, asc, and, inArray, isNull, isNotNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { pinyin } from 'pinyin-pro';
import { cmsChannelContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsChannels, cmsContents, cmsModels, cmsContentChannels, cmsCollectRules, cmsChannelUsers, cmsPages, users } from '../../db/schema';
import type { CmsChannelRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentCmsOpenApiAccess, currentUser } from '../../lib/context';
import type { CreateCmsChannelInput, UpdateCmsChannelInput, CmsChannel } from '@zenith/shared/cms';
import { ensureCmsLinkTargetExists, isCmsLinkToChannel } from './cms-link.service';
import { assertChannelTemplatesBySite } from './cms-template-refs.service';
import {
  assertCompleteCmsBatch, isCmsPlatformAdmin,
} from './cms-access';
import { assertSiteAccess, assertSitesAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertCmsContentsUnlocked } from './cms-content-lock.service';
import { bumpCmsTemplateRefsRevision, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import { canonicalizeCmsResourceFields, deleteCmsResourceRefsForOwner, syncCmsResourceRefs, resolveCmsResourcePayload } from './cms-resource-refs.service';
import { assertCmsWidgetChannelVisibilityMutable, assertCmsWidgetSourcesMutable } from './cms-widgets.service';
import { submitCmsWidgetChannelRefreshSideEffect, submitCmsWidgetSourceRefreshSideEffect } from './cms-widget-tasks';
import { sanitizeCmsHtml } from './cms-html-sanitizer';
import { resolveEffectivelyEnabledChannelIds } from './cms-channel-visibility.service';
import { buildTree } from '@zenith/shared/core';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsChannel(row: CmsChannelRow, modelName?: string | null): CmsChannel {
  return {
    id: row.id,
    siteId: row.siteId,
    parentId: row.parentId,
    modelId: row.modelId ?? null,
    modelName: modelName ?? null,
    name: row.name,
    code: row.code,
    slug: row.slug,
    path: row.path,
    type: row.type,
    linkUrl: row.linkUrl ?? null,
    listTemplate: row.listTemplate ?? null,
    detailTemplate: row.detailTemplate ?? null,
    staticMode: row.staticMode,
    detailPathRule: row.detailPathRule,
    pageSize: row.pageSize,
    pageContent: row.pageContent ?? null,
    seoTitle: row.seoTitle ?? null,
    seoKeywords: row.seoKeywords ?? null,
    seoDescription: row.seoDescription ?? null,
    image: row.image ?? null,
    visible: row.visible,
    status: row.status,
    sort: row.sort,
    settings: row.settings ?? {},
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 平铺列表 → 树（保持入参的 sort 顺序） */
export function buildChannelTree(list: CmsChannel[]): CmsChannel[] {
  return buildTree(list);
}

/** Sanitize the only HTML-bearing channel field before it reaches persistence. */
function sanitizeChannelPageContent<T extends { pageContent?: string | null }>(data: T): T {
  if (data.pageContent === undefined || data.pageContent === null) return data;
  return { ...data, pageContent: sanitizeCmsHtml(data.pageContent) };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsChannelExists(id: number): Promise<CmsChannelRow> {
  const [row] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, id)).limit(1);
  return requireRow(row, '栏目不存在');
}

/** 按栏目标识查栏目（开放 API / 模板按 code 引用栏目时用） */
export async function findCmsChannelByCode(siteId: number, code: string): Promise<CmsChannelRow | null> {
  const [row] = await db.select().from(cmsChannels)
    .where(and(eq(cmsChannels.siteId, siteId), eq(cmsChannels.code, code)))
    .limit(1);
  return row ?? null;
}

export async function getCmsChannel(id: number) {
  const current = await ensureCmsChannelExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(id);
  const row = await db.query.cmsChannels.findFirst({
    where: eq(cmsChannels.id, id),
    with: { model: { columns: { name: true } } },
  });
  const channel = requireRow(row, '栏目不存在');
  return resolveCmsResourcePayload(mapCmsChannel(channel, channel.model?.name), current.siteId);
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
/** 站点栏目树（后台管理 + 前台导航共用底层数据） */
export async function listCmsChannelTree(
  q: QueryOutputOf<typeof cmsChannelContract.tree>,
  options?: { skipAccessCheck?: boolean },
): Promise<CmsChannel[]> {
  let accessible: number[] | null = null;
  if (!options?.skipAccessCheck) {
    await ensureCmsSiteExists(q.siteId);
    await assertSiteAccess(q.siteId);
    accessible = await getAccessibleChannelIds();
  }
  const rows = await db.query.cmsChannels.findMany({
    where: buildWhere(
      eq(cmsChannels.siteId, q.siteId),
      accessible === null ? undefined : inArray(cmsChannels.id, accessible),
      // When callers ask for enabled channels, load the parent rows as well so a
      // child under a disabled ancestor cannot be promoted to a new tree root.
      q.status && q.status !== 'enabled' ? eq(cmsChannels.status, q.status) : undefined,
    ),
    with: { model: { columns: { name: true } } },
    orderBy: [asc(cmsChannels.sort), asc(cmsChannels.id)],
  });
  const channelStates = q.status === 'enabled'
    ? await db.select({ id: cmsChannels.id, parentId: cmsChannels.parentId, status: cmsChannels.status })
      .from(cmsChannels).where(eq(cmsChannels.siteId, q.siteId))
    : [];
  const enabledIds = q.status === 'enabled' ? resolveEffectivelyEnabledChannelIds(channelStates) : null;
  const visibleRows = enabledIds ? rows.filter((row) => enabledIds.has(row.id)) : rows;
  return resolveCmsResourcePayload(buildChannelTree(visibleRows.map((r) => mapCmsChannel(r, r.model?.name))), q.siteId);
}

/** 校验 modelId 有效性（含站群可见性：专属模型仅归属站点可绑定） */
async function ensureModelValid(modelId: number | null | undefined, siteId: number) {
  if (!modelId) return;
  const [row] = await db.select({ id: cmsModels.id, name: cmsModels.name, ownerSiteId: cmsModels.ownerSiteId }).from(cmsModels).where(and(
    eq(cmsModels.id, modelId),
  )).limit(1);
  requireRow(row, `指定的内容模型（id=${modelId}）不存在`, 400);
  if (row.ownerSiteId != null && row.ownerSiteId !== siteId) {
    throw new HTTPException(400, { message: `模型「${row.name}」归属其他站点，当前站点不可绑定` });
  }
}

/**
 * 栏目路径不得与搭建页自定义访问路径冲突。
 *
 * 前台路由里搭建页自定义路径排在栏目解析之前，冲突会让整个栏目静默失联，
 * 因此两侧对称拦截（页面侧见 cms-pages.service 的 assertCustomPagePathFree）。
 */
async function assertChannelPathFree(executor: DbExecutor, siteId: number, path: string): Promise<void> {
  const pages = await executor.select({ name: cmsPages.name, path: cmsPages.path }).from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), isNotNull(cmsPages.path)));
  const hit = pages.find((p) => p.path && (p.path === path || p.path.startsWith(`${path}/`)));
  if (hit) {
    throw new HTTPException(400, { message: `栏目路径与搭建页「${hit.name}」的自定义访问路径（${hit.path}）冲突` });
  }
}

/** 计算完整路径（父路径 + 本级 slug）并校验父栏目合法性 */
async function computePath(executor: DbExecutor, siteId: number, parentId: number, slug: string, selfId?: number): Promise<string> {
  if (parentId === 0) return slug;
  const [parent] = await executor.select().from(cmsChannels).where(and(
    eq(cmsChannels.id, parentId),
  )).limit(1);
  requireRow(parent, '父栏目不存在', 400);
  if (parent.siteId !== siteId) throw new HTTPException(400, { message: '父栏目不属于当前站点' });
  if (selfId && parent.id === selfId) throw new HTTPException(400, { message: '父栏目不能是自身' });
  return `${parent.path}/${slug}`;
}

/** 递归重算子树 path（栏目改 slug / 挪动后调用） */
async function recomputeChildPaths(executor: DbExecutor, channelId: number, newPath: string): Promise<void> {
  const children = await executor.select().from(cmsChannels).where(and(
    eq(cmsChannels.parentId, channelId),
  ));
  for (const child of children) {
    const childPath = `${newPath}/${child.slug}`;
    await executor.update(cmsChannels).set({ path: childPath }).where(and(
      eq(cmsChannels.id, child.id),
    ));
    await recomputeChildPaths(executor, child.id, childPath);
  }
}

async function listChannelSubtreeIds(executor: DbExecutor, rootId: number): Promise<number[]> {
  const result: number[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    const children = await executor.select({ id: cmsChannels.id }).from(cmsChannels)
      .where(eq(cmsChannels.parentId, current));
    queue.push(...children.map((child) => child.id));
  }
  return result;
}

/**
 * 生成站内唯一的栏目标识：优先用传入值，留空时取 slug，冲突则追加 -2 / -3…
 *
 * 只在写入前做一次「查重 + 补后缀」，真正的唯一性仍由
 * `cms_channels_site_code_uq` 兜底（并发写入由 rethrowPgUniqueViolation 转成 400）。
 */
async function resolveChannelCode(
  executor: DbExecutor,
  siteId: number,
  preferred: string | null | undefined,
  fallbackSlug: string,
  selfId?: number,
): Promise<string> {
  const base = (preferred?.trim() || fallbackSlug).slice(0, 50);
  const taken = await executor.select({ code: cmsChannels.code, id: cmsChannels.id })
    .from(cmsChannels).where(eq(cmsChannels.siteId, siteId));
  const used = new Set(taken.filter((r) => r.id !== selfId).map((r) => r.code));
  if (!used.has(base)) return base;
  // 用户显式填了 code 却撞车时直接报错，不要偷偷改成别的值
  if (preferred?.trim()) throw new HTTPException(400, { message: `栏目标识「${base}」在本站点已被占用` });
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 50 - String(i).length - 1)}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new HTTPException(400, { message: '无法生成唯一的栏目标识，请手动填写' });
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsChannel(data: CreateCmsChannelInput) {
  const safeData = sanitizeChannelPageContent(data);
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  await ensureModelValid(data.modelId, data.siteId);
  if ((data.parentId ?? 0) !== 0) await assertChannelAccess(data.parentId!);
  await assertChannelTemplatesBySite(data.siteId, {
    listTemplate: data.listTemplate,
    detailTemplate: data.detailTemplate,
  });
  await ensureCmsLinkTargetExists(data.siteId, data.linkUrl);
  try {
    const row = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, data.siteId);
      await assertChannelTemplatesBySite(data.siteId, {
        listTemplate: data.listTemplate,
        detailTemplate: data.detailTemplate,
      });
      const path = await computePath(tx, data.siteId, data.parentId ?? 0, data.slug);
      await assertChannelPathFree(tx, data.siteId, path);
      const code = await resolveChannelCode(tx, data.siteId, data.code, data.slug);
      const [created] = await tx.insert(cmsChannels).values({
        ...await canonicalizeCmsResourceFields(tx, data.siteId, safeData, 'channel'),
        code,
        path,
      }).returning();
      await syncCmsResourceRefs(tx, 'channel', created.id, created.siteId, created);
      if (!isCmsPlatformAdmin()) {
        await tx.insert(cmsChannelUsers).values({
          channelId: created.id,
          userId: currentUser().userId,
        });
      }
      const revision = await bumpCmsTemplateRefsRevision(tx, data.siteId);
      const task = await insertCmsSiteRefsRebuildOutbox(
        tx,
        { ...site, templateRefsRevision: revision },
        '栏目模板引用创建',
        `site:${data.siteId}:refs:${revision}`,
      );
      return { created, task };
    });
    await enqueueCmsPublishOutboxes([row.task], `栏目 #${row.created.id} 创建`);
    return getCmsChannel(row.created.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同路径或栏目标识的栏目');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsChannel(id: number, data: UpdateCmsChannelInput) {
  const safeData = sanitizeChannelPageContent(data);
  const current = await ensureCmsChannelExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(id);
  if (data.status === 'disabled' && current.status !== 'disabled') {
    await assertCmsWidgetChannelVisibilityMutable([id]);
  }
  await ensureModelValid(data.modelId, current.siteId);
  await assertChannelTemplatesBySite(current.siteId, {
    listTemplate: data.listTemplate,
    detailTemplate: data.detailTemplate,
  });

  const nextParentId = data.parentId ?? current.parentId;
  const nextSlug = data.slug ?? current.slug;
  if (nextParentId === id) throw new HTTPException(400, { message: '父栏目不能是自身' });
  if (nextParentId !== 0 && nextParentId !== current.parentId) {
    await assertChannelAccess(nextParentId);
  }
  if (data.linkUrl !== undefined) {
    await ensureCmsLinkTargetExists(current.siteId, data.linkUrl);
    // 链接型栏目指向自身会形成 302 死循环（id 引用与 code 引用两种写法都要拦）
    if (isCmsLinkToChannel(data.linkUrl, current)) {
      throw new HTTPException(400, { message: '内部链接不能指向栏目自身' });
    }
  }

  try {
    const mutation = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, current.siteId);
      if (data.type !== undefined && data.type !== current.type) {
        const contentCount = await tx.$count(cmsContents, eq(cmsContents.channelId, id));
        if (contentCount > 0) {
          throw new HTTPException(409, { message: '已有内容的栏目不能切换类型，请先迁移内容' });
        }
      }
      if (data.status === 'disabled' && current.status !== 'disabled') {
        await assertCmsWidgetChannelVisibilityMutable([id], tx);
      }
      await assertChannelTemplatesBySite(current.siteId, {
        listTemplate: data.listTemplate,
        detailTemplate: data.detailTemplate,
      });
      // 防环：新父栏目不能是自身后代
      if (nextParentId !== 0 && nextParentId !== current.parentId) {
        let cursor: number = nextParentId;
        while (cursor !== 0) {
          if (cursor === id) throw new HTTPException(400, { message: '父栏目不能是自身的子栏目' });
          const [p] = await tx.select({ parentId: cmsChannels.parentId }).from(cmsChannels).where(and(
            eq(cmsChannels.id, cursor),
          )).limit(1);
          if (!p) break;
          cursor = p.parentId;
        }
      }
      const path = await computePath(tx, current.siteId, nextParentId, nextSlug, id);
      await assertChannelPathFree(tx, current.siteId, path);
      const code = data.code === undefined
        ? current.code
        : await resolveChannelCode(tx, current.siteId, data.code, nextSlug, id);
      const [updated] = await tx.update(cmsChannels)
        .set({ ...await canonicalizeCmsResourceFields(tx, current.siteId, safeData, 'channel'), code, path })
        .where(and(
          eq(cmsChannels.id, id),
        )).returning();
      requireRow(updated, '栏目不存在');
      if (updated.status !== current.status || updated.path !== current.path
        || updated.code !== current.code || updated.detailPathRule !== current.detailPathRule) {
        // 栏目启停等同其下内容的整体上下线（publicWhere / 增量同步都按栏目状态判定可见性）。
        // 内容行本身没被改动，不 bump updated_at 的话 Headless 增量同步永远推不出这批变更，
        // 集成方本地会残留一批前台已经看不到的内容。
        const affectedChannelIds = await listChannelSubtreeIds(tx, id);
        await tx.update(cmsContents).set({ updatedAt: new Date() }).where(inArray(cmsContents.channelId, affectedChannelIds));
      }
      await syncCmsResourceRefs(tx, 'channel', updated.id, updated.siteId, updated);
      if (path !== current.path) {
        await recomputeChildPaths(tx, id, path);
      }
      const revision = await bumpCmsTemplateRefsRevision(tx, current.siteId);
      const task = await insertCmsSiteRefsRebuildOutbox(
        tx,
        { ...site, templateRefsRevision: revision },
        '栏目模板引用更新',
        `site:${current.siteId}:refs:${revision}`,
      );
      return { task };
    });
    await enqueueCmsPublishOutboxes([mutation.task], `栏目 #${id} 更新`);
    submitCmsWidgetChannelRefreshSideEffect([id]);
    return getCmsChannel(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同路径或栏目标识的栏目');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────
export async function deleteCmsChannel(id: number) {
  const current = await ensureCmsChannelExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(id);
  await assertCmsWidgetSourcesMutable('channel', [id]);
  const [childCount, contentCount, collectRuleCount] = await Promise.all([
    db.$count(cmsChannels, eq(cmsChannels.parentId, id)),
    db.$count(cmsContents, eq(cmsContents.channelId, id)),
    db.$count(cmsCollectRules, eq(cmsCollectRules.channelId, id)),
  ]);
  if (childCount > 0) throw new HTTPException(400, { message: '存在子栏目，请先删除子栏目' });
  if (contentCount > 0) throw new HTTPException(400, { message: `栏目下存在 ${contentCount} 条内容，请先移除内容` });
  if (collectRuleCount > 0) throw new HTTPException(400, { message: `栏目被 ${collectRuleCount} 条采集规则引用，请先调整采集规则` });
  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, current.siteId);
    await assertCmsWidgetSourcesMutable('channel', [id], tx);
    await tx.delete(cmsChannels).where(eq(cmsChannels.id, id));
    await deleteCmsResourceRefsForOwner(tx, 'channel', [id], current.siteId);
    const revision = await bumpCmsTemplateRefsRevision(tx, current.siteId);
    const task = await insertCmsSiteRefsRebuildOutbox(
      tx,
      { ...site, templateRefsRevision: revision },
      '栏目模板引用删除',
      `site:${current.siteId}:refs:${revision}`,
    );
    return { task };
  });
  await enqueueCmsPublishOutboxes([mutation.task], `栏目 #${id} 删除`);
}

// ─── 栏目运维（P1：合并 / 清空 / 批量新增 / 拼音 slug）─────────────────────────

/**
 * 汉字名称 → 拼音 slug（非拼音字符转中划线，兜底 channel-时间戳）。
 * strategy：initials=首字母缩写（政务公开→zwgk，国内政府/企业站 URL 惯例）；pinyin=逐字全拼。
 */
export function slugifyChannelName(name: string, strategy: 'initials' | 'pinyin' = 'pinyin'): string {
  const py = strategy === 'initials'
    ? pinyin(name, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('')
    : pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-');
  const slug = py.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return slug || `channel-${Date.now()}`;
}

/** 批量新增的行解析：支持「名称|slug」显式指定 slug，未指定时按策略自动生成 */
function parseBatchChannelEntry(entry: string, strategy: 'initials' | 'pinyin'): { name: string; slug: string } {
  const [rawName, rawSlug] = entry.split('|', 2).map((part) => part.trim());
  const name = rawName ?? '';
  const explicit = rawSlug
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return { name, slug: explicit || slugifyChannelName(name, strategy) };
}

/**
 * 栏目合并：把多个来源栏目的内容并入目标栏目，随后删除来源栏目。
 * 约束：来源/目标同站点、均为列表栏目、来源无子栏目、目标不在来源之列。
 */
export async function mergeCmsChannels(sourceIds: number[], targetId: number): Promise<number> {
  const uniqueSources = [...new Set(sourceIds)].filter((id) => id !== targetId);
  if (uniqueSources.length === 0) throw new HTTPException(400, { message: '请选择至少一个来源栏目（不能是目标栏目自身）' });
  const target = await ensureCmsChannelExists(targetId);
  await assertSiteAccess(target.siteId);
  await assertChannelsAccess([...uniqueSources, targetId]);
  if (target.type !== 'list') throw new HTTPException(400, { message: '目标栏目须为列表栏目' });
  const sources = await db.select().from(cmsChannels).where(and(
    inArray(cmsChannels.id, uniqueSources),
  ));
  assertCompleteCmsBatch(uniqueSources, sources.map((row) => row.id), '栏目');
  for (const src of sources) {
    if (src.siteId !== target.siteId) throw new HTTPException(400, { message: `栏目「${src.name}」与目标栏目不属于同一站点` });
    if (src.type !== 'list') throw new HTTPException(400, { message: `栏目「${src.name}」不是列表栏目，无法合并` });
  }
  const childCount = await db.$count(cmsChannels, and(
    inArray(cmsChannels.parentId, uniqueSources),
  ));
  if (childCount > 0) throw new HTTPException(400, { message: '来源栏目存在子栏目，请先处理子栏目' });
  const sourceContents = await db.select({ id: cmsContents.id }).from(cmsContents)
    .where(inArray(cmsContents.channelId, uniqueSources));
  await assertCmsContentsUnlocked(sourceContents.map((row) => row.id));
  await assertCmsWidgetSourcesMutable('channel', uniqueSources);

  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, target.siteId);
    await assertCmsWidgetSourcesMutable('channel', uniqueSources, tx);
    // 主栏目迁移（含回收站内容，保证来源栏目可删）
    const moved = await tx.update(cmsContents)
      .set({ channelId: targetId, modelId: target.modelId ?? null })
      .where(and(inArray(cmsContents.channelId, uniqueSources), isNull(cmsContents.lockedAt)))
      .returning({ id: cmsContents.id });
    // 副栏目绑定重指向：先清掉「已在目标栏目/主栏目即目标」的冗余绑定，再整体改指向
    await tx.delete(cmsContentChannels).where(and(
      inArray(cmsContentChannels.channelId, uniqueSources),
      inArray(cmsContentChannels.contentId, tx.select({ id: cmsContents.id }).from(cmsContents).where(and(
        eq(cmsContents.channelId, targetId),
      ))),
    ));
    await tx.delete(cmsContentChannels).where(and(
      inArray(cmsContentChannels.channelId, uniqueSources),
      inArray(cmsContentChannels.contentId, tx.select({ contentId: cmsContentChannels.contentId }).from(cmsContentChannels).where(and(
        eq(cmsContentChannels.channelId, targetId),
      ))),
    ));
    await tx.update(cmsContentChannels)
      .set({ channelId: targetId })
      .where(and(
        inArray(cmsContentChannels.channelId, uniqueSources),
      ));
    await tx.update(cmsCollectRules)
      .set({ channelId: targetId })
      .where(and(
        inArray(cmsCollectRules.channelId, uniqueSources),
      ));
    // 目标栏目自身内容若曾以来源栏目为副栏目，上一步已清理；删除来源栏目
    await tx.delete(cmsChannels).where(and(
      inArray(cmsChannels.id, uniqueSources),
    ));
    await deleteCmsResourceRefsForOwner(tx, 'channel', uniqueSources, target.siteId);
    const revision = await bumpCmsTemplateRefsRevision(tx, target.siteId);
    const task = await insertCmsSiteRefsRebuildOutbox(
      tx,
      { ...site, templateRefsRevision: revision },
      '栏目合并与模板继承更新',
      `site:${target.siteId}:refs:${revision}`,
    );
    return { count: moved.length, task };
  });
  await enqueueCmsPublishOutboxes([mutation.task], '栏目合并');
  submitCmsWidgetSourceRefreshSideEffect('content', sourceContents.map((row) => row.id));
  return mutation.count;
}

/** 清空栏目：栏目下全部未删除内容移入回收站（不含子栏目） */
export async function clearCmsChannel(id: number): Promise<number> {
  const channel = await ensureCmsChannelExists(id);
  await assertSiteAccess(channel.siteId);
  await assertChannelAccess(id);
  const contents = await db.select({ id: cmsContents.id }).from(cmsContents)
    .where(and(eq(cmsContents.channelId, id), isNull(cmsContents.deletedAt)));
  await assertCmsContentsUnlocked(contents.map((row) => row.id));
  const { recycleCmsContents } = await import('./cms-contents.service');
  return recycleCmsContents(contents.map((row) => row.id));
}

/**
 * 批量新增栏目：同一父栏目下按行创建。
 * 行支持「名称|slug」显式指定；未指定时按 slugStrategy 自动生成（默认首字母缩写），重复自动加序号。
 */
export async function batchCreateCmsChannels(
  siteId: number,
  parentId: number,
  names: string[],
  slugStrategy: 'initials' | 'pinyin' = 'initials',
): Promise<number> {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const entries = names.map((n) => parseBatchChannelEntry(n, slugStrategy)).filter((e) => e.name);
  const seen = new Set<string>();
  const cleaned = entries.filter((e) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
  if (cleaned.length === 0) throw new HTTPException(400, { message: '请输入至少一个栏目名称' });
  if (parentId !== 0) {
    const parent = await ensureCmsChannelExists(parentId);
    await assertChannelAccess(parentId);
    if (parent.siteId !== siteId) throw new HTTPException(400, { message: '父栏目不属于当前站点' });
  }
  const existing = await db.select({ code: cmsChannels.code, path: cmsChannels.path }).from(cmsChannels).where(and(
    eq(cmsChannels.siteId, siteId),
  ));
  const usedPaths = new Set(existing.map((r) => r.path));
  // 搭建页自定义路径一并占位：批量建栏目时按冲突自动改名，而不是中途报错
  const pagePaths = await db.select({ path: cmsPages.path }).from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), isNotNull(cmsPages.path)));
  for (const row of pagePaths) if (row.path) usedPaths.add(row.path);
  const usedCodes = new Set(existing.map((r) => r.code));
  try {
    const mutation = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, siteId);
      let created = 0;
      for (const entry of cleaned) {
        const { name } = entry;
        let slug = entry.slug;
        let path = await computePath(tx, siteId, parentId, slug);
        // 站点内 path 唯一：冲突自动追加序号
        for (let i = 2; usedPaths.has(path) && i < 100; i++) {
          slug = `${entry.slug}-${i}`.slice(0, 100);
          path = await computePath(tx, siteId, parentId, slug);
        }
        usedPaths.add(path);
        // code 站点内唯一，与 path 分开去重（同名不同层级时 slug 可能已被别处占用）
        let code = slug.slice(0, 50);
        for (let i = 2; usedCodes.has(code) && i < 1000; i++) {
          code = `${slug.slice(0, 50 - String(i).length - 1)}-${i}`;
        }
        usedCodes.add(code);
        const [createdRow] = await tx.insert(cmsChannels).values({
          siteId,
          parentId,
          name,
          code,
          slug,
          path,
          type: 'list',
        }).returning({ id: cmsChannels.id });
        if (!isCmsPlatformAdmin()) {
          await tx.insert(cmsChannelUsers).values({
            channelId: createdRow.id,
            userId: currentUser().userId,
          });
        }
        created += 1;
      }
      if (!created) return { count: 0, task: null };
      const revision = await bumpCmsTemplateRefsRevision(tx, siteId);
      const task = await insertCmsSiteRefsRebuildOutbox(
        tx,
        { ...site, templateRefsRevision: revision },
        '批量创建栏目',
        `site:${siteId}:refs:${revision}`,
      );
      return { count: created, task };
    });
    if (mutation.task) await enqueueCmsPublishOutboxes([mutation.task], '批量创建栏目');
    return mutation.count;
  } catch (err) {
    rethrowPgUniqueViolation(err, '存在与现有栏目重复的路径或栏目标识');
  }
}

// ─── 栏目级数据权限（P5）────────────────────────────────────────────────────────
// 策略：非平台超管必须在 cms_channel_users 中显式绑定；平台超管可绕过。

/** 当前用户可管理的栏目 id 集合；null = 不受限 */
export async function getAccessibleChannelIds(): Promise<number[] | null> {
  const openAccess = currentCmsOpenApiAccess();
  if (openAccess) return openAccess.channelIds.length > 0 ? [...openAccess.channelIds] : null;
  const user = currentUser();
  if (isCmsPlatformAdmin(user)) return null;
  const rows = await db.select({ channelId: cmsChannelUsers.channelId }).from(cmsChannelUsers).where(and(
    eq(cmsChannelUsers.userId, user.userId),
  ));
  return rows.map((r) => r.channelId);
}

/** 栏目访问断言：同时校验对象存在性、站点绑定与栏目显式绑定。 */
export async function assertChannelAccess(channelId: number): Promise<void> {
  const channel = await ensureCmsChannelExists(channelId);
  await assertSiteAccess(channel.siteId);
  const openAccess = currentCmsOpenApiAccess();
  if (openAccess) {
    if (openAccess.channelIds.length > 0 && !openAccess.channelIds.includes(channelId)) {
      throw new HTTPException(403, { message: '开放应用未授权该栏目' });
    }
    return;
  }
  const ids = await getAccessibleChannelIds();
  if (ids !== null && !ids.includes(channelId)) {
    throw new HTTPException(403, { message: '无权管理该栏目下的内容' });
  }
}

/** 批量栏目访问断言（批量内容操作按 distinct 栏目校验） */
export async function assertChannelsAccess(channelIds: number[]): Promise<void> {
  const unique = [...new Set(channelIds)];
  if (unique.length === 0) return;
  const rows = await db.select({
    id: cmsChannels.id,
    siteId: cmsChannels.siteId,
  }).from(cmsChannels).where(inArray(cmsChannels.id, unique));
  assertCompleteCmsBatch(unique, rows.map((row) => row.id), '栏目');
  await assertSitesAccess(rows.map((row) => row.siteId), '无权管理该站点');
  const openAccess = currentCmsOpenApiAccess();
  if (openAccess) {
    if (rows.some((row) => row.siteId !== openAccess.siteId)) {
      throw new HTTPException(403, { message: '开放应用未授权该站点' });
    }
    if (openAccess.channelIds.length > 0 && unique.some((id) => !openAccess.channelIds.includes(id))) {
      throw new HTTPException(403, { message: '所选栏目超出开放应用授权范围' });
    }
    return;
  }
  const ids = await getAccessibleChannelIds();
  if (ids === null) return;
  const denied = unique.filter((id) => !ids.includes(id));
  if (denied.length > 0) {
    throw new HTTPException(403, { message: '所选内容中包含无权管理的栏目' });
  }

}

export async function assertAllCmsSiteChannelsAccess(siteId: number): Promise<void> {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const rows = await db.select({ id: cmsChannels.id }).from(cmsChannels).where(and(
    eq(cmsChannels.siteId, siteId),
  ));
  await assertChannelsAccess(rows.map((row) => row.id));
}

/** 栏目授权用户列表 */
async function loadCmsChannelUsers(channel: CmsChannelRow) {
  const rows = await db.query.cmsChannelUsers.findMany({
    where: and(
      eq(cmsChannelUsers.channelId, channel.id),
    ),
    with: { user: { columns: { id: true, username: true, nickname: true } } },
  });
  return {
    userIds: rows.map((r) => r.userId),
    users: rows.map((r) => ({ id: r.user.id, username: r.user.username, nickname: r.user.nickname })),
  };
}

export async function getCmsChannelUsers(channelId: number) {
  const channel = await ensureCmsChannelExists(channelId);
  await assertChannelAccess(channelId);
  return loadCmsChannelUsers(channel);
}

/** 原子替换栏目授权用户 */
export async function setCmsChannelUsers(channelId: number, userIds: number[]) {
  const channel = await ensureCmsChannelExists(channelId);
  await assertChannelAccess(channelId);
  const unique = [...new Set(userIds)];
  if (unique.length > 0) {
    const valid = await db.select({ id: users.id }).from(users).where(inArray(users.id, unique));
    if (valid.length !== unique.length) throw new HTTPException(400, { message: '存在无效用户' });
  }
  await db.transaction(async (tx) => {
    await tx.delete(cmsChannelUsers).where(and(
      eq(cmsChannelUsers.channelId, channelId),
    ));
    if (unique.length > 0) {
      await tx.insert(cmsChannelUsers).values(unique.map((userId) => ({
        channelId,
        userId,
      })));
    }
  });
  return loadCmsChannelUsers(channel);
}
