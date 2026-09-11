/**
 * 阶段 2：图表下钻用户列表。
 *
 * 解决的问题：漏斗告诉你「第 3 步流失了 3000 人」，留存告诉你「第 2 周掉了 60%」，
 * 但看不到「是谁」，分析结论就无法转化为运营动作。本模块把图表坐标翻译成用户集合。
 *
 * 一致性要求：下钻必须复用产生该图表的同一套 SQL 构造（漏斗 CTE、留存分桶、
 * 对比轴条件），否则「图上 3000 人」和「下钻出 2874 人」这种对不上的数字会摧毁信任。
 */
import { gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { analyticsUserProfiles, userEvents } from '../../db/schema';
import type {
  AnalyticsDrillContext,
  AnalyticsDrillUser,
  AnalyticsDrillUsersResult,
  AnalyticsRetentionMode,
  AnalyticsRetentionPeriodType,
} from '@zenith/shared/analytics';
import { ANALYTICS_RETENTION_PERIOD_LIMITS, ANALYTICS_RETENTION_PERIOD_TYPES, analyticsDrillUsersSchema } from '@zenith/shared/analytics';
import type * as z from 'zod';
import { clampDays, startOfDaysAgo } from '../../lib/analytics-helpers';
import { APP_TIME_ZONE, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { tenantScope } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { findSeriesByKey, resolveComparisonSeries } from './analytics-breakdown';
import { buildFunnelCtes, retentionPeriodAxis, topBreakdownValues } from './analytics-conversion.service';
import { ensureSegmentAccessible } from './analytics-segments.service';

/** 路由解析后的请求体（page / pageSize 已补默认值），不再手写同形 interface */
type DrillUsersBody = z.output<typeof analyticsDrillUsersSchema>;

async function segmentDisplayName(segmentId: number): Promise<string> {
  const row = await ensureSegmentAccessible(segmentId);
  return row.name;
}

/**
 * 漏斗下钻：
 *  - converted：到达第 N 步的用户（即 sN 的成员）
 *  - dropped：到达第 N-1 步但没到第 N 步的用户（EXCEPT）
 *
 * 复用 buildFunnelCtes，转化窗口与步骤条件与图表完全一致。
 */
function buildFunnelDrillSql(context: Extract<AnalyticsDrillContext, { type: 'funnel' }>, seriesCondition?: SQL): SQL {
  const days = clampDays(context.days, 30);
  const start = startOfDaysAgo(days);
  const windowHours = Math.min(Math.max(Number(context.conversionWindowHours) || 72, 1), 720);
  const ctes = buildFunnelCtes({ steps: context.steps }, start, windowHours, seriesCondition);
  const target = sql.raw(`s${context.stepIndex}`);

  if (context.outcome === 'converted') {
    return sql`WITH ${sql.join(ctes, sql`, `)} SELECT distinct_id FROM ${target}`;
  }
  // dropped 必然有上一步（schema 层已拒绝 stepIndex=0 的流失下钻）
  const prev = sql.raw(`s${context.stepIndex - 1}`);
  return sql`WITH ${sql.join(ctes, sql`, `)}
    SELECT distinct_id FROM ${prev}
    EXCEPT
    SELECT distinct_id FROM ${target}`;
}

/**
 * 留存下钻：
 *  - retained：属于该队列且在目标周期活跃
 *  - churned：属于该队列但目标周期不活跃
 *
 * 队列归属口径（first_seen 全历史 / window_first 窗口内）与留存矩阵保持一致，
 * 否则下钻出的队列规模会和矩阵第一列对不上。
 */
function buildRetentionDrillSql(context: Extract<AnalyticsDrillContext, { type: 'retention' }>, seriesCondition?: SQL): SQL {
  const periodType: AnalyticsRetentionPeriodType = ANALYTICS_RETENTION_PERIOD_TYPES.includes(context.periodType as AnalyticsRetentionPeriodType)
    ? (context.periodType as AnalyticsRetentionPeriodType)
    : 'day';
  const limits = ANALYTICS_RETENTION_PERIOD_LIMITS[periodType];
  const days = clampDays(context.days, limits.defaultDays, limits.maxDays);
  const mode: AnalyticsRetentionMode = context.mode === 'first_seen' ? 'first_seen' : 'window_first';
  const start = startOfDaysAgo(days);

  const axis = retentionPeriodAxis(periodType, days);
  const cohortIndex = axis.indexOf(context.cohortDate);
  if (cohortIndex < 0) throw new HTTPException(400, { message: '队列日期不在当前分析区间内' });
  const targetPeriod = axis[cohortIndex + context.periodIndex];
  if (targetPeriod === undefined) throw new HTTPException(400, { message: '目标周期超出当前分析区间' });

  const activityConditions: SQL[] = [gte(userEvents.createdAt, start), isNotNull(userEvents.distinctId)];
  if (seriesCondition) activityConditions.push(seriesCondition);
  const activityWhere = buildWhere(...activityConditions, tenantScope(userEvents))!;
  const periodExpr = sql`to_char(date_trunc(${periodType}, timezone(${APP_TIME_ZONE}, ${userEvents.createdAt})), 'YYYY-MM-DD')`;

  const cohortCte = mode === 'first_seen'
    ? (() => {
      const historyConditions: SQL[] = [isNotNull(userEvents.distinctId)];
      if (seriesCondition) historyConditions.push(seriesCondition);
      const historyWhere = buildWhere(...historyConditions, tenantScope(userEvents))!;
      return sql`cohort AS (
        SELECT ${userEvents.distinctId} AS distinct_id
        FROM ${userEvents}
        WHERE ${historyWhere}
        GROUP BY ${userEvents.distinctId}
        HAVING to_char(date_trunc(${periodType}, timezone(${APP_TIME_ZONE}, MIN(${userEvents.createdAt}))), 'YYYY-MM-DD') = ${context.cohortDate}
      )`;
    })()
    : sql`cohort AS (
        SELECT distinct_id FROM (
          SELECT ${userEvents.distinctId} AS distinct_id, MIN(${periodExpr}) AS first_period
          FROM ${userEvents}
          WHERE ${activityWhere}
          GROUP BY ${userEvents.distinctId}
        ) t WHERE first_period = ${context.cohortDate}
      )`;

  const activeCte = sql`active AS (
    SELECT DISTINCT ${userEvents.distinctId} AS distinct_id
    FROM ${userEvents}
    WHERE ${activityWhere} AND ${periodExpr} = ${targetPeriod}
  )`;

  return context.outcome === 'retained'
    ? sql`WITH ${cohortCte}, ${activeCte}
        SELECT distinct_id FROM cohort INTERSECT SELECT distinct_id FROM active`
    : sql`WITH ${cohortCte}, ${activeCte}
        SELECT distinct_id FROM cohort EXCEPT SELECT distinct_id FROM active`;
}

/**
 * 把图表坐标解析为 distinctId 集合，再补齐画像信息后分页返回。
 *
 * 两段式而非一条大 SQL：distinctId 集合来自事件表（可能是 CTE/EXCEPT/INTERSECT），
 * 画像信息来自 analytics_user_profiles，分开后画像缺失的用户仍能列出 distinctId，
 * 不会因为 JOIN 不到画像而凭空少人。
 */
/** 留存上下文的周期粒度归一（与 getRetention 同口径） */
function retentionPeriodTypeOf(context: Extract<AnalyticsDrillContext, { type: 'retention' }>): AnalyticsRetentionPeriodType {
  return ANALYTICS_RETENTION_PERIOD_TYPES.includes(context.periodType as AnalyticsRetentionPeriodType)
    ? (context.periodType as AnalyticsRetentionPeriodType)
    : 'day';
}

/** 下钻上下文对应的分析窗口起点：必须与产生该图表的查询一致 */
function drillWindowStart(context: AnalyticsDrillContext): Date {
  if (context.type === 'funnel') return startOfDaysAgo(clampDays(context.days, 30));
  const limits = ANALYTICS_RETENTION_PERIOD_LIMITS[retentionPeriodTypeOf(context)];
  return startOfDaysAgo(clampDays(context.days, limits.defaultDays, limits.maxDays));
}

export async function drillUsers(input: DrillUsersBody): Promise<AnalyticsDrillUsersResult> {
  const { context, page, pageSize } = input;

  // 对比轴的候选取值必须用与图表相同的时间窗统计，否则「其他」序列的边界会漂移
  const series = await resolveComparisonSeries(
    context.comparison,
    (dimension) => topBreakdownValues(dimension, drillWindowStart(context)),
    (segmentId) => segmentDisplayName(segmentId),
  );
  const target = findSeriesByKey(series, context.seriesKey);

  const idSql = context.type === 'funnel'
    ? buildFunnelDrillSql(context, target.condition)
    : buildRetentionDrillSql(context, target.condition);

  const countRows = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM (${idSql}) AS ids`)) as unknown as Array<{ n: number }>;
  const matchedUsers = Number(countRows[0]?.n ?? 0);
  if (matchedUsers === 0) return { list: [], total: 0, page, pageSize, matchedUsers: 0 };

  // 画像用 LEFT JOIN LATERAL + LIMIT 1：
  //  1. 缺画像的用户仍要出现在列表里（下钻的意义就是找出这些人）
  //  2. 平台视角下 tenantScope 为空，同一 distinctId 可能在多个租户各有一条画像，
  //     普通 JOIN 会把一个用户放大成多行，分页与「命中人数」立刻对不上
  const rows = (await db.execute(sql`
    SELECT ids.distinct_id AS distinct_id,
           p.identity_type AS identity_type,
           p.user_id AS user_id,
           p.member_id AS member_id,
           p.display_name AS display_name,
           p.first_seen_at AS first_seen_at,
           p.last_seen_at AS last_seen_at
    FROM (${idSql}) AS ids
    LEFT JOIN LATERAL (
      SELECT ${analyticsUserProfiles.identityType} AS identity_type,
             ${analyticsUserProfiles.userId} AS user_id,
             ${analyticsUserProfiles.memberId} AS member_id,
             ${analyticsUserProfiles.displayName} AS display_name,
             ${analyticsUserProfiles.firstSeenAt} AS first_seen_at,
             ${analyticsUserProfiles.lastSeenAt} AS last_seen_at
      FROM ${analyticsUserProfiles}
      WHERE ${analyticsUserProfiles.distinctId} = ids.distinct_id
        AND ${profileTenantMatch()}
      ORDER BY ${analyticsUserProfiles.lastSeenAt} DESC
      LIMIT 1
    ) p ON TRUE
    ORDER BY p.last_seen_at DESC NULLS LAST, ids.distinct_id
    LIMIT ${pageSize} OFFSET ${pageOffset(page, pageSize)}
  `)) as unknown as Array<{
    distinct_id: string;
    identity_type: string | null;
    user_id: number | null;
    member_id: number | null;
    display_name: string | null;
    first_seen_at: Date | null;
    last_seen_at: Date | null;
  }>;

  const list: AnalyticsDrillUser[] = rows.map((r) => ({
    distinctId: r.distinct_id,
    identityType: (r.identity_type ?? 'anonymous') as AnalyticsDrillUser['identityType'],
    userId: r.user_id ?? null,
    memberId: r.member_id ?? null,
    displayName: r.display_name ?? null,
    firstSeenAt: formatNullableDateTime(r.first_seen_at),
    lastSeenAt: formatNullableDateTime(r.last_seen_at),
  }));

  return { list, total: matchedUsers, page, pageSize, matchedUsers };
}

/**
 * 画像 JOIN 的租户条件。
 * analytics_user_profiles 的租户唯一键是 `coalesce(tenant_id, 0)`，直接用 tenantScope()
 * 会在平台视角（无租户）下退化成无条件，把其他租户的同名 distinctId 画像 JOIN 进来。
 */
function profileTenantMatch(): SQL {
  const scope = tenantScope(analyticsUserProfiles);
  return scope ?? sql`TRUE`;
}
