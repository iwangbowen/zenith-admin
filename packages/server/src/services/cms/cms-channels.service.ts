import { eq, asc, and, inArray, isNull, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { pinyin } from 'pinyin-pro';
import { db } from '../../db';
import { cmsChannels, cmsContents, cmsModels, cmsContentChannels, cmsCollectRules, cmsChannelUsers, users } from '../../db/schema';
import type { CmsChannelRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser } from '../../lib/context';
import type { CreateCmsChannelInput, UpdateCmsChannelInput, CmsChannel } from '@zenith/shared';
import { assertChannelTemplatesBySite } from './cms-template-refs.service';
import {
  assertCompleteCmsBatch, isCmsPlatformAdmin,
} from './cms-access';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertCmsContentsUnlocked } from './cms-content-lock.service';
import { bumpCmsTemplateRefsRevision, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsChannel(row: CmsChannelRow, modelName?: string | null): CmsChannel {
  return {
    id: row.id,
    siteId: row.siteId,
    parentId: row.parentId,
    modelId: row.modelId ?? null,
    modelName: modelName ?? null,
    name: row.name,
    slug: row.slug,
    path: row.path,
    type: row.type,
    linkUrl: row.linkUrl ?? null,
    listTemplate: row.listTemplate ?? null,
    detailTemplate: row.detailTemplate ?? null,
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

/** 平铺列表 → 树（children 按 sort 排序） */
export function buildChannelTree(list: CmsChannel[]): CmsChannel[] {
  const map = new Map<number, CmsChannel>();
  const roots: CmsChannel[] = [];
  for (const item of list) map.set(item.id, { ...item, children: [] });
  for (const item of map.values()) {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(item);
    } else {
      roots.push(item);
    }
  }
  const prune = (nodes: CmsChannel[]) => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) prune(n.children);
      else delete n.children;
    }
  };
  prune(roots);
  return roots;
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsChannelExists(id: number): Promise<CmsChannelRow> {
  const [row] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '栏目不存在' });
  return row;
}

export async function getCmsChannel(id: number) {
  const current = await ensureCmsChannelExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(id);
  const row = await db.query.cmsChannels.findFirst({
    where: eq(cmsChannels.id, id),
    with: { model: { columns: { name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '栏目不存在' });
  return mapCmsChannel(row, row.model?.name);
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
export interface ListCmsChannelsQuery {
  siteId: number;
  status?: 'enabled' | 'disabled';
}

/** 站点栏目树（后台管理 + 前台导航共用底层数据） */
export async function listCmsChannelTree(
  q: ListCmsChannelsQuery,
  options?: { skipAccessCheck?: boolean },
): Promise<CmsChannel[]> {
  let accessible: number[] | null = null;
  if (!options?.skipAccessCheck) {
    await ensureCmsSiteExists(q.siteId);
    await assertSiteAccess(q.siteId);
    accessible = await getAccessibleChannelIds();
  }
  const conditions: SQL[] = [eq(cmsChannels.siteId, q.siteId)];
  if (accessible !== null) conditions.push(inArray(cmsChannels.id, accessible));
  if (q.status) conditions.push(eq(cmsChannels.status, q.status));
  const rows = await db.query.cmsChannels.findMany({
    where: mergeWhere(and(...conditions)),
    with: { model: { columns: { name: true } } },
    orderBy: [asc(cmsChannels.sort), asc(cmsChannels.id)],
  });
  return buildChannelTree(rows.map((r) => mapCmsChannel(r, r.model?.name)));
}

/** 校验 modelId 有效性 */
async function ensureModelValid(modelId: number | null | undefined) {
  if (!modelId) return;
  const [row] = await db.select({ id: cmsModels.id }).from(cmsModels).where(and(
    eq(cmsModels.id, modelId),
  )).limit(1);
  if (!row) throw new HTTPException(400, { message: `指定的内容模型（id=${modelId}）不存在` });
}

/** 计算完整路径（父路径 + 本级 slug）并校验父栏目合法性 */
async function computePath(executor: DbExecutor, siteId: number, parentId: number, slug: string, selfId?: number): Promise<string> {
  if (parentId === 0) return slug;
  const [parent] = await executor.select().from(cmsChannels).where(and(
    eq(cmsChannels.id, parentId),
  )).limit(1);
  if (!parent) throw new HTTPException(400, { message: '父栏目不存在' });
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

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsChannel(data: CreateCmsChannelInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  await ensureModelValid(data.modelId);
  if ((data.parentId ?? 0) !== 0) await assertChannelAccess(data.parentId!);
  await assertChannelTemplatesBySite(data.siteId, {
    listTemplate: data.listTemplate,
    detailTemplate: data.detailTemplate,
    settings: data.settings as Record<string, unknown> | undefined,
  });
  try {
    const row = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, data.siteId);
      await assertChannelTemplatesBySite(data.siteId, {
        listTemplate: data.listTemplate,
        detailTemplate: data.detailTemplate,
        settings: data.settings as Record<string, unknown> | undefined,
      });
      const path = await computePath(tx, data.siteId, data.parentId ?? 0, data.slug);
      const [created] = await tx.insert(cmsChannels).values({
        ...data,
        path,
      }).returning();
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
    rethrowPgUniqueViolation(err, '同站点下已存在相同路径的栏目');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsChannel(id: number, data: UpdateCmsChannelInput) {
  const current = await ensureCmsChannelExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(id);
  await ensureModelValid(data.modelId);
  await assertChannelTemplatesBySite(current.siteId, {
    listTemplate: data.listTemplate,
    detailTemplate: data.detailTemplate,
    settings: data.settings as Record<string, unknown> | undefined,
  });

  const nextParentId = data.parentId ?? current.parentId;
  const nextSlug = data.slug ?? current.slug;
  if (nextParentId === id) throw new HTTPException(400, { message: '父栏目不能是自身' });
  if (nextParentId !== 0 && nextParentId !== current.parentId) {
    await assertChannelAccess(nextParentId);
  }

  try {
    const mutation = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, current.siteId);
      await assertChannelTemplatesBySite(current.siteId, {
        listTemplate: data.listTemplate,
        detailTemplate: data.detailTemplate,
        settings: data.settings as Record<string, unknown> | undefined,
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
      const [updated] = await tx.update(cmsChannels).set({ ...data, path }).where(and(
        eq(cmsChannels.id, id),
      )).returning();
      if (!updated) throw new HTTPException(404, { message: '栏目不存在' });
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
    return getCmsChannel(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同路径的栏目');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────
export async function deleteCmsChannel(id: number) {
  const current = await ensureCmsChannelExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(id);
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
    await tx.delete(cmsChannels).where(eq(cmsChannels.id, id));
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

/** 汉字名称 → 拼音 slug（非拼音字符转中划线，兜底 channel-时间戳） */
export function slugifyChannelName(name: string): string {
  const py = pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-');
  const slug = py.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return slug || `channel-${Date.now()}`;
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

  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, target.siteId);
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

/** 批量新增栏目：同一父栏目下按名称列表创建，slug 自动取拼音（重复自动加序号） */
export async function batchCreateCmsChannels(siteId: number, parentId: number, names: string[]): Promise<number> {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (cleaned.length === 0) throw new HTTPException(400, { message: '请输入至少一个栏目名称' });
  if (parentId !== 0) {
    const parent = await ensureCmsChannelExists(parentId);
    await assertChannelAccess(parentId);
    if (parent.siteId !== siteId) throw new HTTPException(400, { message: '父栏目不属于当前站点' });
  }
  const existing = await db.select({ slug: cmsChannels.slug, path: cmsChannels.path }).from(cmsChannels).where(and(
    eq(cmsChannels.siteId, siteId),
  ));
  const usedPaths = new Set(existing.map((r) => r.path));
  try {
    const mutation = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, siteId);
      let created = 0;
      for (const name of cleaned) {
        let slug = slugifyChannelName(name);
        let path = await computePath(tx, siteId, parentId, slug);
        // 站点内 path 唯一：冲突自动追加序号
        for (let i = 2; usedPaths.has(path) && i < 100; i++) {
          slug = `${slugifyChannelName(name)}-${i}`.slice(0, 100);
          path = await computePath(tx, siteId, parentId, slug);
        }
        usedPaths.add(path);
        const [createdRow] = await tx.insert(cmsChannels).values({
          siteId,
          parentId,
          name,
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
    rethrowPgUniqueViolation(err, '存在与现有栏目重复的路径');
  }
}

// ─── 栏目级数据权限（P5）────────────────────────────────────────────────────────
// 策略：非平台超管必须在 cms_channel_users 中显式绑定；平台超管可绕过。

/** 当前用户可管理的栏目 id 集合；null = 不受限 */
export async function getAccessibleChannelIds(): Promise<number[] | null> {
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
  for (const siteId of new Set(rows.map((row) => row.siteId))) await assertSiteAccess(siteId);
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
