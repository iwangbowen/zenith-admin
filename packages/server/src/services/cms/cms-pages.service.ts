/** 可视化页面（区块装配）CRUD 与前台查询 */
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { and, desc, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsPageBlockAcls, cmsPages, cmsChannels, cmsContents } from '../../db/schema';
import type { CmsPageRow } from '../../db/schema';
import type { CmsPageBlock } from '@zenith/shared/cms';
import { formatDateTime } from '../../lib/datetime';
import { withPagination, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import { ensureCmsSiteExists } from './cms-sites.service';
import { cmsPageRequiresDynamic, sanitizeCmsPageBlocks } from './cms-page-blocks';
import type { DbExecutor } from '../../db/types';
import { bumpCmsTemplateRefsRevision, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import { canonicalizeCmsResourceContent, deleteCmsResourceRefsForOwner, syncCmsResourceRefs, resolveCmsResourcePayload } from './cms-resource-refs.service';
import {
  assertCmsPageBlocksUpdateAllowed,
  decorateCmsPageBlocks,
  decorateCmsPageBlocksBatch,
} from './cms-page-acl.service';
import { hasPermission } from '../../lib/context';
import { deleteCmsPageWidgetRefs, syncCmsPageWidgetRefs } from './cms-widgets.service';

export function mapCmsPage(row: CmsPageRow, blocks?: CmsPageBlock[]) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    slug: row.slug,
    path: row.path ?? null,
    isHome: row.isHome,
    blocks: blocks ?? (row.blocks ?? []) as CmsPageBlock[],
    requiresDynamic: row.requiresDynamic,
    seoTitle: row.seoTitle ?? null,
    seoKeywords: row.seoKeywords ?? null,
    seoDescription: row.seoDescription ?? null,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listCmsPages(params: { page: number; pageSize: number; siteId: number; keyword?: string }) {
  await ensureCmsSiteExists(params.siteId);
  await assertSiteAccess(params.siteId);
  const conds = [eq(cmsPages.siteId, params.siteId), keywordCondition(params.keyword, [cmsPages.name, cmsPages.slug], 'ilike')];
  const where = and(...conds);
  return buildListResult({
    page: params.page,
    pageSize: params.pageSize,
    count: () => db.$count(cmsPages, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(cmsPages).where(where).orderBy(desc(cmsPages.id)).$dynamic(), params.page, params.pageSize);
      const decorated = await decorateCmsPageBlocksBatch(rows);
      return rows.map((row) => mapCmsPage(row, decorated.get(row.id)));
    },
  });
}

export async function getCmsPage(id: number) {
  const [row] = await db.select().from(cmsPages).where(eq(cmsPages.id, id)).limit(1);
  requireRow(row, '页面不存在');
  await assertSiteAccess(row.siteId);
  return resolveCmsResourcePayload(mapCmsPage(row, await decorateCmsPageBlocks(row)), row.siteId);
}

const SLUG_RE = /^[a-z0-9-]+$/;

export interface CmsPageInput {
  siteId: number;
  name: string;
  slug: string;
  path?: string | null;
  isHome?: boolean;
  blocks?: CmsPageBlock[];
  seoTitle?: string | null;
  seoKeywords?: string | null;
  seoDescription?: string | null;
  status?: 'enabled' | 'disabled';
  remark?: string | null;
}

/**
 * 自定义访问路径冲突校验。
 *
 * 自定义路径在前台路由里排在栏目/详情解析之前，若与栏目路径撞车会静默吞掉整个栏目，
 * 所以必须在保存时拦死。栏目侧有对称校验（见 cms-channels.service 的 assertChannelPathFree）。
 */
async function assertCustomPagePathFree(executor: DbExecutor, siteId: number, path: string | null | undefined, exceptId?: number): Promise<void> {
  if (!path) return;
  // 栏目路径本身、以及其命名空间下的详情/分页路径都不能被占用
  // （前台自定义路径先于栏目与详情解析，撞上就会静默吞掉整个栏目或某篇内容）
  const channels = await executor.select({ path: cmsChannels.path, name: cmsChannels.name })
    .from(cmsChannels).where(eq(cmsChannels.siteId, siteId));
  const channel = channels.find((c) => path === c.path || path.startsWith(`${c.path}/`));
  if (channel) {
    throw new HTTPException(400, { message: `访问路径落在栏目「${channel.name}」（${channel.path}）的路径空间内` });
  }
  const [content] = await executor.select({ id: cmsContents.id, title: cmsContents.title })
    .from(cmsContents).where(and(
      eq(cmsContents.siteId, siteId),
      eq(cmsContents.staticPath, path),
    )).limit(1);
  if (content) {
    throw new HTTPException(400, { message: `访问路径已被内容「${content.title}」（#${content.id}）占用` });
  }
  const conds = [eq(cmsPages.siteId, siteId), eq(cmsPages.path, path)];
  if (exceptId) conds.push(ne(cmsPages.id, exceptId));
  const [page] = await executor.select({ name: cmsPages.name }).from(cmsPages).where(and(...conds)).limit(1);
  if (page) {
    throw new HTTPException(400, { message: `访问路径已被页面「${page.name}」占用` });
  }
}

async function clearOtherHome(executor: DbExecutor, siteId: number, exceptId?: number) {
  const conds = [eq(cmsPages.siteId, siteId), eq(cmsPages.isHome, true)];
  if (exceptId) conds.push(ne(cmsPages.id, exceptId));
  await executor.update(cmsPages).set({ isHome: false }).where(and(...conds));
}

export async function createCmsPage(input: CmsPageInput) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  if (!SLUG_RE.test(input.slug)) throw new HTTPException(400, { message: 'slug 仅允许小写字母/数字/中划线' });
  const blocks = input.blocks === undefined ? undefined : sanitizeCmsPageBlocks(input.blocks);
  const requiresDynamic = cmsPageRequiresDynamic(blocks ?? []);
  try {
    const mutation = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, input.siteId);
      await assertCustomPagePathFree(tx, input.siteId, input.path);
      if (input.isHome) await clearOtherHome(tx, input.siteId);
      const [row] = await tx.insert(cmsPages).values({
        ...input,
        ...(blocks ? { blocks: await canonicalizeCmsResourceContent(tx, input.siteId, blocks) } : {}),
        requiresDynamic,
      }).returning();
      await syncCmsPageWidgetRefs(tx, row.id, row.siteId, (row.blocks ?? []) as CmsPageBlock[]);
      await syncCmsResourceRefs(tx, 'page', row.id, row.siteId, row);
      const revision = await bumpCmsTemplateRefsRevision(tx, input.siteId);
      const task = await insertCmsSiteRefsRebuildOutbox(
        tx,
        { ...site, templateRefsRevision: revision },
        '页面结构创建',
        `site:${input.siteId}:refs:${revision}`,
      );
      return { row, task };
    });
    await enqueueCmsPublishOutboxes([mutation.task], `页面 #${mutation.row.id} 创建`);
    return getCmsPage(mutation.row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 slug 的页面');
  }
}

export async function updateCmsPage(id: number, input: Partial<CmsPageInput>) {
  const [initial] = await db.select().from(cmsPages).where(eq(cmsPages.id, id)).limit(1);
  requireRow(initial, '页面不存在');
  await assertSiteAccess(initial.siteId);
  const { blocks: _blocks, siteId: _siteId, ...baseMutations } = input;
  const hasBaseMutations = Object.keys(baseMutations).length > 0;
  if (input.slug && !SLUG_RE.test(input.slug)) throw new HTTPException(400, { message: 'slug 仅允许小写字母/数字/中划线' });
  const blocks = input.blocks === undefined ? undefined : sanitizeCmsPageBlocks(input.blocks);
  const { siteId: _ignored, blocks: _ignoredBlocks, ...rest } = input;
  try {
    const mutation = await db.transaction(async (tx) => {
      const site = await lockCmsSiteForMutation(tx, initial.siteId);
      const [current] = await tx.select().from(cmsPages)
        .where(eq(cmsPages.id, id))
        .for('update')
        .limit(1);
      requireRow(current, '页面不存在');
      if (hasBaseMutations && !(await hasPermission('cms:page:update'))) {
        throw new HTTPException(403, { message: '无页面编辑权限，只能修改已获授权的区块内容' });
      }
      if (blocks) await assertCmsPageBlocksUpdateAllowed(current, blocks, tx);
      if (input.path !== undefined) await assertCustomPagePathFree(tx, current.siteId, input.path, id);
      const requiresDynamic = blocks ? cmsPageRequiresDynamic(blocks) : current.requiresDynamic;
      if (rest.isHome) await clearOtherHome(tx, current.siteId, id);
      const [row] = await tx.update(cmsPages).set({
        ...rest,
        ...(blocks ? { blocks: await canonicalizeCmsResourceContent(tx, current.siteId, blocks) } : {}),
        requiresDynamic,
      }).where(and(
        eq(cmsPages.id, id),
      )).returning();
      await syncCmsPageWidgetRefs(tx, row.id, row.siteId, (row.blocks ?? []) as CmsPageBlock[]);
      await syncCmsResourceRefs(tx, 'page', row.id, row.siteId, row);
      if (blocks) {
        const blockIds = blocks.map((block) => block.id);
        await tx.delete(cmsPageBlockAcls).where(and(
          eq(cmsPageBlockAcls.pageId, id),
          blockIds.length > 0
            ? notInArray(cmsPageBlockAcls.blockId, blockIds)
            : inArray(cmsPageBlockAcls.blockId, ((current.blocks ?? []) as CmsPageBlock[]).map((block) => block.id)),
        ));
      }
      const revision = await bumpCmsTemplateRefsRevision(tx, current.siteId);
      const task = await insertCmsSiteRefsRebuildOutbox(
        tx,
        { ...site, templateRefsRevision: revision },
        '页面结构更新',
        `site:${current.siteId}:refs:${revision}`,
      );
      return { row, task };
    });
    await enqueueCmsPublishOutboxes([mutation.task], `页面 #${id} 更新`);
    return getCmsPage(mutation.row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 slug 的页面');
  }
}

export async function deleteCmsPage(id: number) {
  const [current] = await db.select().from(cmsPages).where(eq(cmsPages.id, id)).limit(1);
  requireRow(current, '页面不存在');
  await assertSiteAccess(current.siteId);
  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, current.siteId);
    await deleteCmsPageWidgetRefs(tx, [id]);
    await tx.delete(cmsPages).where(eq(cmsPages.id, id));
    await deleteCmsResourceRefsForOwner(tx, 'page', [id], current.siteId);
    const revision = await bumpCmsTemplateRefsRevision(tx, current.siteId);
    const task = await insertCmsSiteRefsRebuildOutbox(
      tx,
      { ...site, templateRefsRevision: revision },
      '页面结构删除',
      `site:${current.siteId}:refs:${revision}`,
    );
    return { task };
  });
  await enqueueCmsPublishOutboxes([mutation.task], `页面 #${id} 删除`);
  return current;
}

// ─── 前台查询 ─────────────────────────────────────────────────────────────────
export async function getPublishedPageBySlug(siteId: number, slug: string): Promise<CmsPageRow | null> {
  const [row] = await db.select().from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.slug, slug), eq(cmsPages.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

/** 按自定义访问路径查页面；入参需与入库形态同源（无前后斜杠、无 /index.html） */
export async function getPublishedPageByPath(siteId: number, rawPath: string): Promise<CmsPageRow | null> {
  const key = rawPath.replace(/^\/+|\/+$/g, '').replace(/\/index\.html$/i, '');
  if (!key) return null;
  const [row] = await db.select().from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.path, key), eq(cmsPages.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

export async function getHomeTakeoverPage(siteId: number): Promise<CmsPageRow | null> {  const [row] = await db.select().from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.isHome, true), eq(cmsPages.status, 'enabled')))
    .orderBy(desc(cmsPages.id))
    .limit(1);
  return row ?? null;
}

export async function listPublishedPages(siteId: number): Promise<CmsPageRow[]> {
  return db.select().from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.status, 'enabled')))
    .orderBy(cmsPages.id);
}

/**
 * 仅识别带 guest/member 条件的搭建页。命中时前台必须跳过静态文件、混合回写与共享缓存。
 */
export async function resolveDynamicCmsPageForPath(siteId: number, rawPath: string): Promise<CmsPageRow | null> {
  const cleaned = rawPath.replace(/^\/+|\/+$/g, '');
  if (cleaned === '' || cleaned === 'index.html') {
    const row = await getHomeTakeoverPage(siteId);
    return row?.requiresDynamic ? row : null;
  }
  const match = /^p\/([a-z0-9-]+)(?:\/(?:index\.html)?)?$/.exec(cleaned);
  if (match) {
    const row = await getPublishedPageBySlug(siteId, match[1]);
    return row?.requiresDynamic ? row : null;
  }
  const byPath = await getPublishedPageByPath(siteId, cleaned);
  return byPath?.requiresDynamic ? byPath : null;
}
