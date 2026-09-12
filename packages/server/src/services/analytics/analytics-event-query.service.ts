/**
 * 行为中心阶段 1：通用事件分析工作台（自助查询）。
 *
 * 安全设计：
 *  - groupBy 维度、metric 均为白名单枚举（来自 @zenith/shared），不接受任意列名/原始 SQL
 *  - 属性过滤 key 经严格正则校验，值全部绑定参数，杜绝注入
 *  - segmentId 先校验 tenant 归属，再通过 analytics_segment_members 子查询过滤 distinctId
 *  - 所有查询强制 tenantScope
 */
import { eq, gte, inArray, lte, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { userEvents } from '../../db/schema';
import type { AnalyticsEventQuery, AnalyticsEventQueryResult, AnalyticsEventQueryGroupByField, AnalyticsEventQueryMetric } from '@zenith/shared/analytics';
import { ANALYTICS_EVENT_QUERY_METRICS, analyticsMetricRequiresProperty } from '@zenith/shared/analytics';
import { tenantScope } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { APP_TIME_ZONE, formatDate, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { clampDays } from '../../lib/analytics-helpers';
import { buildJsonPropertyCondition, PROPERTY_KEY_RE } from './analytics-property-filter';
import { ensureSegmentAccessible, segmentMemberDistinctIdSubquery } from './analytics-segments.service';

/** 分组维度白名单 → Drizzle column / SQL 表达式映射，禁止任意列名拼接 */
function groupByExpr(field: AnalyticsEventQueryGroupByField): SQL | PgColumn {
  switch (field) {
    case 'date':
      return sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'YYYY-MM-DD')`;
    case 'eventName':
      return userEvents.eventName;
    case 'pagePath':
      return userEvents.pagePath;
    case 'source':
      return userEvents.source;
    case 'appId':
      return userEvents.appId;
    case 'environment':
      return userEvents.environment;
    case 'browser':
      return userEvents.browser;
    case 'os':
      return userEvents.os;
    case 'deviceType':
      return userEvents.deviceType;
    case 'region':
      return userEvents.region;
    default:
      throw new HTTPException(400, { message: `不支持的分组维度：${field as string}` });
  }
}

function resolveDateRange(input: { startDate?: string; endDate?: string; days?: number }) {
  if (input.startDate && input.endDate) {
    const start = parseDateRangeStart(input.startDate);
    const end = parseDateRangeEnd(input.endDate);
    if (start && end && end >= start) {
      return { start, end, startLabel: input.startDate, endLabel: input.endDate };
    }
  }
  const days = clampDays(input.days, 30);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start, end, startLabel: formatDate(start), endLabel: formatDate(end) };
}

/**
 * 指标 → 聚合表达式。
 *
 * 数值指标作用于 `properties->>key`：jsonb 里同名属性的类型并不受控（同一个 `amount`
 * 可能既有 `12.5` 也有 `"N/A"`），直接 `::numeric` 会让**一行脏数据整条查询报错**。
 * 因此统一先用正则筛出合法数值再转换，非数值行按「不参与计算」处理，
 * 与 SQL 聚合函数忽略 NULL 的语义一致。
 */
function metricExpr(metric: AnalyticsEventQueryMetric, metricProperty: string | null): { value: SQL<number>; order: SQL } {
  if (metric === 'uv') {
    return { value: sql<number>`COUNT(DISTINCT ${userEvents.distinctId})::int`, order: sql`COUNT(DISTINCT ${userEvents.distinctId}) DESC` };
  }
  if (metric === 'events') {
    return { value: sql<number>`COUNT(*)::int`, order: sql`COUNT(*) DESC` };
  }
  if (metric === 'eventsPerUser') {
    // NULLIF 防止分组内 distinctId 全为 NULL 时除零（理论上被 isNotNull 过滤，仍保留兜底）
    const expr = sql`(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT ${userEvents.distinctId}), 0))`;
    return { value: sql<number>`ROUND(${expr}, 2)::float8`, order: sql`${expr} DESC NULLS LAST` };
  }

  if (!metricProperty) {
    throw new HTTPException(400, { message: `指标 ${metric} 需要指定数值属性字段` });
  }
  if (!PROPERTY_KEY_RE.test(metricProperty)) {
    throw new HTTPException(400, { message: `非法的属性 key：${metricProperty}` });
  }
  const numeric = sql`CASE WHEN (${userEvents.properties} ->> ${metricProperty}) ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN (${userEvents.properties} ->> ${metricProperty})::numeric END`;

  const agg = (() => {
    switch (metric) {
      case 'sum': return sql`SUM(${numeric})`;
      case 'avg': return sql`AVG(${numeric})`;
      case 'min': return sql`MIN(${numeric})`;
      case 'max': return sql`MAX(${numeric})`;
      case 'p50': return sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${numeric})`;
      case 'p90': return sql`PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ${numeric})`;
      case 'p95': return sql`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${numeric})`;
      default:
        throw new HTTPException(400, { message: `不支持的指标：${metric as string}` });
    }
  })();
  // COALESCE(...)::numeric 显式转换：percentile_cont 对 numeric 输入返回 double precision，
  // 而 PG 没有 ROUND(double precision, int) 这个函数（只有 ROUND(numeric, int)），
  // 不转换会在运行时报 "function round(double precision, integer) does not exist"
  return { value: sql<number>`ROUND(COALESCE(${agg}, 0)::numeric, 4)::float8`, order: sql`${agg} DESC NULLS LAST` };
}

/**
 * 数值指标需要「该属性存在」的前置条件：与属性过滤同理，
 * 既能命中 properties 的 GIN 索引，也把没有该属性的事件排除在分母之外
 * （否则 avg 会被大量无关事件稀释）。
 */
function metricPropertyGuard(metric: AnalyticsEventQueryMetric, metricProperty: string | null): SQL | null {
  if (!metricProperty || !analyticsMetricRequiresProperty(metric)) return null;
  return sql`(${userEvents.properties} ? ${metricProperty}::text)`;
}

/** 通用事件分析：白名单维度分组 + 多指标统计，返回 rows/total/queryMeta。 */
export async function queryEvents(input: AnalyticsEventQuery): Promise<AnalyticsEventQueryResult> {
  const groupBy = (input.groupBy && input.groupBy.length > 0 ? input.groupBy : (['date'] as AnalyticsEventQueryGroupByField[])).slice(0, 2);
  const metric: AnalyticsEventQueryMetric = (ANALYTICS_EVENT_QUERY_METRICS as readonly string[]).includes(input.metric ?? '')
    ? (input.metric as AnalyticsEventQueryMetric)
    : 'events';
  const metricProperty = input.metricProperty?.trim() || null;
  const { page, pageSize } = input;
  const { start, end, startLabel, endLabel } = resolveDateRange(input);

  const conditions: SQL[] = [gte(userEvents.createdAt, start), lte(userEvents.createdAt, end), isNotNull(userEvents.distinctId)];
  if (input.eventNames && input.eventNames.length > 0) {
    conditions.push(inArray(userEvents.eventName, input.eventNames.slice(0, 20)));
  }
  if (input.source) conditions.push(eq(userEvents.source, input.source));
  if (input.appId) conditions.push(eq(userEvents.appId, input.appId));
  if (input.environment) conditions.push(eq(userEvents.environment, input.environment));
  if (input.deviceType) conditions.push(eq(userEvents.deviceType, input.deviceType));
  for (const filter of (input.propertyFilters ?? []).slice(0, 10)) {
    conditions.push(buildJsonPropertyCondition(userEvents.properties, filter));
  }
  const guard = metricPropertyGuard(metric, metricProperty);
  if (guard) conditions.push(guard);
  if (input.segmentId) {
    await ensureSegmentAccessible(input.segmentId);
    conditions.push(inArray(userEvents.distinctId, segmentMemberDistinctIdSubquery(input.segmentId)));
  }
  const where = buildWhere(...conditions, tenantScope(userEvents));

  const groupByExprs = groupBy.map((g) => groupByExpr(g));
  const { value: valueExpr, order: orderExpr } = metricExpr(metric, metricProperty);
  const dateIndex = groupBy.indexOf('date');
  // SELECT 位序：d0, d1?, value, __total。GROUP BY/ORDER BY 用位置序号，
  // 避免 Drizzle 对同一 sql`` 片段重复绑参后 PG 认不出与 SELECT 表达式相同（42803）。
  const selectPos = [sql`1`, sql`2`] as const;
  const groupByPositions = groupBy.map((_, i) => selectPos[i]);
  const orderByExprs: SQL[] = dateIndex >= 0
    ? [selectPos[dateIndex], ...groupBy.map((_, i) => i).filter((i) => i !== dateIndex).map((i) => selectPos[i])]
    : [orderExpr];

  const selectShape: Record<string, SQL | PgColumn> = {};
  groupBy.forEach((_, i) => { selectShape[`d${i}`] = groupByExprs[i]; });
  selectShape.value = valueExpr;
  selectShape.__total = sql<number>`COUNT(*) OVER()::int`;

  const rows = (await withPagination(
    db
      .select(selectShape)
      .from(userEvents)
      .where(where)
      .groupBy(...groupByPositions)
      .orderBy(...orderByExprs)
      .$dynamic(),
    page,
    pageSize,
  )) as unknown as Array<Record<string, unknown>>;

  // COUNT(*) OVER() 是分组后的窗口计数，即分组总行数；翻到空页时窗口没有行可读，
  // 只能退回「已翻过的行数」，此时前端也不会再往后翻
  const total = rows.length > 0 ? Number(rows[0].__total ?? rows.length) : pageOffset(page, pageSize);

  return {
    list: rows.map((r) => ({
      dimensions: Object.fromEntries(groupBy.map((g, i) => [g, String(r[`d${i}`] ?? '')])),
      value: Number(r.value ?? 0),
    })),
    total,
    page,
    pageSize,
    queryMeta: { metric, metricProperty, groupBy, startDate: startLabel, endDate: endLabel },
  };
}
