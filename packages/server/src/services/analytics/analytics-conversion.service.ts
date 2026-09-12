/**
 * 行为中心阶段 1：有序转化漏斗 + 双口径留存分析。
 *
 * 从 analytics.service.ts 抽出（原实现为集合交集漏斗 + 单口径留存），
 * 遵循 Zenith 重构边界约定：新增查询不再继续塞入越来越臃肿的 analytics.service.ts。
 *
 * 安全设计：
 *  - 漏斗/留存均强制 tenantScope，参数化查询，禁止 sql.raw(用户输入)
 *  - 漏斗 segmentId 仅作用于首步，调用前经 ensureSegmentAccessible 校验分群 tenant 归属
 *  - 漏斗步骤属性过滤复用 analytics-property-filter 的白名单 key 正则 + 绑定参数比较
 */
import { percentOf } from '@zenith/shared/core';
import { and, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { userEvents } from '../../db/schema';
import type { AnalyticsBreakdownDimension, AnalyticsComparison, FunnelQuery, FunnelResult, FunnelStepResult, RetentionCohort, RetentionResult, AnalyticsRetentionMode, AnalyticsRetentionPeriodType } from '@zenith/shared/analytics';
import { ANALYTICS_RETENTION_PERIOD_LIMITS, ANALYTICS_RETENTION_PERIOD_TYPES } from '@zenith/shared/analytics';
import { tenantScope } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { clampDays, startOfDaysAgo } from '../../lib/analytics-helpers';
import { APP_TIME_ZONE, formatDate, parseDateRangeStart } from '../../lib/datetime';
import { buildJsonPropertyCondition } from './analytics-property-filter';
import { breakdownValueSql, resolveComparisonSeries } from './analytics-breakdown';
import { ensureSegmentAccessible } from './analytics-segments.service';

const DAY_MS = 86_400_000;

// ════════════════════════════════════════════════════════════════════════════
// 漏斗分析（有序转化：严格步骤先后顺序 + 转化窗口）
// ════════════════════════════════════════════════════════════════════════════

function clampConversionWindowHours(hours: unknown): number {
  return Math.min(Math.max(Number(hours) || 72, 1), 720);
}

/** 单步的事件/页面/属性过滤条件（不含时间窗，时间窗由调用方按 CTE 层级拼接）；未设置的维度为 undefined，由 buildWhere 过滤 */
function buildStepConditions(step: FunnelQuery['steps'][number]): (SQL | undefined)[] {
  return [
    step.eventType ? eq(userEvents.eventType, step.eventType) : undefined,
    step.eventName ? eq(userEvents.eventName, step.eventName) : undefined,
    step.pagePath ? eq(userEvents.pagePath, step.pagePath) : undefined,
    step.elementKey ? eq(userEvents.elementKey, step.elementKey) : undefined,
    ...(step.properties ?? []).map((f) => buildJsonPropertyCondition(userEvents.properties, f)),
  ];
}

/**
 * 有序转化漏斗：
 *  - s0：每用户完成首步的最早事件时间（first_at = step_at）
 *  - sN（N>0）：针对 sN-1 每用户，取时间 >= 上一步事件时间 且 <= 首步时间 + 转化窗口 的下一步最早事件，
 *    从而保证严格的步骤先后顺序（允许同一时刻发生）
 *  - 对比轴（维度拆分 / 群组对比）只作用于首步：漏斗的语义是「从同一批人出发」，
 *    若每步都按维度过滤，用户中途换设备就会被算作流失，转化率被系统性低估
 */
export async function getFunnel(input: FunnelQuery): Promise<FunnelResult> {
  const days = clampDays(input.days, 30);
  const start = startOfDaysAgo(days);
  const windowHours = clampConversionWindowHours(input.conversionWindowHours);
  const comparison: AnalyticsComparison = input.comparison ?? { type: 'none' };
  if (!input.steps || input.steps.length === 0) return { series: [], comparison };

  const series = await resolveComparisonSeries(
    comparison,
    (dimension) => topBreakdownValues(dimension, start),
    (segmentId) => segmentDisplayName(segmentId),
  );

  const results = await Promise.all(
    series.map(async (s) => ({ meta: s, data: await runFunnel(input, start, windowHours, s.condition) })),
  );

  return {
    series: results.map(({ meta, data }) => ({ key: meta.key, label: meta.label, ...data })),
    comparison,
  };
}

/** 单条序列的漏斗计算；`seriesCondition` 仅约束首步人群 */
async function runFunnel(
  input: FunnelQuery,
  start: Date,
  windowHours: number,
  seriesCondition?: SQL,
): Promise<{ steps: FunnelStepResult[]; totalUsers: number; overallConversionRate: number }> {
  const ctes = buildFunnelCtes(input, start, windowHours, seriesCondition);
  const countSelects = input.steps.map((_, i) => sql`(SELECT COUNT(*) FROM ${sql.raw(`s${i}`)})::int AS ${sql.raw(`c${i}`)}`);
  const avgSelects = input.steps.map((_, i) => (i === 0
    ? sql`NULL::float AS ${sql.raw(`a${i}`)}`
    : sql`(SELECT AVG(step_delta_ms) FROM ${sql.raw(`s${i}`)})::float AS ${sql.raw(`a${i}`)}`));

  const rows = (await db.execute(
    sql`WITH ${sql.join(ctes, sql`, `)} SELECT ${sql.join([...countSelects, ...avgSelects], sql`, `)}`,
  )) as unknown as Array<Record<string, number | null>>;
  const countRow = rows[0] ?? {};

  const totalUsers = Number(countRow.c0 ?? 0);
  let prevUsers = totalUsers;
  const steps = input.steps.map((step, i) => {
    const users = Number(countRow[`c${i}`] ?? 0);
    const avgRaw = countRow[`a${i}`];
    const result: FunnelStepResult = {
      label: step.label,
      users,
      conversionRate: percentOf(users, totalUsers) ?? 0,
      stepConversionRate: percentOf(users, prevUsers) ?? 0,
      dropoff: Math.max(0, prevUsers - users),
      averageConversionMs: i === 0 || avgRaw == null ? null : Math.round(Number(avgRaw)),
    };
    prevUsers = users;
    return result;
  });

  const finalUsers = steps.at(-1)?.users ?? 0;
  return { steps, totalUsers, overallConversionRate: percentOf(finalUsers, totalUsers) ?? 0 };
}

/** 漏斗各步 CTE；下钻复用同一构造，保证「图上的数」与「下钻的人」同源 */
export function buildFunnelCtes(
  input: Pick<FunnelQuery, 'steps'>,
  start: Date,
  windowHours: number,
  seriesCondition?: SQL,
): SQL[] {
  return input.steps.map((step, i) => {
    const stepConditions = buildStepConditions(step);
    if (i === 0) {
      const where = buildWhere(gte(userEvents.createdAt, start), isNotNull(userEvents.distinctId), ...stepConditions, seriesCondition, tenantScope(userEvents))!;
      return sql`${sql.raw(`s${i}`)} AS (
        SELECT ${userEvents.distinctId} AS distinct_id,
               MIN(${userEvents.createdAt}) AS first_at,
               MIN(${userEvents.createdAt}) AS step_at,
               NULL::bigint AS step_delta_ms
        FROM ${userEvents}
        WHERE ${where}
        GROUP BY ${userEvents.distinctId}
      )`;
    }
    const where = buildWhere(isNotNull(userEvents.distinctId), ...stepConditions, tenantScope(userEvents))!;
    const prevAlias = sql.raw(`s${i - 1}`);
    return sql`${sql.raw(`s${i}`)} AS (
      SELECT prev.distinct_id AS distinct_id,
             prev.first_at AS first_at,
             MIN(${userEvents.createdAt}) AS step_at,
             (EXTRACT(EPOCH FROM (MIN(${userEvents.createdAt}) - prev.step_at)) * 1000)::bigint AS step_delta_ms
      FROM ${prevAlias} prev
      JOIN ${userEvents} ON ${userEvents.distinctId} = prev.distinct_id
        AND ${userEvents.createdAt} >= prev.step_at
        AND ${userEvents.createdAt} <= prev.first_at + make_interval(hours => ${windowHours})
        AND ${where}
      GROUP BY prev.distinct_id, prev.first_at, prev.step_at
    )`;
  });
}

/**
 * 维度拆分的候选取值：按覆盖用户数降序。
 * 与后续统计共用同一时间窗与 tenantScope，避免出现「图例里有但没有数据」的空序列。
 */
export async function topBreakdownValues(dimension: AnalyticsBreakdownDimension, start: Date): Promise<string[]> {
  const expr = breakdownValueSql(dimension);
  const where = buildWhere(and(gte(userEvents.createdAt, start), isNotNull(userEvents.distinctId)), tenantScope(userEvents))!;
  const rows = (await db.execute(sql`
    SELECT COALESCE(${expr}, '') AS value, COUNT(DISTINCT ${userEvents.distinctId})::int AS users
    FROM ${userEvents}
    WHERE ${where}
    GROUP BY 1
    ORDER BY users DESC
    LIMIT ${BREAKDOWN_CANDIDATE_LIMIT}
  `)) as unknown as Array<{ value: string; users: number }>;
  return rows.map((r) => r.value);
}

/** 候选取值扫描上限：只需判断「有没有长尾」，无需取回全部高基数取值 */
const BREAKDOWN_CANDIDATE_LIMIT = 50;

async function segmentDisplayName(segmentId: number): Promise<string> {
  const row = await ensureSegmentAccessible(segmentId);
  return row.name;
}

// ════════════════════════════════════════════════════════════════════════════
// 留存分析（双口径：first_seen 全历史真实首访 / window_first 当前窗口首现）
// ════════════════════════════════════════════════════════════════════════════

export interface RetentionQuery {
  days?: unknown;
  mode?: AnalyticsRetentionMode;
  periodType?: AnalyticsRetentionPeriodType;
  maxPeriods?: unknown;
  comparison?: AnalyticsComparison;
}

/** PG `date_trunc` 的周起点是周一，月起点是 1 日；轴生成必须与之完全一致，否则矩阵会整体错位 */
function truncPeriodStart(date: Date, periodType: AnalyticsRetentionPeriodType): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (periodType === 'week') {
    // getDay(): 0=周日，转换为「距本周一的天数」
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  } else if (periodType === 'month') {
    d.setDate(1);
  }
  return d;
}

function nextPeriodStart(date: Date, periodType: AnalyticsRetentionPeriodType): Date {
  const d = new Date(date);
  if (periodType === 'month') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + (periodType === 'week' ? 7 : 1));
  return d;
}

/**
 * 生成与 PG `date_trunc(periodType, ...)` 对齐的周期起点轴，覆盖 [今天 - (days-1), 今天]。
 * 返回值即矩阵的队列轴，`axis[ci + p]` 表示队列 ci 之后的第 p 个周期。
 */
export function retentionPeriodAxis(periodType: AnalyticsRetentionPeriodType, days: number): string[] {
  const todayStart = parseDateRangeStart(formatDate(new Date())) ?? new Date();
  const windowStart = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const lastPeriod = truncPeriodStart(todayStart, periodType);
  const axis: string[] = [];
  for (let cursor = truncPeriodStart(windowStart, periodType); cursor <= lastPeriod; cursor = nextPeriodStart(cursor, periodType)) {
    axis.push(formatDate(cursor));
  }
  return axis;
}

/**
 * - window_first（默认口径不变）：队列 = 用户在本次查询窗口内首次出现的周期
 * - first_seen：队列 = 用户在全部历史（不受本次查询窗口限制）中真正首次出现的周期，
 *   仅保留首次周期落在本次分析轴内的队列；真实首访日的 MIN() 计算不能提前做日期过滤，
 *   否则会把"窗口内首次出现"误判为"全局首次出现"
 *
 * periodType 决定队列与回访的分桶粒度（日 / 周 / 月留存），maxPeriods 决定矩阵列数。
 */
export async function getRetention(input: RetentionQuery): Promise<RetentionResult> {
  const periodType: AnalyticsRetentionPeriodType = ANALYTICS_RETENTION_PERIOD_TYPES.includes(input.periodType as AnalyticsRetentionPeriodType)
    ? (input.periodType as AnalyticsRetentionPeriodType)
    : 'day';
  const limits = ANALYTICS_RETENTION_PERIOD_LIMITS[periodType];
  const days = clampDays(input.days, limits.defaultDays, limits.maxDays);
  const maxPeriods = Math.min(Math.max(Number(input.maxPeriods) || limits.defaultPeriods, 1), limits.maxPeriods);
  const mode: AnalyticsRetentionMode = input.mode === 'first_seen' ? 'first_seen' : 'window_first';
  const comparison: AnalyticsComparison = input.comparison ?? { type: 'none' };
  const start = startOfDaysAgo(days);
  const axis = retentionPeriodAxis(periodType, days);
  // 列数不能超过轴长度：否则最早队列之外的列对所有队列都是 null，只会撑宽表格
  const periods = Array.from({ length: Math.min(maxPeriods, axis.length) }, (_, i) => i);

  const resolved = await resolveComparisonSeries(
    comparison,
    (dimension) => topBreakdownValues(dimension, start),
    (segmentId) => segmentDisplayName(segmentId),
  );

  const series = await Promise.all(resolved.map(async (s) => {
    const matrix = await loadRetentionMatrix({ mode, periodType, start, axis, seriesCondition: s.condition });
    const cohorts = buildRetentionCohorts(axis, periods, matrix);
    return { key: s.key, label: s.label, cohorts, ...summarizeRetention(cohorts, periods) };
  }));

  return { series, periods, mode, periodType, days, comparison };
}

interface RetentionMatrixInput {
  mode: AnalyticsRetentionMode;
  periodType: AnalyticsRetentionPeriodType;
  start: Date;
  axis: string[];
  seriesCondition?: SQL;
}

/** 队列 × 活跃周期 → 活跃人数矩阵；key 为 `cohort\u0001period` */
async function loadRetentionMatrix(input: RetentionMatrixInput): Promise<Map<string, number>> {
  const { mode, periodType, start, axis, seriesCondition } = input;
  const axisStart = axis[0];
  const axisEnd = axis[axis.length - 1];
  const activityWhere = buildWhere(gte(userEvents.createdAt, start), isNotNull(userEvents.distinctId), seriesCondition, tenantScope(userEvents))!;
  // periodType 来自白名单枚举，仍以绑定参数传入（date_trunc 首参为 text），不做字符串拼接
  const activityPeriod = sql`to_char(date_trunc(${periodType}, timezone(${APP_TIME_ZONE}, ${userEvents.createdAt})), 'YYYY-MM-DD')`;

  let rows: Array<{ cohort_date: string; day: string; active: number }>;
  if (mode === 'first_seen') {
    // 全历史（仅 tenantScope + 序列条件，无日期过滤）计算真实首访日，
    // 避免把窗口起点误当作全局首访起点
    const historyWhere = buildWhere(isNotNull(userEvents.distinctId), seriesCondition, tenantScope(userEvents))!;
    rows = (await db.execute(sql`
      WITH activity AS (
        SELECT DISTINCT ${userEvents.distinctId} AS distinct_id,
               ${activityPeriod} AS day
        FROM ${userEvents}
        WHERE ${activityWhere}
      ),
      true_first_seen AS (
        SELECT ${userEvents.distinctId} AS distinct_id,
               to_char(date_trunc(${periodType}, timezone(${APP_TIME_ZONE}, MIN(${userEvents.createdAt}))), 'YYYY-MM-DD') AS cohort_date
        FROM ${userEvents}
        WHERE ${historyWhere}
        GROUP BY ${userEvents.distinctId}
      )
      SELECT f.cohort_date AS cohort_date, a.day AS day, COUNT(*)::int AS active
      FROM activity a
      JOIN true_first_seen f ON f.distinct_id = a.distinct_id
      WHERE f.cohort_date >= ${axisStart} AND f.cohort_date <= ${axisEnd}
      GROUP BY 1, 2
    `)) as unknown as Array<{ cohort_date: string; day: string; active: number }>;
  } else {
    rows = (await db.execute(sql`
      WITH user_days AS (
        SELECT DISTINCT ${userEvents.distinctId} AS distinct_id,
               ${activityPeriod} AS day
        FROM ${userEvents}
        WHERE ${activityWhere}
      ),
      first_day AS (
        SELECT distinct_id, MIN(day) AS cohort_date FROM user_days GROUP BY 1
      )
      SELECT f.cohort_date AS cohort_date, ud.day AS day, COUNT(*)::int AS active
      FROM user_days ud
      JOIN first_day f ON f.distinct_id = ud.distinct_id
      GROUP BY 1, 2
    `)) as unknown as Array<{ cohort_date: string; day: string; active: number }>;
  }

  const matrix = new Map<string, number>();
  for (const r of rows) matrix.set(`${r.cohort_date}\u0001${r.day}`, Number(r.active));
  return matrix;
}

function buildRetentionCohorts(axis: string[], periods: number[], matrix: Map<string, number>): RetentionCohort[] {
  return axis.map((cohortDate, ci) => {
    // 队列用户首个周期必然活跃：矩阵对角线即队列规模
    const size = matrix.get(`${cohortDate}\u0001${cohortDate}`) ?? 0;
    const values = periods.map((p) => {
      const targetStr = axis[ci + p];
      if (targetStr === undefined) return null;
      const active = matrix.get(`${cohortDate}\u0001${targetStr}`) ?? 0;
      return percentOf(active, size) ?? 0;
    });
    return { cohortDate, cohortSize: size, values };
  });
}

/**
 * 各周期的加权平均留存率（按队列规模加权，而非各队列留存率的算术平均）。
 * 算术平均会让一个 3 人的小队列和一个 3 万人的大队列等权，多序列对比时结论会被噪音主导。
 */
function summarizeRetention(cohorts: RetentionCohort[], periods: number[]): { averages: (number | null)[]; totalUsers: number } {
  const averages = periods.map((_, p) => {
    let activeSum = 0;
    let sizeSum = 0;
    for (const cohort of cohorts) {
      const value = cohort.values[p];
      // null = 该队列尚未走到这一周期，不参与平均（否则新队列会把留存率稀释成 0）
      if (value == null || cohort.cohortSize === 0) continue;
      activeSum += (value / 100) * cohort.cohortSize;
      sizeSum += cohort.cohortSize;
    }
    return percentOf(activeSum, sizeSum);
  });
  return { averages, totalUsers: cohorts.reduce((sum, c) => sum + c.cohortSize, 0) };
}
