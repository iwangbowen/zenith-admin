import { eq, asc, and, or, isNull, lte, gte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsAdSlots, cmsAds } from '../../db/schema';
import type { CmsAdSlotRow, CmsAdRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import type { CreateCmsAdSlotInput, UpdateCmsAdSlotInput, CreateCmsAdInput, UpdateCmsAdInput } from '@zenith/shared';

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
    sort: row.sort,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsAdSlotExists(id: number): Promise<CmsAdSlotRow> {
  const [row] = await db.select().from(cmsAdSlots).where(eq(cmsAdSlots.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '广告位不存在' });
  return row;
}

export async function ensureCmsAdExists(id: number): Promise<CmsAdRow> {
  const [row] = await db.select().from(cmsAds).where(eq(cmsAds.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '广告不存在' });
  return row;
}

// ─── 前台渲染：站点投放中广告（按 slot code 分组）──────────────────────────────
export async function getActiveAds(siteId: number): Promise<Record<string, { name: string; image: string | null; linkUrl: string | null }[]>> {
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
  const map: Record<string, { name: string; image: string | null; linkUrl: string | null }[]> = {};
  for (const { ad, slotCode } of rows) {
    (map[slotCode] ??= []).push({ name: ad.name, image: ad.image ?? null, linkUrl: ad.linkUrl ?? null });
  }
  return map;
}

// ─── 广告位 CRUD ──────────────────────────────────────────────────────────────
export async function listCmsAdSlots(siteId: number) {
  await assertSiteAccess(siteId);
  const rows = await db.select({
    slot: cmsAdSlots,
    adCount: sql<number>`(select count(*)::int from ${cmsAds} where ${cmsAds.slotId} = ${cmsAdSlots.id})`,
  })
    .from(cmsAdSlots)
    .where(eq(cmsAdSlots.siteId, siteId))
    .orderBy(asc(cmsAdSlots.id));
  return rows.map((r) => mapCmsAdSlot(r.slot, r.adCount));
}

export async function createCmsAdSlot(data: CreateCmsAdSlotInput) {
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsAdSlots).values(data).returning();
    return mapCmsAdSlot(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下广告位标识已存在');
  }
}

export async function updateCmsAdSlot(id: number, data: UpdateCmsAdSlotInput) {
  const current = await ensureCmsAdSlotExists(id);
  await assertSiteAccess(current.siteId);
  try {
    const [row] = await db.update(cmsAdSlots).set(data).where(eq(cmsAdSlots.id, id)).returning();
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
}

// ─── 广告 CRUD ────────────────────────────────────────────────────────────────
export interface ListCmsAdsQuery {
  siteId: number;
  slotId?: number;
  page: number;
  pageSize: number;
}

export async function listCmsAds(q: ListCmsAdsQuery) {
  await assertSiteAccess(q.siteId);
  const conditions = [eq(cmsAdSlots.siteId, q.siteId)];
  if (q.slotId) conditions.push(eq(cmsAds.slotId, q.slotId));
  const where = and(...conditions);
  const base = db.select({ ad: cmsAds, slotName: cmsAdSlots.name })
    .from(cmsAds)
    .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
    .where(where);
  const [totalRows, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(cmsAds).innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id)).where(where),
    base.orderBy(asc(cmsAds.sort), asc(cmsAds.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  return {
    list: rows.map((r) => mapCmsAd(r.ad, r.slotName)),
    total: totalRows[0]?.count ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function createCmsAd(data: CreateCmsAdInput) {
  const slot = await ensureCmsAdSlotExists(data.slotId);
  await assertSiteAccess(slot.siteId);
  const { startAt, endAt, ...rest } = data;
  const [row] = await db.insert(cmsAds).values({
    ...rest,
    startAt: parseDateTimeInput(startAt),
    endAt: parseDateTimeInput(endAt),
  }).returning();
  return mapCmsAd(row, slot.name);
}

export async function updateCmsAd(id: number, data: UpdateCmsAdInput) {
  const current = await ensureCmsAdExists(id);
  const slot = await ensureCmsAdSlotExists(data.slotId ?? current.slotId);
  await assertSiteAccess(slot.siteId);
  const { startAt, endAt, ...rest } = data;
  const [row] = await db.update(cmsAds).set({
    ...rest,
    ...(startAt !== undefined ? { startAt: parseDateTimeInput(startAt) } : {}),
    ...(endAt !== undefined ? { endAt: parseDateTimeInput(endAt) } : {}),
  }).where(eq(cmsAds.id, id)).returning();
  return mapCmsAd(row, slot.name);
}

export async function deleteCmsAd(id: number) {
  const current = await ensureCmsAdExists(id);
  const slot = await ensureCmsAdSlotExists(current.slotId);
  await assertSiteAccess(slot.siteId);
  await db.delete(cmsAds).where(eq(cmsAds.id, id));
}
