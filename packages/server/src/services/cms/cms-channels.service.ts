import { eq, asc, and, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsChannels, cmsContents, cmsModels } from '../../db/schema';
import type { CmsChannelRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsChannelInput, UpdateCmsChannelInput, CmsChannel } from '@zenith/shared';

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
export async function listCmsChannelTree(q: ListCmsChannelsQuery): Promise<CmsChannel[]> {
  const conditions: SQL[] = [eq(cmsChannels.siteId, q.siteId)];
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
  const [row] = await db.select({ id: cmsModels.id }).from(cmsModels).where(eq(cmsModels.id, modelId)).limit(1);
  if (!row) throw new HTTPException(400, { message: `指定的内容模型（id=${modelId}）不存在` });
}

/** 计算完整路径（父路径 + 本级 slug）并校验父栏目合法性 */
async function computePath(executor: DbExecutor, siteId: number, parentId: number, slug: string, selfId?: number): Promise<string> {
  if (parentId === 0) return slug;
  const [parent] = await executor.select().from(cmsChannels).where(eq(cmsChannels.id, parentId)).limit(1);
  if (!parent) throw new HTTPException(400, { message: '父栏目不存在' });
  if (parent.siteId !== siteId) throw new HTTPException(400, { message: '父栏目不属于当前站点' });
  if (selfId && parent.id === selfId) throw new HTTPException(400, { message: '父栏目不能是自身' });
  return `${parent.path}/${slug}`;
}

/** 递归重算子树 path（栏目改 slug / 挪动后调用） */
async function recomputeChildPaths(executor: DbExecutor, channelId: number, newPath: string): Promise<void> {
  const children = await executor.select().from(cmsChannels).where(eq(cmsChannels.parentId, channelId));
  for (const child of children) {
    const childPath = `${newPath}/${child.slug}`;
    await executor.update(cmsChannels).set({ path: childPath }).where(eq(cmsChannels.id, child.id));
    await recomputeChildPaths(executor, child.id, childPath);
  }
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsChannel(data: CreateCmsChannelInput) {
  await ensureModelValid(data.modelId);
  try {
    const row = await db.transaction(async (tx) => {
      const path = await computePath(tx, data.siteId, data.parentId ?? 0, data.slug);
      const [created] = await tx.insert(cmsChannels).values({ ...data, path }).returning();
      return created;
    });
    return getCmsChannel(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同路径的栏目');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsChannel(id: number, data: UpdateCmsChannelInput) {
  const current = await ensureCmsChannelExists(id);
  await ensureModelValid(data.modelId);

  const nextParentId = data.parentId ?? current.parentId;
  const nextSlug = data.slug ?? current.slug;
  if (nextParentId === id) throw new HTTPException(400, { message: '父栏目不能是自身' });

  try {
    await db.transaction(async (tx) => {
      // 防环：新父栏目不能是自身后代
      if (nextParentId !== 0 && nextParentId !== current.parentId) {
        let cursor: number = nextParentId;
        while (cursor !== 0) {
          if (cursor === id) throw new HTTPException(400, { message: '父栏目不能是自身的子栏目' });
          const [p] = await tx.select({ parentId: cmsChannels.parentId }).from(cmsChannels).where(eq(cmsChannels.id, cursor)).limit(1);
          if (!p) break;
          cursor = p.parentId;
        }
      }
      const path = await computePath(tx, current.siteId, nextParentId, nextSlug, id);
      const [updated] = await tx.update(cmsChannels).set({ ...data, path }).where(eq(cmsChannels.id, id)).returning();
      if (!updated) throw new HTTPException(404, { message: '栏目不存在' });
      if (path !== current.path) {
        await recomputeChildPaths(tx, id, path);
      }
    });
    return getCmsChannel(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同路径的栏目');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────
export async function deleteCmsChannel(id: number) {
  await ensureCmsChannelExists(id);
  const [childCount, contentCount] = await Promise.all([
    db.$count(cmsChannels, eq(cmsChannels.parentId, id)),
    db.$count(cmsContents, eq(cmsContents.channelId, id)),
  ]);
  if (childCount > 0) throw new HTTPException(400, { message: '存在子栏目，请先删除子栏目' });
  if (contentCount > 0) throw new HTTPException(400, { message: `栏目下存在 ${contentCount} 条内容，请先移除内容` });
  await db.delete(cmsChannels).where(eq(cmsChannels.id, id));
}
