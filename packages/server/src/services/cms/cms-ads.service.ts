import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import type { QueryOutputOf } from '@zenith/shared/core';
import { eq, asc, and, or, isNull, lte, gte, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsAdContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsAdSlots, cmsAds } from '../../db/schema';
import type { CmsAdSlotRow, CmsAdRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import { canonicalizeCmsResourceFields, deleteCmsResourceRefsForOwner, isSafeCmsResourceUrl, syncCmsResourceRefs, resolveCmsResourcePayload } from './cms-resource-refs.service';
import type { CreateCmsAdSlotInput, UpdateCmsAdSlotInput, CreateCmsAdInput, UpdateCmsAdInput } from '@zenith/shared/cms';
import { ensureCmsSiteExists } from './cms-sites.service';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { normalizeCmsAdClickUrl } from './cms-ad-events.service';
import { buildCmsLinkResolver } from './cms-link.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsAdSlot(row: CmsAdSlotRow, adCount?: number) {
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    remark: row.remark ?? null,
    ...(adCount !== undefined ? { adCount } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapCmsAd(row: CmsAdRow, slotName?: string | null) {
  return {
    id: row.id,
    slotId: row.slotId,
    slotName: slotName ?? null,
    name: row.name,
    image: row.image ?? null,
    linkUrl: row.linkUrl ?? null,
    startAt: formatNullableDateTime(row.startAt),
    endAt: formatNullableDateTime(row.endAt),
    clickCount: row.clickCount,
    viewCount: row.viewCount,
    sort: row.sort,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsAdSlotExists(id: number): Promise<CmsAdSlotRow> {
  const [row] = await db.select().from(cmsAdSlots).where(eq(cmsAdSlots.id, id)).limit(1);
  return requireRow(row, '广告位不存在');
}

export async function ensureCmsAdExists(id: number): Promise<CmsAdRow> {
  const [row] = await db.select().from(cmsAds).where(eq(cmsAds.id, id)).limit(1);
  return requireRow(row, '广告不存在');
}

// ─── 前台渲染：站点投放中广告（按 slot code 分组）──────────────────────────────
export async function getActiveAds(siteId: number, baseUrl = ''): Promise<Record<string, { id: number; name: string; image: string | null; linkUrl: string | null }[]>> {
  const now = new Date();
  const rows = await db.select({ ad: cmsAds, slotCode: cmsAdSlots.code })
    .from(cmsAds)
    .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
    .where(and(
      eq(cmsAdSlots.siteId, siteId),
      eq(cmsAds.status, 'enabled'),
      or(isNull(cmsAds.startAt), lte(cmsAds.startAt, now)),
      or(isNull(cmsAds.endAt), gte(cmsAds.endAt, now)),
    ))
    .orderBy(asc(cmsAds.sort), asc(cmsAds.id));
  const map: Record<string, { id: number; name: string; image: string | null; linkUrl: string | null }[]> = {};
  const resolver = await buildCmsLinkResolver(siteId, baseUrl, rows.map(({ ad }) => ad.linkUrl));
  for (const { ad, slotCode } of rows) {
    const linkUrl = ad.linkUrl ? resolver(ad.linkUrl)?.url ?? null : null;
    const image = ad.image && isSafeCmsResourceUrl(ad.image) ? ad.image : null;
    (map[slotCode] ??= []).push({ id: ad.id, name: ad.name, image, linkUrl });
  }
  return map;
}

// ─── 广告位 CRUD ──────────────────────────────────────────────────────────────
export async function listCmsAdSlots(siteId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  // 广告数按 slot 分组后 LEFT JOIN（sql`` 裸列名不带表限定，禁止模板内跨表比较）
  const adCounts = db
    .select({ slotId: cmsAds.slotId, cnt: sql<number>`count(*)::int`.as('cnt') })
    .from(cmsAds)
    .groupBy(cmsAds.slotId)
    .as('ad_counts');
  const rows = await db.select({
    slot: cmsAdSlots,
    adCount: sql<number>`coalesce(${adCounts.cnt}, 0)`,
  })
    .from(cmsAdSlots)
    .leftJoin(adCounts, eq(adCounts.slotId, cmsAdSlots.id))
    .where(eq(cmsAdSlots.siteId, siteId))
    .orderBy(asc(cmsAdSlots.id));
  return rows.map((r) => mapCmsAdSlot(r.slot, r.adCount));
}

export async function createCmsAdSlot(data: CreateCmsAdSlotInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsAdSlots).values(data).returning();
    await refreshCmsPublicConfiguration(row.siteId, '广告位创建', `ad-slot:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsAdSlot(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下广告位标识已存在');
  }
}

export async function updateCmsAdSlot(id: number, data: UpdateCmsAdSlotInput) {
  const current = await ensureCmsAdSlotExists(id);
  await assertSiteAccess(current.siteId);
  try {
    const [row] = await db.update(cmsAdSlots).set(data).where(and(
      eq(cmsAdSlots.id, id),
    )).returning();
    await refreshCmsPublicConfiguration(row.siteId, '广告位更新', `ad-slot:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsAdSlot(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下广告位标识已存在');
  }
}

export async function deleteCmsAdSlot(id: number) {
  const current = await ensureCmsAdSlotExists(id);
  await assertSiteAccess(current.siteId);
  const adCount = await db.$count(cmsAds, eq(cmsAds.slotId, id));
  if (adCount > 0) throw new HTTPException(400, { message: `广告位下存在 ${adCount} 条广告，请先删除广告` });
  await db.delete(cmsAdSlots).where(eq(cmsAdSlots.id, id));
  await refreshCmsPublicConfiguration(current.siteId, '广告位删除', `ad-slot:${current.id}:deleted:${Date.now()}`);
}

// ─── 广告 CRUD ────────────────────────────────────────────────────────────────
export async function listCmsAds(q: QueryOutputOf<typeof cmsAdContract.list>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions = [
    eq(cmsAdSlots.siteId, q.siteId),
  ];
  if (q.slotId) conditions.push(eq(cmsAds.slotId, q.slotId));
  const where = buildWhere(...conditions);
  const adConditions = [
    inArray(cmsAds.slotId, db.select({ id: cmsAdSlots.id }).from(cmsAdSlots).where(eq(cmsAdSlots.siteId, q.siteId))),
  ];
  if (q.slotId) adConditions.push(eq(cmsAds.slotId, q.slotId));
  const adWhere = and(...adConditions);
  const base = db.select({ ad: cmsAds, slotName: cmsAdSlots.name })
    .from(cmsAds)
    .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
    .where(where);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsAds, adWhere),
    rows: async () => {
      const rows = await withPagination(base.orderBy(asc(cmsAds.sort), asc(cmsAds.id)).$dynamic(), q.page, q.pageSize);
      return resolveCmsResourcePayload(rows.map((r) => mapCmsAd(r.ad, r.slotName)), q.siteId);
    },
  });
}

export async function createCmsAd(data: CreateCmsAdInput) {
  const slot = await ensureCmsAdSlotExists(data.slotId);
  await assertSiteAccess(slot.siteId);
  if (data.linkUrl && !normalizeCmsAdClickUrl(data.linkUrl)) {
    throw new HTTPException(400, { message: '跳转地址仅允许站内相对路径或 http/https URL，且不得包含账号凭据' });
  }
  const { startAt, endAt, ...rest } = data;
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(cmsAds).values({
      ...await canonicalizeCmsResourceFields(tx, slot.siteId, rest, 'ad'),
      startAt: parseDateTimeInput(startAt),
      endAt: parseDateTimeInput(endAt),
    }).returning();
    await syncCmsResourceRefs(tx, 'ad', created.id, slot.siteId, created);
    return created;
  });
  await refreshCmsPublicConfiguration(slot.siteId, '广告创建', `ad:${row.id}:${row.updatedAt.getTime()}`);
  return resolveCmsResourcePayload(mapCmsAd(row, slot.name), slot.siteId);
}

export async function updateCmsAd(id: number, data: UpdateCmsAdInput) {
  const current = await ensureCmsAdExists(id);
  const currentSlot = await ensureCmsAdSlotExists(current.slotId);
  await assertSiteAccess(currentSlot.siteId);
  const slot = await ensureCmsAdSlotExists(data.slotId ?? current.slotId);
  await assertSiteAccess(slot.siteId);
  if (slot.siteId !== currentSlot.siteId) {
    throw new HTTPException(400, { message: '广告不能直接移动到其他站点的广告位，请使用站点迁移流程' });
  }
  if (data.linkUrl && !normalizeCmsAdClickUrl(data.linkUrl)) {
    throw new HTTPException(400, { message: '跳转地址仅允许站内相对路径或 http/https URL，且不得包含账号凭据' });
  }
  const { startAt, endAt, ...rest } = data;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(cmsAds).set({
      ...await canonicalizeCmsResourceFields(tx, slot.siteId, rest, 'ad'),
      ...(startAt !== undefined ? { startAt: parseDateTimeInput(startAt) } : {}),
      ...(endAt !== undefined ? { endAt: parseDateTimeInput(endAt) } : {}),
    }).where(eq(cmsAds.id, id)).returning();
    await syncCmsResourceRefs(tx, 'ad', updated.id, slot.siteId, updated);
    return updated;
  });
  await refreshCmsPublicConfiguration(slot.siteId, '广告更新', `ad:${row.id}:${row.updatedAt.getTime()}`);
  return resolveCmsResourcePayload(mapCmsAd(row, slot.name), slot.siteId);
}

export async function deleteCmsAd(id: number) {
  const current = await ensureCmsAdExists(id);
  const slot = await ensureCmsAdSlotExists(current.slotId);
  await assertSiteAccess(slot.siteId);
  await db.transaction(async (tx) => {
    await tx.delete(cmsAds).where(eq(cmsAds.id, id));
    await deleteCmsResourceRefsForOwner(tx, 'ad', [id], slot.siteId);
  });
  await refreshCmsPublicConfiguration(slot.siteId, '广告删除', `ad:${current.id}:deleted:${Date.now()}`);
}
