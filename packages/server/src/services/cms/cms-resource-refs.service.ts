/**
 * 素材引用编排：URL ↔ 句柄归一化、反向索引维护与引用查询。
 *
 * 写入侧：owner 保存前调用 {@link canonicalizeCmsResourcePayload} 把已登记素材 URL 归一为
 * `cms-res://{id}`，保存后在**同一事务内**调用 {@link syncCmsResourceRefs} 整体重建该 owner 的
 * 引用行（先删后插），因此 `cms_resource_refs` 与业务数据强一致，不会漂移。
 *
 * 读取侧：{@link resolveCmsResourcePayload} 把句柄解析回真实 URL（带进程内 TTL 缓存），
 * 素材被替换后所有引用位置自动跟随新地址。
 */
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsAds, cmsAdSlots, cmsChannels, cmsContents, cmsContentVersions, cmsForms,
  cmsFriendLinks, cmsPages, cmsResourceRefs, cmsResources, cmsSites, cmsWidgets, managedFiles,
} from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import {
  canonicalizeCmsResourceUris, extractCandidateUrls, extractCmsResourceIds,
  extractCmsResourceRefFields, remapCmsResourceUris, resolveCmsResourceUris,
} from '../../lib/cms-resource-uri';
import type { CmsResourceOwnerType, CmsResourceReference, CmsResourceType } from '@zenith/shared/cms';
import { isValidCmsAssetUrl } from '@zenith/shared/cms';

/** 各 owner 承载素材引用的字段清单（值取自 owner 行本身，保证与落库结果一致） */
export const CMS_RESOURCE_OWNER_FIELDS = {
  site: ['logo', 'favicon', 'extend', 'settings'],
  content: ['coverImage', 'body', 'mediaData', 'extend', 'attachments', 'externalLink', 'sourceUrl'],
  contentVersion: ['snapshot'],
  channel: ['image', 'pageContent', 'settings', 'linkUrl'],
  friendLink: ['logo', 'url'],
  ad: ['image', 'linkUrl'],
  page: ['blocks'],
  widget: ['draftData', 'publishedData'],
  form: ['fields'],
} as const satisfies Record<CmsResourceOwnerType, readonly string[]>;

// ─── 写入侧：归一化 ───────────────────────────────────────────────────────────

/**
 * 把 payload 中出现的、已登记于本站素材库的 URL 归一为 `cms-res://{id}`。
 *
 * 只按候选 URL 精确查库，不做任何子串猜测；未登记的外链地址原样保留。
 *
 * `executor` 必须传入调用方所处的事务：本函数会读 `cms_resources`，并可能为文件中心
 * 引用补登记素材行。用全局连接执行会有两个后果 —— 外层事务持锁时另取连接可能耗尽连接池
 * 造成挂起，且补登记的素材行不会随外层事务回滚，留下孤儿。
 */
export async function canonicalizeCmsResourcePayload<T>(
  executor: DbExecutor,
  siteId: number,
  payload: T,
): Promise<T> {
  const urls = extractCandidateUrls(payload);
  if (urls.length === 0) return payload;
  const rows = await executor.select({ id: cmsResources.id, url: cmsResources.url })
    .from(cmsResources)
    .where(and(eq(cmsResources.siteId, siteId), inArray(cmsResources.url, urls)));
  const urlToId = new Map(rows.map((row) => [row.url, row.id]));

  // 统一媒体库：从文件中心直接选取的文件此前完全游离于素材中心之外（引用扫描看不见、
  // 孤立治理也保护不了）。这里按需把它们登记为本站素材，复用同一 file_id 不复制物理文件。
  const unregistered = urls.filter((url) => !urlToId.has(url));
  for (const [url, id] of await adoptManagedFilesAsResources(executor, siteId, unregistered)) {
    urlToId.set(url, id);
  }
  if (urlToId.size === 0) return payload;
  return canonicalizeCmsResourceUris(payload, urlToId);
}

/** `/api/files/{uuid}/content` → managed_files.id */
const MANAGED_FILE_URL_RE = /^\/api\/files\/([0-9a-fA-F-]{36})\/content$/;

/**
 * 允许写入 `cms_resources.url` / `thumb_url` 的地址形态：站内绝对路径或 http(s) 绝对 URL，
 * 且不含引号、尖括号、反斜杠与空白。协议相对地址（`//evil.example/x`）一并拒绝 ——
 * 它会从攻击者域名加载资源，语义上等价于外链，与净化器的 `allowProtocolRelative: false` 保持一致。
 *
 * 这条校验是安全边界而非美观约束：素材地址在读取时会被**直接拼进已净化的 HTML**
 * （句柄替换发生在 sanitizeCmsHtml 之后），因此地址本身必须无法承载属性逃逸或 `javascript:`。
 * 唯一能写入外来地址的入口是站点导入包，其 body schema 是 passthrough，必须在此拦截。
 */
const SAFE_RESOURCE_URL_RE = /^(?:\/(?!\/)[^"'<>\s\\]*|https?:\/\/[^"'<>\s\\]+)$/;

export function isSafeCmsResourceUrl(url: string | null | undefined): boolean {
  if (url == null || url === '') return true;
  return url.length <= 500 && SAFE_RESOURCE_URL_RE.test(url) && isValidCmsAssetUrl(url);
}

/** 校验并返回素材地址；非法时抛 400（导入包等不可信来源的唯一拦截点） */
export function assertSafeCmsResourceUrl(url: string | null | undefined, label = '素材地址'): string | null {
  if (url == null || url === '') return null;
  if (!isSafeCmsResourceUrl(url)) {
    throw new HTTPException(400, { message: `${label}不合法：仅允许站内路径或 http(s) 地址，且不能包含引号、尖括号或空白` });
  }
  return url;
}

function detectResourceType(mime: string | null | undefined): CmsResourceType {
  const value = mime ?? '';
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  if (
    value === 'application/pdf'
    || value.includes('word') || value.includes('excel') || value.includes('powerpoint')
    || value.includes('spreadsheet') || value.includes('presentation') || value.includes('officedocument')
    || value.startsWith('text/')
  ) return 'document';
  return 'other';
}

async function adoptManagedFilesAsResources(
  executor: DbExecutor,
  siteId: number,
  urls: readonly string[],
): Promise<Map<string, number>> {
  const adopted = new Map<string, number>();
  const byFileId = new Map<string, string>();
  for (const url of urls) {
    const match = MANAGED_FILE_URL_RE.exec(url);
    if (match) byFileId.set(match[1], url);
  }
  if (byFileId.size === 0) return adopted;

  const files = await executor.select({
    id: managedFiles.id,
    originalName: managedFiles.originalName,
    size: managedFiles.size,
    mimeType: managedFiles.mimeType,
  }).from(managedFiles).where(inArray(managedFiles.id, [...byFileId.keys()]));
  if (files.length === 0) return adopted;

  const inserted = await executor.insert(cmsResources).values(files.map((file) => ({
    siteId,
    folderId: null,
    type: detectResourceType(file.mimeType),
    name: file.originalName,
    url: byFileId.get(file.id)!,
    thumbUrl: null,
    fileId: file.id,
    // 文件由文件中心持有，CMS 只是引用登记：清理本行不得删除物理文件
    ownsFile: false,
    size: file.size,
    mimeType: file.mimeType,
    remark: '自文件中心引用时自动登记',
  }))).onConflictDoNothing().returning({ id: cmsResources.id, url: cmsResources.url });
  for (const row of inserted) adopted.set(row.url, row.id);

  // onConflictDoNothing 会吞掉并发下已被登记的行，补查一次保证句柄化不遗漏
  const missing = [...byFileId.values()].filter((url) => !adopted.has(url));
  if (missing.length > 0) {
    const existing = await executor.select({ id: cmsResources.id, url: cmsResources.url })
      .from(cmsResources)
      .where(and(eq(cmsResources.siteId, siteId), inArray(cmsResources.url, missing)));
    for (const row of existing) adopted.set(row.url, row.id);
  }
  return adopted;
}

/** 单值便捷版本：把字符串/JSON 值中的素材 URL 归一为句柄 */
export async function canonicalizeCmsResourceContent<T>(
  executor: DbExecutor,
  siteId: number,
  value: T,
): Promise<T> {
  return canonicalizeCmsResourcePayload(executor, siteId, value);
}

/**
 * 只对 owner 声明的素材承载字段做归一化，其余字段原样保留。
 *
 * 相比整体归一化更保守：即便将来某个字段恰好存了与素材同名的字符串，也不会被改写。
 */
export async function canonicalizeCmsResourceFields<T extends object>(
  executor: DbExecutor,
  siteId: number,
  payload: T,
  ownerType: CmsResourceOwnerType,
): Promise<T> {
  const record = payload as Record<string, unknown>;
  const fieldNames = CMS_RESOURCE_OWNER_FIELDS[ownerType] as readonly string[];
  const present = fieldNames.filter((name) => record[name] !== undefined);
  if (present.length === 0) return payload;
  const subset = Object.fromEntries(present.map((name) => [name, record[name]]));
  const canonical = await canonicalizeCmsResourcePayload(executor, siteId, subset);
  return { ...payload, ...canonical };
}

// ─── 写入侧：反向索引维护 ─────────────────────────────────────────────────────

/**
 * 按 owner 整体重建引用行。必须与 owner 的写入处于同一事务。
 *
 * `row` 传入落库后的完整行，函数按 {@link CMS_RESOURCE_OWNER_FIELDS} 自行摘取相关字段，
 * 调用方无需关心哪些字段承载素材。
 */
export async function syncCmsResourceRefs(
  executor: DbExecutor,
  ownerType: CmsResourceOwnerType,
  ownerId: number,
  siteId: number,
  row: object,
): Promise<void> {
  await rebuildCmsResourceRefsForOwners(executor, ownerType, siteId, [{ ownerId, row }]);
}

/**
 * 整批重建一组同类型 owner 的引用行，语义与逐个 {@link syncCmsResourceRefs} 一致（先删后插、
 * 未登记句柄忽略、外站句柄拒绝），但无论多少 owner 都只有 delete / 素材校验 select / insert 三条语句。
 * 供引用索引重建任务按分片调用：此前一个站点的全部内容在一个事务里逐行 3 条语句地重建，
 * 既长时间持有 cms_resource_refs 行锁，也要求把全部正文一次装进内存。
 */
export async function rebuildCmsResourceRefsForOwners(
  executor: DbExecutor,
  ownerType: CmsResourceOwnerType,
  siteId: number,
  owners: ReadonlyArray<{ ownerId: number; row: object }>,
): Promise<void> {
  if (owners.length === 0) return;
  const fieldNames = CMS_RESOURCE_OWNER_FIELDS[ownerType] as readonly string[];
  const extractedByOwner = owners.map(({ ownerId, row }) => {
    const record = row as Record<string, unknown>;
    const fields = Object.fromEntries(fieldNames.map((name) => [name, record[name]]));
    return { ownerId, refs: extractCmsResourceRefFields(fields) };
  });

  await deleteCmsResourceRefsForOwner(executor, ownerType, owners.map((owner) => owner.ownerId), siteId);

  // A resource handle is site-local.  Do not allow a caller to register a
  // foreign-site resource under the current owner, even if the numeric id is
  // otherwise valid.  Unknown handles remain ignored for repair compatibility.
  const candidateIds = [...new Set(extractedByOwner.flatMap(({ refs }) => refs.map((item) => item.resourceId)))];
  if (candidateIds.length === 0) return;
  const existing = await executor.select({ id: cmsResources.id, siteId: cmsResources.siteId })
    .from(cmsResources).where(inArray(cmsResources.id, candidateIds));
  const foreign = existing.filter((item) => item.siteId !== siteId);
  if (foreign.length > 0) {
    throw new HTTPException(400, { message: '素材句柄不属于当前站点' });
  }
  const valid = new Set(existing.filter((item) => item.siteId === siteId).map((item) => item.id));
  const values = extractedByOwner.flatMap(({ ownerId, refs }) => refs
    .filter((item) => valid.has(item.resourceId))
    .map((item) => ({ siteId, resourceId: item.resourceId, ownerType, ownerId, field: item.field })));
  if (values.length === 0) return;
  await executor.insert(cmsResourceRefs).values(values).onConflictDoNothing();
}

/** owner 被删除时清理其引用行（owner 表无外键指向 refs，需显式清理） */
export async function deleteCmsResourceRefsForOwner(
  executor: DbExecutor,
  ownerType: CmsResourceOwnerType,
  ownerIds: readonly number[],
  siteId: number,
): Promise<void> {
  if (ownerIds.length === 0) return;
  await executor.delete(cmsResourceRefs)
    .where(and(
      eq(cmsResourceRefs.siteId, siteId),
      eq(cmsResourceRefs.ownerType, ownerType),
      inArray(cmsResourceRefs.ownerId, [...ownerIds]),
    ));
}

/**
 * 把 payload 中引用的**其他站点**素材登记到目标站点，并把句柄改写为目标站的素材 id。
 *
 * 站群分发是跨站复制：若目标站直接沿用来源站的句柄，来源站点一旦删除，
 * `cms_resources`（site_id 级联）连同 `cms_resource_refs`（resource_id 级联）一起消失，
 * 目标站的正文只剩悬空句柄，解析后全部变成 `src=""` 且无引用行可供排查。
 * 这里与站点导入采取同一策略：每个站点只引用自己的素材行，按 URL 在目标站内去重。
 */
export async function adoptCmsResourcesIntoSite<T>(
  executor: DbExecutor,
  targetSiteId: number,
  payload: T,
): Promise<T> {
  const ids = extractCmsResourceIds(payload);
  if (ids.length === 0) return payload;
  const sources = await executor.select().from(cmsResources).where(inArray(cmsResources.id, ids));
  const foreign = sources.filter((row) => row.siteId !== targetSiteId);
  if (foreign.length === 0) return payload;

  // Do not copy a malformed legacy URL into a target site.  The read resolver
  // also fail-closes, but rejecting here prevents creation of a bad new row.
  for (const source of foreign) {
    assertSafeCmsResourceUrl(source.url, `素材 #${source.id} 地址`);
    if (source.thumbUrl) assertSafeCmsResourceUrl(source.thumbUrl, `素材 #${source.id} 缩略图地址`);
  }

  // 同一素材可能被两条分发同时搬运（advisory lock 只按来源内容 id 加锁），
  // 因此走 insert-on-conflict + 补查，避免撞 (site_id, url) 唯一索引导致整个事务回滚
  const inserted = await executor.insert(cmsResources).values(foreign.map((source) => ({
    siteId: targetSiteId,
    folderId: null,
    type: source.type,
    name: source.name,
    url: source.url,
    thumbUrl: source.thumbUrl,
    fileId: source.fileId,
    // 物理文件仍归来源站素材所有，目标站只是引用登记
    ownsFile: false,
    size: source.size,
    width: source.width,
    height: source.height,
    mimeType: source.mimeType,
    remark: `跨站引用自站点 #${source.siteId} 素材 #${source.id}`,
  }))).onConflictDoNothing().returning({ id: cmsResources.id, url: cmsResources.url });

  const byUrl = new Map(inserted.map((row) => [row.url, row.id]));
  const missing = foreign.map((source) => source.url).filter((url) => !byUrl.has(url));
  if (missing.length > 0) {
    const existing = await executor.select({ id: cmsResources.id, url: cmsResources.url })
      .from(cmsResources)
      .where(and(eq(cmsResources.siteId, targetSiteId), inArray(cmsResources.url, missing)));
    for (const row of existing) byUrl.set(row.url, row.id);
  }

  const idMap = new Map<number, number>();
  for (const source of foreign) {
    const targetId = byUrl.get(source.url);
    if (targetId != null) idMap.set(source.id, targetId);
  }
  return remapCmsResourceUris(payload, idMap);
}

// ─── 读取侧：句柄解析（带进程内缓存）─────────────────────────────────────────

interface ResourceTarget {
  url: string;
  thumbUrl: string | null;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 5000;
const cache = new Map<string, { value: ResourceTarget | null; expiresAt: number }>();

function resourceCacheKey(siteId: number, resourceId: number): string {
  return `${siteId}:${resourceId}`;
}

/** 素材被修改/替换/删除后调用，使缓存立即失效 */
export function invalidateCmsResourceCache(siteId: number, ids: readonly number[]): void {
  for (const id of ids) cache.delete(resourceCacheKey(siteId, id));
}

async function loadResourceTargets(siteId: number, ids: readonly number[]): Promise<Map<number, ResourceTarget | null>> {
  const now = Date.now();
  const out = new Map<number, ResourceTarget | null>();
  const missing: number[] = [];
  for (const id of ids) {
    const hit = cache.get(resourceCacheKey(siteId, id));
    if (hit && hit.expiresAt > now) out.set(id, hit.value);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const rows = await db.select({ id: cmsResources.id, url: cmsResources.url, thumbUrl: cmsResources.thumbUrl })
      .from(cmsResources).where(and(eq(cmsResources.siteId, siteId), inArray(cmsResources.id, missing)));
    const found = new Map(rows.map((row) => {
      // Bad legacy URLs must never be interpolated back into already-sanitized
      // HTML.  Cache the miss so a corrupt row cannot create a hot-loop.
      const url = isSafeCmsResourceUrl(row.url) ? row.url : null;
      const thumbUrl = row.thumbUrl && isSafeCmsResourceUrl(row.thumbUrl) ? row.thumbUrl : null;
      return [row.id, url ? { url, thumbUrl } : null] as const;
    }));
    if (cache.size > CACHE_MAX) cache.clear();
    for (const id of missing) {
      const value = found.get(id) ?? null;
      cache.set(resourceCacheKey(siteId, id), { value, expiresAt: now + CACHE_TTL_MS });
      out.set(id, value);
    }
  }
  return out;
}

/** 深度解析 payload 中的素材句柄为真实 URL（批量取数，无 N+1） */
export async function resolveCmsResourcePayload<T>(payload: T, siteId: number): Promise<T> {
  const ids = extractCmsResourceIds(payload);
  if (ids.length === 0) return payload;
  const targets = await loadResourceTargets(siteId, ids);
  return resolveCmsResourceUris(payload, (id) => targets.get(id)?.url ?? null);
}

/**
 * 解析封面：返回原图与缩略图地址。
 *
 * 句柄形态时缩略图取素材自身的 `thumbUrl`（因此媒体库选图同样享受缩略图，
 * 且替换素材后缩略图自动跟随）；外链 URL 无缩略图，回退原图。
 */
export async function resolveCmsResourceCover(
  coverImage: string | null | undefined,
  siteId: number,
): Promise<{ coverImage: string | null; coverThumb: string | null }> {
  const [resolved] = await resolveCmsResourceCovers([coverImage], siteId);
  return resolved;
}

/** 批量版本，供列表页避免逐行取数 */
export async function resolveCmsResourceCovers(
  covers: readonly (string | null | undefined)[],
  siteId: number,
): Promise<{ coverImage: string | null; coverThumb: string | null }[]> {
  const ids = [...new Set(covers.flatMap((cover) => extractCmsResourceIds(cover)))];
  const targets = ids.length > 0 ? await loadResourceTargets(siteId, ids) : new Map<number, ResourceTarget | null>();
  return covers.map((cover) => resolveCover(cover, targets));
}

function resolveCover(
  cover: string | null | undefined,
  targets: ReadonlyMap<number, ResourceTarget | null>,
): { coverImage: string | null; coverThumb: string | null } {
  if (!cover) return { coverImage: null, coverThumb: null };
  const [id] = extractCmsResourceIds(cover);
  if (id == null) return { coverImage: isSafeCmsResourceUrl(cover) ? cover : null, coverThumb: null };
  const target = targets.get(id) ?? null;
  if (!target) return { coverImage: null, coverThumb: null };
  return { coverImage: target.url, coverThumb: target.thumbUrl ?? target.url };
}

/** 内容行承载素材的字段（解析与引用同步共用同一份定义） */
type CmsContentMediaRow = {
  coverImage: string | null;
  body?: string | null;
  mediaData?: Record<string, unknown> | null;
  extend?: Record<string, unknown> | null;
  attachments?: unknown;
  externalLink?: string | null;
  sourceUrl?: string | null;
};

/**
 * 批量解析内容行中的素材句柄，并派生 `coverThumb`。
 *
 * 所有行共用一次取数，列表页不会产生 N+1；`coverThumb` 由素材自身的缩略图派生，
 * 因此媒体库选图同样有缩略图，替换素材后也会自动跟随。
 */
export async function resolveCmsContentRows<T extends CmsContentMediaRow>(
  rows: readonly T[],
  siteId: number,
): Promise<(T & { coverThumb: string | null })[]> {
  if (rows.length === 0) return [];
  const mismatched = rows.some((row) => {
    const rowSiteId = (row as T & { siteId?: number }).siteId;
    return rowSiteId != null && rowSiteId !== siteId;
  });
  if (mismatched) throw new HTTPException(400, { message: '素材解析请求包含其他站点内容' });
  const ids = [...new Set(rows.flatMap((row) => extractCmsResourceIds([
    row.coverImage, row.body, row.mediaData, row.extend, row.attachments, row.externalLink, row.sourceUrl,
  ])))];
  const targets = ids.length > 0 ? await loadResourceTargets(siteId, ids) : new Map<number, ResourceTarget | null>();
  const resolveUri = (id: number) => targets.get(id)?.url ?? null;
  return rows.map((row) => {
    const cover = resolveCover(row.coverImage, targets);
    return {
      ...row,
      coverImage: cover.coverImage,
      coverThumb: cover.coverThumb,
      ...(row.body !== undefined ? { body: resolveCmsResourceUris(row.body, resolveUri) } : {}),
      ...(row.mediaData !== undefined ? { mediaData: resolveCmsResourceUris(row.mediaData, resolveUri) } : {}),
      ...(row.extend !== undefined ? { extend: resolveCmsResourceUris(row.extend, resolveUri) } : {}),
      ...(row.attachments !== undefined ? { attachments: resolveCmsResourceUris(row.attachments, resolveUri) } : {}),
      ...(row.externalLink !== undefined ? { externalLink: resolveCmsResourceUris(row.externalLink, resolveUri) } : {}),
      ...(row.sourceUrl !== undefined ? { sourceUrl: resolveCmsResourceUris(row.sourceUrl, resolveUri) } : {}),
    };
  });
}

/** 单行便捷版本 */
export async function resolveCmsContentRow<T extends CmsContentMediaRow>(row: T, siteId: number): Promise<T & { coverThumb: string | null }> {
  const [resolved] = await resolveCmsContentRows([row], siteId);
  return resolved;
}

// ─── 引用查询 / 孤立判定 ─────────────────────────────────────────────────────

/** 素材是否无任何引用（走引用索引单条查询） */
export async function isCmsResourceOrphanById(resourceId: number, siteId: number): Promise<boolean> {
  const count = await db.$count(cmsResourceRefs, and(
    eq(cmsResourceRefs.resourceId, resourceId),
    eq(cmsResourceRefs.siteId, siteId),
  ));
  return count === 0;
}

/** 批量统计引用数，供素材列表展示「引用数」列 */
export async function countCmsResourceRefs(resourceIds: readonly number[], siteId: number): Promise<Map<number, number>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db.select({
    resourceId: cmsResourceRefs.resourceId,
    count: sql<number>`count(*)::int`,
  }).from(cmsResourceRefs)
    .where(and(
      eq(cmsResourceRefs.siteId, siteId),
      inArray(cmsResourceRefs.resourceId, [...resourceIds]),
    ))
    .groupBy(cmsResourceRefs.resourceId);
  return new Map(rows.map((row) => [row.resourceId, row.count]));
}

/** 站点内全部孤立素材 id（一条查询出全量，供治理任务使用） */
export async function listCmsOrphanResourceIds(siteId: number): Promise<number[]> {
  const rows = await db.select({ id: cmsResources.id }).from(cmsResources).where(and(
    eq(cmsResources.siteId, siteId),
    notExists(
      db.select({ one: sql`1` }).from(cmsResourceRefs)
        .where(and(
          eq(cmsResourceRefs.resourceId, cmsResources.id),
          eq(cmsResourceRefs.siteId, siteId),
        )),
    ),
  )).orderBy(cmsResources.id);
  return rows.map((row) => row.id);
}

/** 引用明细：索引查出 owner 后按类型补标题 */
export async function listCmsResourceRefDetails(resourceId: number, siteId: number): Promise<CmsResourceReference[]> {
  const refs = await db.select({
    ownerType: cmsResourceRefs.ownerType,
    ownerId: cmsResourceRefs.ownerId,
    field: cmsResourceRefs.field,
  }).from(cmsResourceRefs).where(and(
    eq(cmsResourceRefs.resourceId, resourceId),
    eq(cmsResourceRefs.siteId, siteId),
  ));
  if (refs.length === 0) return [];

  const idsByType = new Map<CmsResourceOwnerType, number[]>();
  for (const ref of refs) {
    const list = idsByType.get(ref.ownerType) ?? [];
    list.push(ref.ownerId);
    idsByType.set(ref.ownerType, list);
  }
  const titles = await loadOwnerTitles(idsByType, siteId);
  return refs.map((ref) => ({
    kind: ref.ownerType,
    id: ref.ownerId,
    title: titles.get(`${ref.ownerType}:${ref.ownerId}`) ?? `#${ref.ownerId}`,
    field: ref.field,
  }));
}

async function loadOwnerTitles(idsByType: Map<CmsResourceOwnerType, number[]>, siteId: number): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const ids = (type: CmsResourceOwnerType) => [...new Set(idsByType.get(type) ?? [])];
  const put = (type: CmsResourceOwnerType, rows: readonly { id: number; title: string }[]) => {
    for (const row of rows) titles.set(`${type}:${row.id}`, row.title);
  };

  const siteIds = ids('site');
  const contentIds = ids('content');
  const versionIds = ids('contentVersion');
  const channelIds = ids('channel');
  const friendLinkIds = ids('friendLink');
  const adIds = ids('ad');
  const pageIds = ids('page');
  const widgetIds = ids('widget');
  const formIds = ids('form');

  const [sites, contents, versions, channels, friendLinks, ads, pages, widgets, forms] = await Promise.all([
    siteIds.length
      ? db.select({ id: cmsSites.id, title: cmsSites.name }).from(cmsSites).where(and(eq(cmsSites.id, siteId), inArray(cmsSites.id, siteIds)))
      : [],
    contentIds.length
      ? db.select({ id: cmsContents.id, title: cmsContents.title }).from(cmsContents).where(and(eq(cmsContents.siteId, siteId), inArray(cmsContents.id, contentIds)))
      : [],
    versionIds.length
      ? db.select({ id: cmsContentVersions.id, version: cmsContentVersions.version, title: cmsContents.title })
          .from(cmsContentVersions)
          .innerJoin(cmsContents, eq(cmsContentVersions.contentId, cmsContents.id))
          .where(and(eq(cmsContents.siteId, siteId), inArray(cmsContentVersions.id, versionIds)))
      : [],
    channelIds.length
      ? db.select({ id: cmsChannels.id, title: cmsChannels.name }).from(cmsChannels).where(and(eq(cmsChannels.siteId, siteId), inArray(cmsChannels.id, channelIds)))
      : [],
    friendLinkIds.length
      ? db.select({ id: cmsFriendLinks.id, title: cmsFriendLinks.name }).from(cmsFriendLinks).where(and(eq(cmsFriendLinks.siteId, siteId), inArray(cmsFriendLinks.id, friendLinkIds)))
      : [],
    adIds.length
      ? db.select({ id: cmsAds.id, title: cmsAds.name }).from(cmsAds)
          .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
          .where(and(eq(cmsAdSlots.siteId, siteId), inArray(cmsAds.id, adIds)))
      : [],
    pageIds.length
      ? db.select({ id: cmsPages.id, title: cmsPages.name }).from(cmsPages).where(and(eq(cmsPages.siteId, siteId), inArray(cmsPages.id, pageIds)))
      : [],
    widgetIds.length
      ? db.select({ id: cmsWidgets.id, title: cmsWidgets.name }).from(cmsWidgets).where(and(eq(cmsWidgets.siteId, siteId), inArray(cmsWidgets.id, widgetIds)))
      : [],
    formIds.length
      ? db.select({ id: cmsForms.id, title: cmsForms.name }).from(cmsForms).where(and(eq(cmsForms.siteId, siteId), inArray(cmsForms.id, formIds)))
      : [],
  ]);

  put('site', sites);
  put('content', contents);
  put('contentVersion', versions.map((row) => ({ id: row.id, title: `${row.title}（版本 ${row.version}）` })));
  put('channel', channels);
  put('friendLink', friendLinks);
  put('ad', ads);
  put('page', pages);
  put('widget', widgets);
  put('form', forms);
  return titles;
}
