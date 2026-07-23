import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsAdEventType, CmsDeviceType } from '@zenith/shared';
import { db } from '../../db';
import {
  cmsAdEvents,
  cmsAds,
  cmsAdSlots,
  cmsAdStats,
  cmsPublishChannels,
  cmsSites,
} from '../../db/schema';
import type { CmsAdEventRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { formatDate, formatDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { getConfigNumber } from '../../lib/system-config';
import { withPagination } from '../../lib/where-helpers';
import { streamByDescendingId } from '../../lib/export-center/cursor-stream';
import { detectDeviceType } from './cms-stats.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { hashCmsRequestKey, hashCmsVisitor, hashCmsIp } from './cms-visitor';

export const CMS_AD_EVENT_DEFAULT_RETENTION_DAYS = 180;
const EVENT_DEDUPE_SECONDS: Record<CmsAdEventType, number> = {
  impression: 60,
  click: 10,
};

export interface CmsAdEventMeta {
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  path: string | null;
  publishChannelId: number | null;
  memberId: number | null;
  occurredAt?: Date;
  host?: string | null;
  channelCode?: string | null;
  expectedSiteId?: number;
}

export function normalizeCmsAdClickUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || value.length > 500 || /[\0\r\n]/.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function activeAdWhere(now: Date): SQL {
  return and(
    eq(cmsAds.status, 'enabled'),
    or(isNull(cmsAds.startAt), lte(cmsAds.startAt, now)),
    or(isNull(cmsAds.endAt), gte(cmsAds.endAt, now)),
  )!;
}

export function cmsAdEventDedupeKey(adId: number, type: CmsAdEventType, visitorHash: string, occurredAt: Date): string {
  const bucket = Math.floor(occurredAt.getTime() / (EVENT_DEDUPE_SECONDS[type] * 1000));
  return hashCmsRequestKey(`${type}:${adId}:${visitorHash}:${bucket}`);
}

async function applyAcceptedEventCounters(
  tx: DbTransaction,
  accepted: Array<{ adId: number; eventType: CmsAdEventType }>,
  statDate: string,
): Promise<void> {
  if (accepted.length === 0) return;
  const byAd = new Map<number, { impressions: number; clicks: number }>();
  for (const event of accepted) {
    const count = byAd.get(event.adId) ?? { impressions: 0, clicks: 0 };
    if (event.eventType === 'impression') count.impressions += 1;
    else count.clicks += 1;
    byAd.set(event.adId, count);
  }
  const rows = [...byAd].map(([adId, count]) => ({ adId, ...count }));
  const values = sql.join(
    rows.map((row) => sql`(${row.adId}::int, ${row.impressions}::int, ${row.clicks}::int)`),
    sql`, `,
  );
  await tx.execute(sql`
    update ${cmsAds} as ad
    set
      view_count = ad.view_count + delta.impressions,
      click_count = ad.click_count + delta.clicks
    from (values ${values}) as delta(ad_id, impressions, clicks)
    where ad.id = delta.ad_id
  `);
  await tx.insert(cmsAdStats)
    .values(rows.map((row) => ({
      adId: row.adId,
      statDate,
      views: row.impressions,
      clicks: row.clicks,
    })))
    .onConflictDoUpdate({
      target: [cmsAdStats.adId, cmsAdStats.statDate],
      set: {
        views: sql`${cmsAdStats.views} + excluded.views`,
        clicks: sql`${cmsAdStats.clicks} + excluded.clicks`,
      },
    });
}

async function recordAcceptedEvents(
  ads: Array<{ id: number; siteId: number; slotId: number }>,
  eventType: CmsAdEventType,
  meta: CmsAdEventMeta,
): Promise<number> {
  if (ads.length === 0) return 0;
  const occurredAt = meta.occurredAt ?? new Date();
  const visitorHash = hashCmsVisitor(meta.ip, meta.userAgent);
  const ipHash = hashCmsIp(meta.ip);
  const device = detectDeviceType(meta.userAgent);
  const values = ads.map((ad) => ({
    siteId: ad.siteId,
    adId: ad.id,
    slotId: ad.slotId,
    eventType,
    occurredAt,
    visitorHash,
    ipHash,
    userAgent: meta.userAgent?.slice(0, 500) ?? null,
    device,
    referrer: meta.referrer?.slice(0, 1000) ?? null,
    path: meta.path?.slice(0, 500) ?? null,
    publishChannelId: meta.publishChannelId,
    memberId: meta.memberId,
    dedupeKey: cmsAdEventDedupeKey(ad.id, eventType, visitorHash, occurredAt),
  }));
  return db.transaction(async (tx) => {
    const accepted = await tx.insert(cmsAdEvents)
      .values(values)
      .onConflictDoNothing({ target: cmsAdEvents.dedupeKey })
      .returning({ adId: cmsAdEvents.adId, eventType: cmsAdEvents.eventType });
    await applyAcceptedEventCounters(tx, accepted, formatDate(occurredAt));
    return accepted.length;
  });
}

export async function recordCmsAdImpressions(ids: number[], meta: CmsAdEventMeta): Promise<number> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 50);
  if (unique.length === 0) return 0;
  const now = meta.occurredAt ?? new Date();
  const rows = await db.select({ id: cmsAds.id, slotId: cmsAds.slotId, siteId: cmsAdSlots.siteId })
    .from(cmsAds)
    .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
    .innerJoin(cmsSites, eq(cmsAdSlots.siteId, cmsSites.id))
    .where(and(
      inArray(cmsAds.id, unique),
      activeAdWhere(now),
      eq(cmsSites.status, 'enabled'),
      meta.expectedSiteId ? eq(cmsAdSlots.siteId, meta.expectedSiteId) : undefined,
    ));
  const siteIds = new Set(rows.map((row) => row.siteId));
  if (!meta.publishChannelId && siteIds.size === 1) {
    meta = {
      ...meta,
      publishChannelId: await resolveCmsAdPublishChannelId(
        [...siteIds][0],
        meta.host ?? null,
        meta.channelCode,
      ),
    };
  }
  if (meta.publishChannelId && siteIds.size > 0) {
    const [channel] = await db.select({ siteId: cmsPublishChannels.siteId }).from(cmsPublishChannels)
      .where(and(eq(cmsPublishChannels.id, meta.publishChannelId), eq(cmsPublishChannels.status, 'enabled'))).limit(1);
    if (!channel || !siteIds.has(channel.siteId)) meta = { ...meta, publishChannelId: null };
  }
  return recordAcceptedEvents(rows, 'impression', meta);
}

export async function recordCmsAdClick(id: number, meta: CmsAdEventMeta): Promise<string | null> {
  const now = meta.occurredAt ?? new Date();
  const [row] = await db.select({
    id: cmsAds.id,
    slotId: cmsAds.slotId,
    siteId: cmsAdSlots.siteId,
    linkUrl: cmsAds.linkUrl,
  })
    .from(cmsAds)
    .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
    .innerJoin(cmsSites, eq(cmsAdSlots.siteId, cmsSites.id))
    .where(and(
      eq(cmsAds.id, id),
      activeAdWhere(now),
      eq(cmsSites.status, 'enabled'),
      meta.expectedSiteId ? eq(cmsAdSlots.siteId, meta.expectedSiteId) : undefined,
    ))
    .limit(1);
  if (!row) return null;
  const linkUrl = normalizeCmsAdClickUrl(row.linkUrl);
  if (!linkUrl) return null;
  if (!meta.publishChannelId) {
    meta = {
      ...meta,
      publishChannelId: await resolveCmsAdPublishChannelId(row.siteId, meta.host ?? null, meta.channelCode),
    };
  }
  if (meta.publishChannelId) {
    const [channel] = await db.select({ id: cmsPublishChannels.id }).from(cmsPublishChannels)
      .where(and(
        eq(cmsPublishChannels.id, meta.publishChannelId),
        eq(cmsPublishChannels.siteId, row.siteId),
        eq(cmsPublishChannels.status, 'enabled'),
      )).limit(1);
    if (!channel) meta = { ...meta, publishChannelId: null };
  }
  await recordAcceptedEvents([row], 'click', meta);
  return linkUrl;
}

export async function resolveCmsAdPublishChannelId(siteId: number, host: string | null, code?: string | null): Promise<number | null> {
  if (code) {
    const [row] = await db.select({ id: cmsPublishChannels.id }).from(cmsPublishChannels)
      .where(and(
        eq(cmsPublishChannels.siteId, siteId),
        eq(cmsPublishChannels.code, code),
        eq(cmsPublishChannels.status, 'enabled'),
      )).limit(1);
    return row?.id ?? null;
  }
  const hostname = host?.split(':')[0].toLowerCase() ?? '';
  if (hostname) {
    const [row] = await db.select({ id: cmsPublishChannels.id }).from(cmsPublishChannels)
      .where(and(
        eq(cmsPublishChannels.siteId, siteId),
        eq(cmsPublishChannels.domain, hostname),
        eq(cmsPublishChannels.status, 'enabled'),
      )).limit(1);
    if (row) return row.id;
  }
  const [fallback] = await db.select({ id: cmsPublishChannels.id }).from(cmsPublishChannels)
    .where(and(
      eq(cmsPublishChannels.siteId, siteId),
      eq(cmsPublishChannels.isDefault, true),
      eq(cmsPublishChannels.status, 'enabled'),
    )).limit(1);
  return fallback?.id ?? null;
}

export interface ListCmsAdEventsQuery {
  siteId: number;
  adId?: number;
  slotId?: number;
  eventType?: CmsAdEventType;
  device?: CmsDeviceType;
  publishChannelId?: number;
  startTime?: string;
  endTime?: string;
  page: number;
  pageSize: number;
}

export function buildCmsAdEventWhere(q: Omit<ListCmsAdEventsQuery, 'page' | 'pageSize'>): SQL {
  const conditions: SQL[] = [eq(cmsAdEvents.siteId, q.siteId)];
  if (q.adId) conditions.push(eq(cmsAdEvents.adId, q.adId));
  if (q.slotId) conditions.push(eq(cmsAdEvents.slotId, q.slotId));
  if (q.eventType) conditions.push(eq(cmsAdEvents.eventType, q.eventType));
  if (q.device) conditions.push(eq(cmsAdEvents.device, q.device));
  if (q.publishChannelId) conditions.push(eq(cmsAdEvents.publishChannelId, q.publishChannelId));
  if (q.startTime) {
    const parsed = parseDateRangeStart(q.startTime);
    if (!parsed) throw new HTTPException(400, { message: '开始时间格式无效' });
    conditions.push(gte(cmsAdEvents.occurredAt, parsed));
  }
  if (q.endTime) {
    const parsed = parseDateRangeEnd(q.endTime);
    if (!parsed) throw new HTTPException(400, { message: '结束时间格式无效' });
    conditions.push(lte(cmsAdEvents.occurredAt, parsed));
  }
  return and(...conditions)!;
}

export function mapCmsAdEvent(row: CmsAdEventRow, extra?: {
  siteName?: string | null;
  adName?: string | null;
  slotName?: string | null;
  publishChannelName?: string | null;
}) {
  return {
    id: row.id,
    siteId: row.siteId,
    siteName: extra?.siteName ?? null,
    adId: row.adId,
    adName: extra?.adName ?? null,
    slotId: row.slotId,
    slotName: extra?.slotName ?? null,
    eventType: row.eventType,
    occurredAt: formatDateTime(row.occurredAt),
    visitorHash: row.visitorHash,
    ipHash: row.ipHash,
    userAgent: row.userAgent ?? null,
    device: row.device,
    referrer: row.referrer ?? null,
    path: row.path ?? null,
    publishChannelId: row.publishChannelId ?? null,
    publishChannelName: extra?.publishChannelName ?? null,
    memberId: row.memberId ?? null,
  };
}

export async function listCmsAdEvents(q: ListCmsAdEventsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildCmsAdEventWhere(q);
  const base = db.select({
    event: cmsAdEvents,
    siteName: cmsSites.name,
    adName: cmsAds.name,
    slotName: cmsAdSlots.name,
    publishChannelName: cmsPublishChannels.name,
  })
    .from(cmsAdEvents)
    .innerJoin(cmsSites, eq(cmsAdEvents.siteId, cmsSites.id))
    .leftJoin(cmsAds, eq(cmsAdEvents.adId, cmsAds.id))
    .leftJoin(cmsAdSlots, eq(cmsAdEvents.slotId, cmsAdSlots.id))
    .leftJoin(cmsPublishChannels, eq(cmsAdEvents.publishChannelId, cmsPublishChannels.id))
    .where(where)
    .orderBy(desc(cmsAdEvents.occurredAt), desc(cmsAdEvents.id));
  const [total, rows] = await Promise.all([
    db.$count(cmsAdEvents, where),
    withPagination(base.$dynamic(), q.page, q.pageSize),
  ]);
  return {
    list: rows.map((row) => mapCmsAdEvent(row.event, row)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function* streamCmsAdEvents(
  q: Omit<ListCmsAdEventsQuery, 'page' | 'pageSize'>,
) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const baseWhere = buildCmsAdEventWhere(q);
  yield* streamByDescendingId(async (beforeId, limit) => {
    const rows = await db.select({
      event: cmsAdEvents,
      siteName: cmsSites.name,
      adName: cmsAds.name,
      slotName: cmsAdSlots.name,
      publishChannelName: cmsPublishChannels.name,
    })
      .from(cmsAdEvents)
      .innerJoin(cmsSites, eq(cmsAdEvents.siteId, cmsSites.id))
      .leftJoin(cmsAds, eq(cmsAdEvents.adId, cmsAds.id))
      .leftJoin(cmsAdSlots, eq(cmsAdEvents.slotId, cmsAdSlots.id))
      .leftJoin(cmsPublishChannels, eq(cmsAdEvents.publishChannelId, cmsPublishChannels.id))
      .where(and(baseWhere, beforeId === null ? undefined : lt(cmsAdEvents.id, beforeId)))
      .orderBy(desc(cmsAdEvents.id))
      .limit(limit);
    return rows.map((row) => mapCmsAdEvent(row.event, row));
  });
}

export async function getCmsAdEventStats(q: Omit<ListCmsAdEventsQuery, 'page' | 'pageSize'>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildCmsAdEventWhere(q);
  const date = sql<string>`to_char(${cmsAdEvents.occurredAt}, 'YYYY-MM-DD')`;
  const rows = await db.select({
    date,
    impressions: sql<number>`count(*) filter (where ${cmsAdEvents.eventType} = 'impression')::int`,
    clicks: sql<number>`count(*) filter (where ${cmsAdEvents.eventType} = 'click')::int`,
  })
    .from(cmsAdEvents)
    .where(where)
    .groupBy(date)
    .orderBy(date);
  const trend = rows.map((row) => ({
    ...row,
    ctr: row.impressions > 0 ? Math.round((row.clicks / row.impressions) * 10_000) / 100 : 0,
  }));
  const impressions = trend.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = trend.reduce((sum, row) => sum + row.clicks, 0);
  return {
    summary: {
      impressions,
      clicks,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 100 : 0,
    },
    trend,
  };
}

export async function getCmsAdEventRetentionDays(): Promise<number> {
  return getConfigNumber('cms_ad_event_retention_days', CMS_AD_EVENT_DEFAULT_RETENTION_DAYS);
}

export async function cleanupCmsAdEventsBatch(input: {
  siteId?: number;
  retentionDays?: number;
  afterId?: number;
  limit?: number;
}): Promise<{ deleted: number; lastId: number | null; threshold: Date }> {
  const retentionDays = input.retentionDays ?? await getCmsAdEventRetentionDays();
  if (retentionDays <= 0) return { deleted: 0, lastId: null, threshold: new Date(0) };
  if (input.siteId) {
    await ensureCmsSiteExists(input.siteId);
    await assertSiteAccess(input.siteId);
  }
  const threshold = new Date(Date.now() - retentionDays * 86_400_000);
  const conditions: SQL[] = [lte(cmsAdEvents.occurredAt, threshold)];
  if (input.siteId) conditions.push(eq(cmsAdEvents.siteId, input.siteId));
  if (input.afterId) conditions.push(sql`${cmsAdEvents.id} > ${input.afterId}`);
  const ids = await db.select({ id: cmsAdEvents.id }).from(cmsAdEvents)
    .where(and(...conditions))
    .orderBy(cmsAdEvents.id)
    .limit(Math.min(Math.max(input.limit ?? 1000, 1), 5000));
  if (ids.length === 0) return { deleted: 0, lastId: null, threshold };
  const deleted = await db.delete(cmsAdEvents).where(inArray(cmsAdEvents.id, ids.map((row) => row.id)))
    .returning({ id: cmsAdEvents.id });
  return { deleted: deleted.length, lastId: ids.at(-1)?.id ?? null, threshold };
}

export async function ensureCmsAdEventSiteAccess(siteId: number): Promise<void> {
  if (!Number.isInteger(siteId) || siteId <= 0) throw new HTTPException(400, { message: '站点参数无效' });
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
}
