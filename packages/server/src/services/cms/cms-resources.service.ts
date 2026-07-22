import { eq, and, desc, gt, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import sharp from 'sharp';
import { db } from '../../db';
import {
  cmsResources, cmsContents, cmsAds, cmsAdSlots, cmsFragments, cmsSites, cmsChannels,
  cmsPages, cmsForms, cmsResourceFolders, cmsFriendLinks, cmsContentVersions,
} from '../../db/schema';
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
import { ensureCmsResourceFolderExists } from './cms-resource-folders.service';

const CONTENT_RESOURCE_FIELDS = [
  ['coverImage', cmsContents.coverImage],
  ['coverThumb', cmsContents.coverThumb],
  ['body', cmsContents.body],
  ['mediaData', cmsContents.mediaData],
  ['extend', cmsContents.extend],
  ['sourceUrl', cmsContents.sourceUrl],
  ['externalLink', cmsContents.externalLink],
] as const;
const CHANNEL_RESOURCE_FIELDS = [
  ['image', cmsChannels.image],
  ['pageContent', cmsChannels.pageContent],
  ['settings', cmsChannels.settings],
  ['linkUrl', cmsChannels.linkUrl],
] as const;
const FRIEND_LINK_RESOURCE_FIELDS = [
  ['logo', cmsFriendLinks.logo],
  ['url', cmsFriendLinks.url],
] as const;

function referenceWhere(fields: ReadonlyArray<readonly [string, unknown]>, pattern: string): SQL {
  return or(...fields.map(([, column]) => sql`${column}::text like ${pattern}`))!;
}

function referenceValues(row: object, fields: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
  const record = row as Record<string, unknown>;
  return Object.fromEntries(fields.map(([field]) => [field, record[field]]));
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsResource(row: CmsResourceRow, folderName?: string | null) {
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
  /** undefined = 全部；0 = 根目录；正数 = 指定文件夹 */
  folderId?: number;
  page: number;
  pageSize: number;
}

export async function listCmsResources(q: ListCmsResourcesQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsResources.siteId, q.siteId)];
  if (q.type) conditions.push(eq(cmsResources.type, q.type));
  if (q.folderId === 0) conditions.push(isNull(cmsResources.folderId));
  else if (q.folderId) conditions.push(eq(cmsResources.folderId, q.folderId));
  if (q.keyword?.trim()) conditions.push(like(cmsResources.name, `%${escapeLike(q.keyword.trim())}%`));
  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsResources, where),
    withPagination(
      db.select({ resource: cmsResources, folderName: cmsResourceFolders.name })
        .from(cmsResources)
        .leftJoin(cmsResourceFolders, eq(cmsResources.folderId, cmsResourceFolders.id))
        .where(where).orderBy(desc(cmsResources.id)).$dynamic(),
      q.page, q.pageSize,
    ),
  ]);
  return { list: rows.map((row) => mapCmsResource(row.resource, row.folderName)), total, page: q.page, pageSize: q.pageSize };
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
  if (!row) throw new HTTPException(404, { message: '素材不存在' });
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

export function cmsResourceContainsUrl(value: unknown, url: string): boolean {
  if (typeof value === 'string') return value.includes(url);
  return value != null && typeof value === 'object' && JSON.stringify(value).includes(url);
}

export function cmsResourceMatchingFields(fields: Record<string, unknown>, url: string): string[] {
  return Object.entries(fields)
    .filter(([, value]) => cmsResourceContainsUrl(value, url))
    .map(([field]) => field);
}

export function buildCmsFieldReferences(
  kind: CmsResourceReference['kind'],
  id: number,
  title: string,
  fields: Record<string, unknown>,
  url: string,
): CmsResourceReference[] {
  return cmsResourceMatchingFields(fields, url).map((field) => ({ kind, id, title, field }));
}

export function isCmsResourceOrphan(references: CmsResourceReference[]): boolean {
  return references.length === 0;
}

/** 单素材完整引用扫描：站点、内容、栏目、碎片、广告、页面、表单与主题配置。 */
export async function listCmsResourceReferences(id: number): Promise<CmsResourceReference[]> {
  const res = await ensureResource(id);
  await assertAllCmsSiteChannelsAccess(res.siteId);
  const pattern = `%${escapeLike(res.url)}%`;
  const [siteRows, contents, channels, ads, fragments, friendLinks, pages, forms, versions] = await Promise.all([
    db.select().from(cmsSites).where(and(
      eq(cmsSites.id, res.siteId),
      sql`(${cmsSites.logo} = ${res.url} or ${cmsSites.favicon} = ${res.url} or ${cmsSites.settings}::text like ${pattern})`,
    )),
    db.select().from(cmsContents)
      .where(and(
        eq(cmsContents.siteId, res.siteId),
        referenceWhere(CONTENT_RESOURCE_FIELDS, pattern),
      )),
    db.select().from(cmsChannels).where(and(
      eq(cmsChannels.siteId, res.siteId),
      referenceWhere(CHANNEL_RESOURCE_FIELDS, pattern),
    )),
    db.select({ id: cmsAds.id, name: cmsAds.name, image: cmsAds.image, linkUrl: cmsAds.linkUrl }).from(cmsAds)
      .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
      .where(and(
        eq(cmsAdSlots.siteId, res.siteId),
        sql`(${cmsAds.image} = ${res.url} or ${cmsAds.linkUrl} = ${res.url})`,
      )),
    db.select({ id: cmsFragments.id, name: cmsFragments.name }).from(cmsFragments)
      .where(and(eq(cmsFragments.siteId, res.siteId), sql`${cmsFragments.content} like ${pattern}`)),
    db.select({ id: cmsFriendLinks.id, name: cmsFriendLinks.name, logo: cmsFriendLinks.logo, url: cmsFriendLinks.url }).from(cmsFriendLinks)
      .where(and(eq(cmsFriendLinks.siteId, res.siteId), referenceWhere(FRIEND_LINK_RESOURCE_FIELDS, pattern))),
    db.select().from(cmsPages).where(and(eq(cmsPages.siteId, res.siteId), sql`${cmsPages.blocks}::text like ${pattern}`)),
    db.select().from(cmsForms).where(and(eq(cmsForms.siteId, res.siteId), sql`${cmsForms.fields}::text like ${pattern}`)),
    db.select({
      contentId: cmsContentVersions.contentId,
      version: cmsContentVersions.version,
      title: cmsContents.title,
    }).from(cmsContentVersions)
      .innerJoin(cmsContents, eq(cmsContentVersions.contentId, cmsContents.id))
      .where(and(eq(cmsContents.siteId, res.siteId), sql`${cmsContentVersions.snapshot}::text like ${pattern}`)),
  ]);
  const refs: CmsResourceReference[] = [];
  for (const site of siteRows) {
    if (site.logo === res.url) refs.push({ kind: 'site', id: site.id, title: site.name, field: 'logo' });
    if (site.favicon === res.url) refs.push({ kind: 'site', id: site.id, title: site.name, field: 'favicon' });
    if (cmsResourceContainsUrl(site.settings, res.url)) refs.push({ kind: 'theme', id: site.id, title: site.name, field: 'settings/themeConfig' });
  }
  for (const content of contents) {
    refs.push(...buildCmsFieldReferences('content', content.id, content.title, referenceValues(content, CONTENT_RESOURCE_FIELDS), res.url));
  }
  for (const channel of channels) {
    refs.push(...buildCmsFieldReferences('channel', channel.id, channel.name, referenceValues(channel, CHANNEL_RESOURCE_FIELDS), res.url));
  }
  for (const ad of ads) {
    for (const field of cmsResourceMatchingFields({ image: ad.image, linkUrl: ad.linkUrl }, res.url)) {
      refs.push({ kind: 'ad', id: ad.id, title: ad.name, field });
    }
  }
  refs.push(...fragments.map((row) => ({ kind: 'fragment' as const, id: row.id, title: row.name, field: 'content' })));
  for (const link of friendLinks) {
    refs.push(...buildCmsFieldReferences('friendLink', link.id, link.name, referenceValues(link, FRIEND_LINK_RESOURCE_FIELDS), res.url));
  }
  refs.push(...pages.map((row) => ({ kind: 'page' as const, id: row.id, title: row.name, field: 'blocks' })));
  refs.push(...forms.map((row) => ({ kind: 'form' as const, id: row.id, title: row.name, field: 'fields' })));
  refs.push(...versions.map((row) => ({ kind: 'content' as const, id: row.contentId, title: `${row.title}（版本 ${row.version}）`, field: 'versionSnapshot' })));
  return refs;
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
  const refs = await listCmsResourceReferences(row.id);
  if (!isCmsResourceOrphan(refs)) throw new HTTPException(409, { message: '素材已产生引用，无法治理删除' });
  await db.delete(cmsResources).where(eq(cmsResources.id, row.id));
  if (row.fileId) await deleteManagedFile(row.fileId).catch(() => undefined);
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
    siteId: res.siteId, folderId: res.folderId, type: 'image', name: cropName, url: uploaded.url ?? '', thumbUrl: null,
    fileId: uploaded.id, size: output.data.length, width: output.info.width ?? null, height: output.info.height ?? null,
    mimeType: mime, remark: `裁剪自素材 #${res.id}`,
  }).returning();
  return mapCmsResource(row);
}
