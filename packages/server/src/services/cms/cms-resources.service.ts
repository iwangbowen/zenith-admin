import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { eq, and, desc, gt, inArray, isNull, notInArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { createRequire } from 'node:module';
import { cmsResourceContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsResources, cmsResourceFolders, cmsResourceRefs } from '../../db/schema';
import type { CmsResourceRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { uploadManagedFile, deleteManagedFile, readFileContent } from '../files/files.service';
import { processCmsImageUpload } from './cms-image.service';
import { assertSiteAccess } from './cms-sites.service';
import type { CmsResourceType, CmsResourceReference, UpdateCmsResourceInput, CropCmsResourceInput } from '@zenith/shared/cms';
import { assertCompleteCmsBatch } from './cms-access';
import { ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { ensureCmsResourceFolderExists } from './cms-resource-folders.service';
import {
  countCmsResourceRefs, invalidateCmsResourceCache, listCmsOrphanResourceIds, listCmsResourceRefDetails,
} from './cms-resource-refs.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';

// 惰性加载：sharp 含原生二进制、模块图大，仅在首次处理图片时加载
// （require 加载 CJS 构建，其导出即可调用函数，类型对应 d.mts 的 default）
const require = createRequire(import.meta.url);
const sharp = (...args: Parameters<typeof import('sharp')['default']>) =>
  (require('sharp') as unknown as typeof import('sharp')['default'])(...args);

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsResource(row: CmsResourceRow, folderName?: string | null, refCount?: number) {
  return {
    id: row.id,
    siteId: row.siteId,
    folderId: row.folderId ?? null,
    folderName: folderName ?? null,
    type: row.type,
    name: row.name,
    url: row.url,
    thumbUrl: row.thumbUrl ?? null,
    fileId: row.fileId ?? null,
    size: row.size,
    width: row.width ?? null,
    height: row.height ?? null,
    mimeType: row.mimeType ?? null,
    remark: row.remark ?? null,
    ownsFile: row.ownsFile,
    ...(refCount !== undefined ? { refCount } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function detectResourceType(mime: string): CmsResourceType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime === 'application/pdf'
    || mime.includes('word') || mime.includes('excel') || mime.includes('powerpoint')
    || mime.includes('spreadsheet') || mime.includes('presentation') || mime.includes('officedocument')
    || mime.startsWith('text/')
  ) return 'document';
  return 'other';
}

// ─── 列表 / 上传 / 编辑 / 删除 ─────────────────────────────────────────────────
export async function listCmsResources(q: QueryOutputOf<typeof cmsResourceContract.list>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: (SQL | undefined)[] = [eq(cmsResources.siteId, q.siteId)];
  if (q.type) conditions.push(eq(cmsResources.type, q.type));
  if (q.folderId === 0) conditions.push(isNull(cmsResources.folderId));
  else if (q.folderId) conditions.push(eq(cmsResources.folderId, q.folderId));
  conditions.push(keywordCondition(q.keyword, [cmsResources.name]));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsResources, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ resource: cmsResources, folderName: cmsResourceFolders.name })
          .from(cmsResources)
          .leftJoin(cmsResourceFolders, eq(cmsResources.folderId, cmsResourceFolders.id))
          .where(where).orderBy(desc(cmsResources.id)).$dynamic(),
        q.page, q.pageSize,
      );
      const refCounts = await countCmsResourceRefs(rows.map((row) => row.resource.id), q.siteId);
      return rows.map((row) => mapCmsResource(row.resource, row.folderName, refCounts.get(row.resource.id) ?? 0));
    },
  });
}

/** 素材上传：图片走站点图片管线（压缩/水印/缩略图），其他类型原样入库 */
export async function uploadCmsResource(file: File, siteId: number, folderId?: number | null) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  if (folderId) {
    const folder = await ensureCmsResourceFolderExists(folderId);
    if (folder.siteId !== siteId) throw new HTTPException(400, { message: '素材文件夹不属于当前站点' });
  }
  const type = detectResourceType(file.type);
  if (type === 'image') {
    const img = await processCmsImageUpload(file, siteId);
    const [row] = await db.insert(cmsResources).values({
      siteId, folderId: folderId ?? null, type, name: file.name, url: img.url, thumbUrl: img.thumbUrl,
      fileId: img.fileId, size: file.size, width: img.width, height: img.height, mimeType: file.type,
    }).returning();
    return mapCmsResource(row);
  }
  const raw = await uploadManagedFile(file);
  const [row] = await db.insert(cmsResources).values({
    siteId, folderId: folderId ?? null, type, name: file.name, url: raw.url ?? '', thumbUrl: null,
    fileId: raw.id, size: file.size, width: null, height: null, mimeType: file.type || null,
  }).returning();
  return mapCmsResource(row);
}

async function ensureResource(id: number): Promise<CmsResourceRow> {
  const [row] = await db.select().from(cmsResources).where(eq(cmsResources.id, id)).limit(1);
  requireRow(row, '素材不存在');
  await assertSiteAccess(row.siteId);
  return row;
}

export async function updateCmsResource(id: number, data: UpdateCmsResourceInput) {
  const current = await ensureResource(id);
  if (data.folderId) {
    const folder = await ensureCmsResourceFolderExists(data.folderId);
    if (folder.siteId !== current.siteId) throw new HTTPException(400, { message: '素材文件夹不属于当前站点' });
  }
  const [row] = await db.update(cmsResources).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.remark !== undefined ? { remark: data.remark } : {}),
    ...(data.folderId !== undefined ? { folderId: data.folderId } : {}),
  }).where(eq(cmsResources.id, id)).returning();
  return mapCmsResource(row);
}

/**
 * 素材替换：保留素材 id 换掉底层文件，全站引用自动跟随新地址。
 *
 * 句柄化之前做不到这件事 —— URL 就是句柄，换文件必然要逐处改引用。
 */
export async function replaceCmsResource(id: number, file: File) {
  const current = await ensureResource(id);
  const type = detectResourceType(file.type);
  if (current.type === 'image' && type !== 'image') {
    throw new HTTPException(400, { message: '图片素材只能替换为图片' });
  }

  const uploaded = type === 'image'
    ? await processCmsImageUpload(file, current.siteId)
    : await (async () => {
        const raw = await uploadManagedFile(file);
        return { url: raw.url ?? '', thumbUrl: null, fileId: raw.id, width: null, height: null };
      })();
  if (!uploaded.url) throw new HTTPException(500, { message: '素材替换失败：上传未返回地址' });

  const [row] = await db.update(cmsResources).set({
    type,
    url: uploaded.url,
    thumbUrl: uploaded.thumbUrl,
    fileId: uploaded.fileId,
    // 新文件由本次上传产生，归本素材所有；替换引用登记型素材后它就成了自有素材
    ownsFile: true,
    size: file.size,
    width: uploaded.width,
    height: uploaded.height,
    mimeType: file.type || null,
  }).where(eq(cmsResources.id, id)).returning();
  invalidateCmsResourceCache(current.siteId, [id]);
  await refreshCmsPublicConfiguration(current.siteId, '素材替换', `resource:${row.id}:${row.updatedAt.getTime()}`);
  // Old binaries remain until the managed-file orphan cleanup runs. Deleting
  // them before the new static deployment activates would break existing HTML.
  return mapCmsResource(row);
}

export function isCmsResourceOrphan(references: CmsResourceReference[]): boolean {
  return references.length === 0;
}

/**
 * 单素材引用明细。
 *
 * 由 `cms_resource_refs` 索引直接查出，不再对内容/栏目/页面等 9 张表做 `LIKE '%url%'` 全表扫描，
 * 也不会再出现 `a.jpg` 命中 `a.jpg.bak` 这类子串误判。
 */
export async function listCmsResourceReferences(id: number): Promise<CmsResourceReference[]> {
  const res = await ensureResource(id);
  await assertAllCmsSiteChannelsAccess(res.siteId);
  return listCmsResourceRefDetails(res.id, res.siteId);
}

export async function moveCmsResources(ids: number[], folderId: number | null): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const rows = await db.select().from(cmsResources).where(inArray(cmsResources.id, unique));
  assertCompleteCmsBatch(unique, rows.map((row) => row.id), '素材');
  const siteIds = [...new Set(rows.map((row) => row.siteId))];
  if (siteIds.length !== 1) throw new HTTPException(400, { message: '仅支持同站点素材批量移动' });
  await assertSiteAccess(siteIds[0]);
  if (folderId) {
    const folder = await ensureCmsResourceFolderExists(folderId);
    if (folder.siteId !== siteIds[0]) throw new HTTPException(400, { message: '目标文件夹不属于素材站点' });
  }
  const updated = await db.update(cmsResources).set({ folderId })
    .where(inArray(cmsResources.id, unique)).returning({ id: cmsResources.id });
  return updated.length;
}

export async function listCmsResourcesAfter(siteId: number, afterId: number, limit = 100): Promise<CmsResourceRow[]> {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  return db.select().from(cmsResources)
    .where(and(eq(cmsResources.siteId, siteId), gt(cmsResources.id, afterId)))
    .orderBy(cmsResources.id)
    .limit(limit);
}

export async function deleteCmsOrphanResource(row: CmsResourceRow): Promise<void> {
  const refCount = await db.$count(cmsResourceRefs, and(
    eq(cmsResourceRefs.resourceId, row.id),
    eq(cmsResourceRefs.siteId, row.siteId),
  ));
  if (refCount > 0) throw new HTTPException(409, { message: '素材已产生引用，无法治理删除' });
  await db.delete(cmsResources).where(and(eq(cmsResources.id, row.id), eq(cmsResources.siteId, row.siteId)));
  invalidateCmsResourceCache(row.siteId, [row.id]);
  await deleteOrphanedManagedFile(row, []);
}

/** 批量删除：任一素材存在站内引用则整体拒绝；联动删除底层物理文件（尽力而为） */
export async function deleteCmsResources(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.select().from(cmsResources).where(inArray(cmsResources.id, ids));
  assertCompleteCmsBatch(ids, rows.map((row) => row.id), '素材');
  for (const siteId of new Set(rows.map((r) => r.siteId))) {
    await assertSiteAccess(siteId);
  }
  const refCountsBySite = await Promise.all([...new Set(rows.map((row) => row.siteId))].map(async (siteId) => ({
    siteId,
    counts: await countCmsResourceRefs(rows.filter((row) => row.siteId === siteId).map((row) => row.id), siteId),
  })));
  const refCounts = new Map(refCountsBySite.flatMap(({ counts }) => [...counts.entries()]));
  const blocked = rows.find((row) => (refCounts.get(row.id) ?? 0) > 0);
  if (blocked) {
    throw new HTTPException(400, { message: `素材「${blocked.name}」仍被 ${refCounts.get(blocked.id)} 处引用，请先处理引用后再删除` });
  }
  await db.delete(cmsResources).where(inArray(cmsResources.id, ids));
  for (const siteId of new Set(rows.map((row) => row.siteId))) {
    invalidateCmsResourceCache(siteId, rows.filter((row) => row.siteId === siteId).map((row) => row.id));
  }
  for (const row of rows) {
    await deleteOrphanedManagedFile(row, []);
  }
  return rows.length;
}

/** 站点内孤立素材 id 全量（治理任务用；一条索引查询取代逐素材全表扫描） */
export async function listCmsSiteOrphanResourceIds(siteId: number): Promise<number[]> {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  return listCmsOrphanResourceIds(siteId);
}

/**
 * 删除底层物理文件，但仅当本素材确实持有该文件、且没有别的素材行还指向同一个 `file_id` 时。
 *
 * `ownsFile=false` 的行只是引用登记：文件由文件中心或来源站点持有（从文件中心选图自动登记、
 * 站点导入 / 站群分发复制出的素材都属此类）。无条件删除会把其他模块、其他站点正在用的文件删掉。
 */
async function deleteOrphanedManagedFile(row: Pick<CmsResourceRow, 'fileId' | 'ownsFile'>, excludeResourceIds: readonly number[]): Promise<void> {
  if (!row.fileId) return;
  // 引用登记型素材（文件中心选图、站点导入/站群分发复制）不持有文件，删除本行不得动物理文件
  if (!row.ownsFile) return;
  const stillUsed = await db.$count(cmsResources, and(
    eq(cmsResources.fileId, row.fileId),
    excludeResourceIds.length > 0 ? notInArray(cmsResources.id, [...excludeResourceIds]) : undefined,
  ));
  if (stillUsed > 0) return;
  await deleteManagedFile(row.fileId).catch(() => undefined);
}

// ─── 图片裁剪（非破坏：另存为新素材）──────────────────────────────────────────
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function cropCmsResource(id: number, rect: CropCmsResourceInput) {
  const res = await ensureResource(id);
  if (res.type !== 'image') throw new HTTPException(400, { message: '仅图片素材支持裁剪' });
  if (!res.fileId) throw new HTTPException(400, { message: '外链素材不支持裁剪' });
  const { stream } = await readFileContent(res.fileId);
  const input = await streamToBuffer(stream);
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const maxW = meta.width ?? 0;
  const maxH = meta.height ?? 0;
  if (rect.left + rect.width > maxW || rect.top + rect.height > maxH) {
    throw new HTTPException(400, { message: `裁剪区域超出原图范围（${maxW}×${maxH}）` });
  }
  const mime = res.mimeType && res.mimeType.startsWith('image/') ? res.mimeType : 'image/png';
  const output = await sharp(input, { failOn: 'none' })
    .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    .toBuffer({ resolveWithObject: true });
  const dot = res.name.lastIndexOf('.');
  const cropName = dot > 0 ? `${res.name.slice(0, dot)}_crop${res.name.slice(dot)}` : `${res.name}_crop`;
  const cropFile = new File([new Blob([new Uint8Array(output.data)], { type: mime })], cropName, { type: mime });
  const uploaded = await uploadManagedFile(cropFile);
  const [row] = await db.insert(cmsResources).values({
    siteId: res.siteId, folderId: res.folderId, type: 'image', name: cropName, url: uploaded.url ?? '', thumbUrl: null,
    fileId: uploaded.id, size: output.data.length, width: output.info.width ?? null, height: output.info.height ?? null,
    mimeType: mime, remark: `裁剪自素材 #${res.id}`,
  }).returning();
  return mapCmsResource(row);
}
