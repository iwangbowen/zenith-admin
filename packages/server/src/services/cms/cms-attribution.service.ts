import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { CMS_ATTRIBUTION_EVENTS, CMS_ATTRIBUTION_EVENT_NAMES, cmsAttributionContextSchema, cmsOperationsContract } from '@zenith/shared/cms';
import type { CmsAttribution } from '@zenith/shared/cms';
import type { QueryOutputOf as ContractQuery } from '@zenith/shared/core';
import { db } from '../../db';
import { analyticsSites, cmsContents, cmsDeployments, userEvents } from '../../db/schema';
import { buildWhere, dateRangeConditions } from '../../lib/where-helpers';
import { parseDateRangeEnd, parseDateRangeStart, startOfRecentDays } from '../../lib/datetime';
import { persistServerEvent } from '../analytics/analytics-server-events.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { cmsGenerationContext } from './cms-generation-context';

function parseContext(raw: unknown) {
  try { const parsed = cmsAttributionContextSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw); return parsed.success ? parsed.data : null; } catch { return null; }
}
export async function recordCmsAttributionConversion(siteId: number, type: 'form' | 'vote', referenceId: number, raw: unknown, memberId?: number | null) {
  if (cmsGenerationContext()?.candidate) return;
  const site = await ensureCmsSiteExists(siteId);
  const key = site.settings?.analyticsSiteKey;
  if (typeof key !== 'string') return;
  const [analytics] = await db.select().from(analyticsSites).where(and(eq(analyticsSites.siteKey, key), eq(analyticsSites.status, 'enabled'), isNull(analyticsSites.tenantId))).limit(1);
  if (!analytics) return;
  const context = parseContext(raw);
  let deploymentId: number | null = null;
  let releaseId: number | null = null;
  if (context?.deploymentId) {
    const [deployment] = await db.select({ id: cmsDeployments.id, releaseId: cmsDeployments.releaseId }).from(cmsDeployments).where(and(eq(cmsDeployments.id, context.deploymentId), eq(cmsDeployments.siteId, siteId))).limit(1);
    if (deployment && deployment.releaseId === context.releaseId) { deploymentId = deployment.id; releaseId = deployment.releaseId; }
  }
  const [content] = context?.contentId ? await db.select({ id: cmsContents.id }).from(cmsContents).where(and(eq(cmsContents.id, context.contentId), eq(cmsContents.siteId, siteId))).limit(1) : [];
  const properties = { cmsSiteId: siteId, referenceId, ...(content ? { contentId: content.id } : {}), ...(deploymentId ? { deploymentId, releaseId } : {}),
    entryPath: context?.entryPath ?? '/', entrySource: context?.entrySource ?? 'unknown', ...(context?.visitorId ? { visitorId: context.visitorId } : {}),
  };
  await persistServerEvent({ eventName: type === 'form' ? CMS_ATTRIBUTION_EVENT_NAMES.formComplete : CMS_ATTRIBUTION_EVENT_NAMES.voteComplete, eventId: `cms:${type}:${referenceId}`, tenantId: null, memberId: memberId ?? null, appId: analytics.appId, properties });
}

export async function getCmsAttribution(q: ContractQuery<typeof cmsOperationsContract.attribution>): Promise<CmsAttribution> {
  await assertSiteAccess(q.siteId); await assertAllCmsSiteChannelsAccess(q.siteId);
  const site = await ensureCmsSiteExists(q.siteId);
  const key = site.settings?.analyticsSiteKey;
  const [analytics] = typeof key === 'string' ? await db.select().from(analyticsSites).where(and(eq(analyticsSites.siteKey, key), isNull(analyticsSites.tenantId))).limit(1) : [];
  if (!analytics) return { totals: CMS_ATTRIBUTION_EVENTS.map((event) => ({ event, count: 0, visitors: 0 })), journeys: [] };
  const start = parseDateRangeStart(q.startTime) ?? startOfRecentDays(30);
  const end = parseDateRangeEnd(q.endTime) ?? new Date();
  if (end < start || end.getTime() - start.getTime() > 90 * 86400_000) throw new HTTPException(400, { message: '归因查询请选择不超过 90 天的有效时间范围' });
  const contentId = sql<string | null>`${userEvents.properties}->>'contentId'`;
  const releaseId = sql<string | null>`${userEvents.properties}->>'releaseId'`;
  const deploymentId = sql<string | null>`${userEvents.properties}->>'deploymentId'`;
  const entryPath = sql<string>`coalesce(${userEvents.properties}->>'entryPath','/')`;
  const source = sql<string>`coalesce(${userEvents.properties}->>'entrySource','unknown')`;
  const where = buildWhere(eq(userEvents.appId, analytics.appId), isNull(userEvents.tenantId), sql`${userEvents.properties}->>'cmsSiteId'=${String(q.siteId)}`,
    inArray(userEvents.eventName, [...CMS_ATTRIBUTION_EVENTS]), ...dateRangeConditions(userEvents.createdAt, start, end),
    q.contentId ? eq(contentId, String(q.contentId)) : undefined, q.releaseId ? eq(releaseId, String(q.releaseId)) : undefined, q.deploymentId ? eq(deploymentId, String(q.deploymentId)) : undefined);
  const eventCount = (event: string) => sql<number>`count(*) filter (where ${userEvents.eventName}=${event})::int`;
  const [totals, groups] = await Promise.all([
    db.select({ event: userEvents.eventName, count: sql<number>`count(*)::int`, visitors: sql<number>`count(distinct coalesce(${userEvents.properties}->>'visitorId', ${userEvents.anonymousId}, ${userEvents.distinctId}))::int` }).from(userEvents).where(where).groupBy(userEvents.eventName),
    db.select({ contentId, contentTitle: cmsContents.title, releaseId, deploymentId, entryPath, source, reads: eventCount(CMS_ATTRIBUTION_EVENT_NAMES.read), clicks: eventCount(CMS_ATTRIBUTION_EVENT_NAMES.topicClick), downloads: eventCount(CMS_ATTRIBUTION_EVENT_NAMES.download), formCompletions: eventCount(CMS_ATTRIBUTION_EVENT_NAMES.formComplete), voteCompletions: eventCount(CMS_ATTRIBUTION_EVENT_NAMES.voteComplete) })
      .from(userEvents).leftJoin(cmsContents, and(eq(sql`${cmsContents.id}::text`, contentId), eq(cmsContents.siteId, q.siteId))).where(where).groupBy(contentId, cmsContents.title, releaseId, deploymentId, entryPath, source).orderBy(desc(sql`count(*)`)).limit(100),
  ]);
  const id = (value: string | null) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  return { totals: CMS_ATTRIBUTION_EVENTS.map((event) => ({ event, count: totals.find((row) => row.event === event)?.count ?? 0, visitors: totals.find((row) => row.event === event)?.visitors ?? 0 })),
    journeys: groups.map((row) => ({ ...row, contentId: id(row.contentId), releaseId: id(row.releaseId), deploymentId: id(row.deploymentId) })) };
}
