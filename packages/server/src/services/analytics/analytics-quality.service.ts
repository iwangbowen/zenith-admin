/**
 * 行为中心阶段 1：埋点质量看板查询 + 事件调试流查询。
 * 租户安全语义对齐 analytics-rollup.service.ts 的 rollupTenantScope（0 = 无租户哨兵，
 * 平台超管未选择查看租户时视为跨租户汇总，不强制报错——与治理覆盖（B.7）语义不同）。
 */
import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { analyticsEventQualityDaily, userEvents } from '../../db/schema';
import { buildListResult } from '../../lib/list-query';
import { analyticsContract } from '@zenith/shared/analytics';
import type { AnalyticsQualityIssueType } from '@zenith/shared/analytics';
import type { QueryOutputOf } from '@zenith/shared/core';
import { formatDate, formatDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { config } from '../../config';
import { currentUser } from '../../lib/context';
import { isPlatformAdmin, getEffectiveTenantId, tenantScope } from '../../lib/tenant';
import { clampDays } from '../../lib/analytics-helpers';
import { buildWhere } from '../../lib/where-helpers';

/** 质量日聚合表租户过滤：语义对齐 rollupTenantScope（tenantId 非空，0 表示无租户）。 */
export function qualityTenantScope(): SQL | undefined {
  if (!config.multiTenantMode) return undefined;
  const user = currentUser();
  const effective = getEffectiveTenantId(user);
  if (isPlatformAdmin(user) && effective === null) return undefined;
  return eq(analyticsEventQualityDaily.tenantId, effective ?? 0);
}

export async function queryQuality(q: QueryOutputOf<typeof analyticsContract.quality>) {
  const days = clampDays(q.days, 7, 90);
  const { page, pageSize } = q;
  const startDate = formatDate(new Date(Date.now() - (days - 1) * 86_400_000));

  const where = buildWhere(
    gte(analyticsEventQualityDaily.statDate, startDate),
    q.eventName ? eq(analyticsEventQualityDaily.eventName, q.eventName) : undefined,
    q.issueType ? eq(analyticsEventQualityDaily.issueType, q.issueType) : undefined,
    qualityTenantScope(),
  );

  const [items, totalCount, totals] = await Promise.all([
    db.select().from(analyticsEventQualityDaily).where(where)
      .orderBy(desc(analyticsEventQualityDaily.statDate), desc(analyticsEventQualityDaily.count))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(analyticsEventQualityDaily, where),
    db.select({ issueType: analyticsEventQualityDaily.issueType, count: sql<number>`sum(${analyticsEventQualityDaily.count})` })
      .from(analyticsEventQualityDaily).where(where).groupBy(analyticsEventQualityDaily.issueType),
  ]);

  return {
    items: items.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      statDate: r.statDate,
      eventName: r.eventName,
      issueType: r.issueType,
      count: Number(r.count),
      sample: r.sample ?? null,
      lastSeenAt: formatDateTime(r.lastSeenAt),
      createdAt: formatDateTime(r.createdAt),
      updatedAt: formatDateTime(r.updatedAt),
    })),
    totals: totals.map((t) => ({ issueType: t.issueType, count: Number(t.count) })),
    totalCount,
    page,
    pageSize,
  };
}

export async function listDebugEvents(q: QueryOutputOf<typeof analyticsContract.debugEvents>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.eventName ? eq(userEvents.eventName, q.eventName) : undefined,
    tenantScope(userEvents),
  );

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(userEvents, where),
    rows: async () => {
      const rows = await db
        .select({
          id: userEvents.id,
          eventId: userEvents.eventId,
          eventType: userEvents.eventType,
          eventName: userEvents.eventName,
          source: userEvents.source,
          appId: userEvents.appId,
          environment: userEvents.environment,
          distinctId: userEvents.distinctId,
          memberId: userEvents.memberId,
          userId: userEvents.userId,
          pagePath: userEvents.pagePath,
          properties: userEvents.properties,
          createdAt: userEvents.createdAt,
        })
        .from(userEvents)
        .where(where)
        .orderBy(desc(userEvents.createdAt))
        .limit(pageSize)
        .offset(pageOffset(page, pageSize));

      const eventNames = [...new Set(rows.map((r) => r.eventName).filter((n): n is string => !!n))];
      const issueTypesByEventName = new Map<string, AnalyticsQualityIssueType[]>();
      if (eventNames.length > 0) {
        const today = formatDate(new Date());
        const scopeQ = qualityTenantScope();
        const issueConditions: SQL[] = [eq(analyticsEventQualityDaily.statDate, today), inArray(analyticsEventQualityDaily.eventName, eventNames)];
        if (scopeQ) issueConditions.push(scopeQ);
        const issueRows = await db
          .select({ eventName: analyticsEventQualityDaily.eventName, issueType: analyticsEventQualityDaily.issueType })
          .from(analyticsEventQualityDaily)
          .where(and(...issueConditions));
        for (const row of issueRows) {
          const list = issueTypesByEventName.get(row.eventName) ?? [];
          if (!list.includes(row.issueType)) list.push(row.issueType);
          issueTypesByEventName.set(row.eventName, list);
        }
      }

      return rows.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        eventType: r.eventType,
        eventName: r.eventName,
        source: r.source,
        appId: r.appId,
        environment: r.environment,
        distinctId: r.distinctId,
        memberId: r.memberId,
        userId: r.userId,
        pagePath: r.pagePath,
        properties: r.properties ?? null,
        createdAt: formatDateTime(r.createdAt),
        issueTypes: r.eventName ? (issueTypesByEventName.get(r.eventName) ?? []) : [],
      }));
    },
  });
}
