import { and, asc, eq, gte, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsTelemetryAdminContract, cmsTelemetryDeliverySchema } from '@zenith/shared/cms';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { cmsTelemetryAttributions, cmsTelemetryOutbox } from '../../db/schema';
import { buildListResult } from '../../lib/list-query';
import { pickEntity } from '../../lib/entity-map';
import { requireRow } from '../../lib/db-assert';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { formatNullableDateTime } from '../../lib/datetime';
import type { JobStuckItem } from '@zenith/shared/platform';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';

export function stuckCmsTelemetryOutboxCondition(asOf = new Date()) {
  return and(isNull(cmsTelemetryOutbox.deliveredAt), isNull(cmsTelemetryOutbox.deadLetterAt),
    lt(cmsTelemetryOutbox.leaseExpiresAt, new Date(asOf.getTime() - 60_000)));
}

/** 供平台作业监控采集全部站点，独立于受单站点权限约束的运营查询。 */
export async function getCmsTelemetryOutboxHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const unfinished = and(isNull(cmsTelemetryOutbox.deliveredAt), isNull(cmsTelemetryOutbox.deadLetterAt));
  const due = and(unfinished, lte(cmsTelemetryOutbox.nextAttemptAt, now), or(isNull(cmsTelemetryOutbox.leaseExpiresAt), lte(cmsTelemetryOutbox.leaseExpiresAt, now)));
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${due})::int`,
    running: sql<number>`count(*) filter (where ${unfinished} and ${cmsTelemetryOutbox.leaseExpiresAt} > ${sql.param(now, cmsTelemetryOutbox.leaseExpiresAt)})::int`,
    stuck: sql<number>`count(*) filter (where ${stuckCmsTelemetryOutboxCondition(now)})::int`,
    dead: sql<number>`count(*) filter (where ${cmsTelemetryOutbox.deliveredAt} is null and ${cmsTelemetryOutbox.deadLetterAt} is not null)::int`,
    failed24h: sql<number>`count(*) filter (where ${cmsTelemetryOutbox.deadLetterAt} >= ${sql.param(since, cmsTelemetryOutbox.deadLetterAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${cmsTelemetryOutbox.deliveredAt} >= ${sql.param(since, cmsTelemetryOutbox.deadLetterAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${cmsTelemetryOutbox.deadLetterAt} >= ${sql.param(hour, cmsTelemetryOutbox.deadLetterAt)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${sql.param(now, cmsTelemetryOutbox.leaseExpiresAt)}::timestamptz - min(${cmsTelemetryOutbox.nextAttemptAt}) filter (where ${due}))))::int`,
  }).from(cmsTelemetryOutbox).where(or(isNull(cmsTelemetryOutbox.deliveredAt), gte(cmsTelemetryOutbox.deliveredAt, since)));
  return {
    counts: { pending: row?.pending ?? 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: row?.dead ?? 0, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null, failed1h: row?.failed1h ?? 0, issues: [],
  };
}

export async function listStuckCmsTelemetryOutbox(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: cmsTelemetryOutbox.id, siteId: cmsTelemetryOutbox.siteId,
    lastAttemptAt: cmsTelemetryOutbox.lastAttemptAt, leaseExpiresAt: cmsTelemetryOutbox.leaseExpiresAt,
    lastError: cmsTelemetryOutbox.lastError,
  }).from(cmsTelemetryOutbox).where(stuckCmsTelemetryOutboxCondition(now))
    .orderBy(asc(cmsTelemetryOutbox.leaseExpiresAt), asc(cmsTelemetryOutbox.id)).limit(limit);
  return rows.map(row => ({
    source: 'cms-telemetry-outbox', refId: String(row.id), title: `站点 #${row.siteId} 转化投递`, status: 'lease-expired',
    startedAt: formatNullableDateTime(row.lastAttemptAt), lastSeenAt: formatNullableDateTime(row.lastAttemptAt),
    ageSec: row.lastAttemptAt ? Math.max(0, Math.floor((now.getTime() - row.lastAttemptAt.getTime()) / 1000)) : 0,
    nodeId: null, detail: row.lastError ?? '投递租约到期后仍未被回收', drillDown: null,
  }));
}

async function assertDeliveryAccess(siteId: number) {
  await ensureCmsSiteExists(siteId); await assertSiteAccess(siteId); await assertAllCmsSiteChannelsAccess(siteId);
}
const deliveryStatus = sql<'pending'|'retrying'|'processing'|'failed'|'delivered'>`case when ${cmsTelemetryOutbox.deliveredAt} is not null then 'delivered'
  when ${cmsTelemetryOutbox.deadLetterAt} is not null then 'failed'
  when ${cmsTelemetryOutbox.leaseExpiresAt}>now() then 'processing'
  when ${cmsTelemetryOutbox.consecutiveFailures}>0 then 'retrying' else 'pending' end`;
export async function listCmsTelemetryDeliveries(siteId: number, query: QueryOutputOf<typeof cmsTelemetryAdminContract.deliveries>) {
  await assertDeliveryAccess(siteId);
  const where: SQL = sql`${cmsTelemetryOutbox.siteId}=${siteId} ${query.status ? sql`and ${deliveryStatus}=${query.status}` : sql``}`;
  return buildListResult({ page: query.page, pageSize: query.pageSize,
    count: () => db.$count(cmsTelemetryOutbox, where),
    rows: () => db.select({ id: cmsTelemetryOutbox.id, siteId: cmsTelemetryOutbox.siteId, eventId: cmsTelemetryOutbox.eventId,
      name: sql<string>`${cmsTelemetryOutbox.payload}->>'name'`, targetName: sql<string|null>`${cmsTelemetryOutbox.payload}->>'targetName'`,
      occurredAt: sql<string>`${cmsTelemetryOutbox.payload}->>'occurredAt'`, createdAt: cmsTelemetryOutbox.createdAt, deliveredAt: cmsTelemetryOutbox.deliveredAt,
      status: deliveryStatus, attempts: cmsTelemetryOutbox.attempts, replayCount: cmsTelemetryOutbox.replayCount,
      lastError: cmsTelemetryOutbox.lastError, nextAttemptAt: sql<Date|null>`case when ${deliveryStatus} in ('delivered','failed') then null else ${cmsTelemetryOutbox.nextAttemptAt} end`, lastAttemptAt: cmsTelemetryOutbox.lastAttemptAt,
      contextAvailable: sql<boolean>`${cmsTelemetryOutbox.payload}->'context' is not null and ${cmsTelemetryOutbox.payload}->'context'<>'null'::jsonb`,
      attributionStatus: cmsTelemetryAttributions.status, attributionComputedAt: cmsTelemetryAttributions.computedAt, attributionSettledAt: cmsTelemetryAttributions.settledAt,
      originContentTitle: sql<string|null>`${cmsTelemetryAttributions.origin}->>'originContentTitle'`,
    }).from(cmsTelemetryOutbox).leftJoin(cmsTelemetryAttributions,eq(cmsTelemetryAttributions.eventId,cmsTelemetryOutbox.eventId)).where(where)
      .orderBy(sql`${cmsTelemetryOutbox.createdAt} desc`,sql`${cmsTelemetryOutbox.id} desc`).limit(query.pageSize).offset((query.page-1)*query.pageSize),
    map: row => pickEntity(cmsTelemetryDeliverySchema,row),
  });
}
export async function getCmsTelemetryDeliverySummary(siteId: number) {
  await assertDeliveryAccess(siteId);
  const [row] = await db.execute<{pending:number;retrying:number;processing:number;failed:number;oldestPendingAt:string|null;oldestPendingAgeSeconds:number;missingContext:number;pendingAttribution:number}>(sql`
    select count(*) filter(where o.delivered_at is null and o.dead_letter_at is null)::int as pending,
      count(*) filter(where o.delivered_at is null and o.dead_letter_at is null and o.consecutive_failures>0)::int as retrying,
      count(*) filter(where o.delivered_at is null and o.lease_expires_at>now())::int as processing,
      count(*) filter(where o.delivered_at is null and o.dead_letter_at is not null)::int as failed,
      min(o.created_at) filter(where o.delivered_at is null) as "oldestPendingAt",
      coalesce(greatest(0,extract(epoch from now()-min(o.created_at) filter(where o.delivered_at is null))),0)::int as "oldestPendingAgeSeconds",
      count(*) filter(where o.payload->'context'='null'::jsonb)::int as "missingContext",
      count(*) filter(where a.next_recompute_at is not null)::int as "pendingAttribution"
    from public.cms_telemetry_outbox o left join public.cms_telemetry_attributions a on a.event_id=o.event_id where o.site_id=${siteId}`);
  return { ...row, oldestPendingAt: row.oldestPendingAt ? new Date(row.oldestPendingAt).toISOString() : null };
}
export async function replayCmsTelemetryDelivery(siteId: number, deliveryId: number) {
  await assertDeliveryAccess(siteId);
  return db.transaction(async tx => {
    const row = requireRow((await tx.select().from(cmsTelemetryOutbox).where(and(eq(cmsTelemetryOutbox.id,deliveryId),eq(cmsTelemetryOutbox.siteId,siteId))).limit(1).for('update'))[0],'转化投递记录不存在');
    if(row.leaseExpiresAt && row.leaseExpiresAt>new Date())throw new HTTPException(409,{message:'该记录正在投递，请稍后重试'});
    await tx.update(cmsTelemetryOutbox).set({replayCount:sql`${cmsTelemetryOutbox.replayCount}+1`,...(row.deliveredAt?{}:{nextAttemptAt:new Date(),deadLetterAt:null,consecutiveFailures:0,leaseOwner:null,leaseExpiresAt:null})}).where(eq(cmsTelemetryOutbox.id,row.id));
    if(row.deliveredAt)await tx.update(cmsTelemetryAttributions).set({nextRecomputeAt:new Date(),settledAt:null}).where(eq(cmsTelemetryAttributions.eventId,row.eventId));
    return {queued:true as const,eventId:row.eventId,mode:row.deliveredAt?'attribution' as const:'delivery' as const};
  });
}
