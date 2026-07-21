import { eq, and, desc, inArray, like, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import sharp from 'sharp';
import { db } from '../../db';
import { cmsResources, cmsContents, cmsAds, cmsAdSlots, cmsFragments } from '../../db/schema';
import type { CmsResourceRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, withPagination, escapeLike } from '../../lib/where-helpers';
import { uploadManagedFile, deleteManagedFile, readFileContent } from '../files/files.service';
import { processCmsImageUpload } from './cms-image.service';
import { assertSiteAccess } from './cms-sites.service';
import type { CmsResourceType, CmsResourceReference, UpdateCmsResourceInput, CropCmsResourceInput } from '@zenith/shared';
import { assertCompleteCmsBatch } from './cms-access';
import { ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsResource(row: CmsResourceRow) {
  return {
    id: row.id,
    siteId: row.siteId,
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
export interface ListCmsResourcesQuery {
  siteId: number;
  type?: CmsResourceType;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listCmsResources(q: ListCmsResourcesQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsResources.siteId, q.siteId)];
  if (q.type) conditions.push(eq(cmsResources.type, q.type));
  if (q.keyword?.trim()) conditions.push(like(cmsResources.name, `%${escapeLike(q.keyword.trim())}%`));
  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsResources, where),
    withPagination(
      db.select().from(cmsResources).where(where).orderBy(desc(cmsResources.id)).$dynamic(),
      q.page, q.pageSize,
    ),
  ]);
  return { list: rows.map(mapCmsResource), total, page: q.page, pageSize: q.pageSize };
}

/** 素材上传：图片走站点图片管线（压缩/水印/缩略图），其他类型原样入库 */
export async function uploadCmsResource(file: File, siteId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const type = detectResourceType(file.type);
  if (type === 'image') {
    const img = await processCmsImageUpload(file, siteId);
    const [row] = await db.insert(cmsResources).values({
      siteId, type, name: file.name, url: img.url, thumbUrl: img.thumbUrl,
      fileId: img.fileId, size: file.size, width: img.width, height: img.height, mimeType: file.type,
    }).returning();
    return mapCmsResource(row);
  }
  const raw = await uploadManagedFile(file);
  const [row] = await db.insert(cmsResources).values({
    siteId, type, name: file.name, url: raw.url ?? '', thumbUrl: null,
    fileId: raw.id, size: file.size, width: null, height: null, mimeType: file.type || null,
  }).returning();
  return mapCmsResource(row);
}

async function ensureResource(id: number): Promise<CmsResourceRow> {
  const [row] = await db.select().from(cmsResources).where(eq(cmsResources.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '素材不存在' });
  await assertSiteAccess(row.siteId);
  return row;
}

export async function updateCmsResource(id: number, data: UpdateCmsResourceInput) {
  await ensureResource(id);
  const [row] = await db.update(cmsResources).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.remark !== undefined ? { remark: data.remark } : {}),
  }).where(eq(cmsResources.id, id)).returning();
  return mapCmsResource(row);
}

/** 单素材站内引用扫描：内容封面/正文/形态数据 + 广告图 + 图片碎片 */
export async function listCmsResourceReferences(id: number): Promise<CmsResourceReference[]> {
  const res = await ensureResource(id);
  await assertAllCmsSiteChannelsAccess(res.siteId);
  const pattern = `%${escapeLike(res.url)}%`;
  const [contents, ads, fragments] = await Promise.all([
    db.select({ id: cmsContents.id, title: cmsContents.title }).from(cmsContents)
      .where(and(
        eq(cmsContents.siteId, res.siteId),
        sql`(${cmsContents.coverImage} = ${res.url} or ${cmsContents.coverThumb} = ${res.url} or ${cmsContents.body} like ${pattern} or ${cmsContents.mediaData}::text like ${pattern})`,
      )).limit(50),
    db.select({ id: cmsAds.id, name: cmsAds.name }).from(cmsAds)
      .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
      .where(and(
        eq(cmsAdSlots.siteId, res.siteId),
        eq(cmsAds.image, res.url),
      )).limit(50),
    db.select({ id: cmsFragments.id, name: cmsFragments.name }).from(cmsFragments)
      .where(and(eq(cmsFragments.siteId, res.siteId), sql`${cmsFragments.content} like ${pattern}`)).limit(50),
  ]);
  return [
    ...contents.map((c): CmsResourceReference => ({ kind: 'content', id: c.id, title: c.title })),
    ...ads.map((a): CmsResourceReference => ({ kind: 'ad', id: a.id, title: a.name })),
    ...fragments.map((f): CmsResourceReference => ({ kind: 'fragment', id: f.id, title: f.name })),
  ];
}

/** 批量删除：任一素材存在站内引用则整体拒绝；联动删除底层物理文件（尽力而为） */
export async function deleteCmsResources(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.select().from(cmsResources).where(inArray(cmsResources.id, ids));
  assertCompleteCmsBatch(ids, rows.map((row) => row.id), '素材');
  for (const siteId of new Set(rows.map((r) => r.siteId))) {
    await assertSiteAccess(siteId);
  }
  for (const row of rows) {
    const refs = await listCmsResourceReferences(row.id);
    if (refs.length > 0) {
      throw new HTTPException(400, { message: `素材「${row.name}」仍被 ${refs.length} 处引用，请先处理引用后再删除` });
    }
  }
  await db.delete(cmsResources).where(inArray(cmsResources.id, ids));
  for (const row of rows) {
    if (row.fileId) await deleteManagedFile(row.fileId).catch(() => undefined);
  }
  return rows.length;
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
    siteId: res.siteId, type: 'image', name: cropName, url: uploaded.url ?? '', thumbUrl: null,
    fileId: uploaded.id, size: output.data.length, width: output.info.width ?? null, height: output.info.height ?? null,
    mimeType: mime, remark: `裁剪自素材 #${res.id}`,
  }).returning();
  return mapCmsResource(row);
}
