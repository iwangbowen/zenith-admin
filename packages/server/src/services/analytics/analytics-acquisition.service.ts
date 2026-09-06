/**
 * 阶段 2：获客渠道与归因报表。
 *
 * 回答「用户从哪来、哪条渠道真正带来转化」。核心是**归因模型**：
 * 一个用户往往有多次触点（先自然搜索进来、几天后点广告回来再下单），
 * 把这次转化算给谁，结论完全不同。首次触点衡量拉新贡献，末次触点衡量促单贡献。
 *
 * 实现口径：
 *  - 触点 = 该用户在分析窗口内的一条事件，取其来源属性（channel/utm/referrer）
 *  - 每个用户按模型只保留一条触点（first_touch 取最早、last_touch 取最晚），
 *    因此各渠道用户数之和 = 总用户数，不会重复计数
 *  - 转化 = 在窗口内触发过 conversionEvent 的用户；转化归属于其被选中的那条触点
 */
import { percentOf } from '@zenith/shared/core';
import { and, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { userEvents } from '../../db/schema';
import type {
  AnalyticsAcquisitionDimension,
  AnalyticsAcquisitionResult,
  AnalyticsAcquisitionRow,
  AnalyticsAttributionModel,
} from '@zenith/shared/analytics';
import { ANALYTICS_ACQUISITION_CHANNEL_LABELS } from '@zenith/shared/analytics';
import { clampDays, startOfDaysAgo } from '../../lib/analytics-helpers';
import { formatDate } from '../../lib/datetime';
import { tenantScope } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { breakdownLabel, breakdownValueSql } from './analytics-breakdown';

export interface AcquisitionQuery {
  days?: number;
  dimension?: AnalyticsAcquisitionDimension;
  model?: AnalyticsAttributionModel;
  conversionEvent?: string;
  limit?: number;
}

function labelOf(dimension: AnalyticsAcquisitionDimension, value: string): string {
  if (dimension === 'channel') {
    return ANALYTICS_ACQUISITION_CHANNEL_LABELS[value as keyof typeof ANALYTICS_ACQUISITION_CHANNEL_LABELS] ?? value;
  }
  return breakdownLabel(dimension, value);
}

export async function getAcquisitionReport(input: AcquisitionQuery): Promise<AnalyticsAcquisitionResult> {
  const days = clampDays(input.days, 30);
  const start = startOfDaysAgo(days);
  const dimension: AnalyticsAcquisitionDimension = input.dimension ?? 'channel';
  const model: AnalyticsAttributionModel = input.model === 'first_touch' ? 'first_touch' : 'last_touch';
  const conversionEvent = input.conversionEvent?.trim() || null;
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);

  const dimExpr = breakdownValueSql(dimension);
  const where = buildWhere(and(gte(userEvents.createdAt, start), isNotNull(userEvents.distinctId)), tenantScope(userEvents))!;
  // 全历史首见时间：用于区分「新用户」——窗口内首次出现 ≠ 真正的新用户，
  // 老用户在窗口内回访也会在窗口内"首次出现"
  const historyWhere = buildWhere(isNotNull(userEvents.distinctId), tenantScope(userEvents))!;
  // 裸 Date 插进原生 sql`` 没有列类型可推断，postgres 驱动无法编码；
  // 显式转 ISO 字符串并标注 ::timestamptz，避免依赖驱动的隐式行为
  const startParam = sql`${start.toISOString()}::timestamptz`;

  // DISTINCT ON 取每用户一条触点：ORDER BY 的方向由归因模型决定
  const touchOrder = model === 'first_touch' ? sql`ASC` : sql`DESC`;
  const conversionCte = conversionEvent
    ? sql`, conversions AS (
        SELECT DISTINCT ${userEvents.distinctId} AS distinct_id
        FROM ${userEvents}
        WHERE ${where} AND ${userEvents.eventName} = ${conversionEvent}
      )`
    : sql``;
  const conversionSelect = conversionEvent
    ? sql`COUNT(*) FILTER (WHERE c.distinct_id IS NOT NULL)::int`
    : sql`0::int`;
  const conversionJoin = conversionEvent
    ? sql`LEFT JOIN conversions c ON c.distinct_id = t.distinct_id`
    : sql``;

  const rows = (await db.execute(sql`
    WITH touches AS (
      SELECT DISTINCT ON (${userEvents.distinctId})
             ${userEvents.distinctId} AS distinct_id,
             COALESCE(${dimExpr}, '') AS dim_value
      FROM ${userEvents}
      WHERE ${where}
      ORDER BY ${userEvents.distinctId}, ${userEvents.createdAt} ${touchOrder}
    ),
    first_seen AS (
      SELECT ${userEvents.distinctId} AS distinct_id, MIN(${userEvents.createdAt}) AS first_at
      FROM ${userEvents}
      WHERE ${historyWhere}
      GROUP BY ${userEvents.distinctId}
    ),
    session_counts AS (
      SELECT distinct_id, COUNT(*)::int AS session_count
      FROM (
        SELECT DISTINCT ${userEvents.distinctId} AS distinct_id, ${userEvents.sessionId} AS session_id
        FROM ${userEvents}
        WHERE ${where} AND ${userEvents.sessionId} IS NOT NULL
      ) sess
      GROUP BY distinct_id
    )${conversionCte}
    SELECT t.dim_value AS dim_value,
           COUNT(*)::int AS users,
           COUNT(*) FILTER (WHERE f.first_at >= ${startParam})::int AS new_users,
           COALESCE(SUM(s.session_count), 0)::int AS sessions,
           ${conversionSelect} AS conversions
    FROM touches t
    LEFT JOIN first_seen f ON f.distinct_id = t.distinct_id
    LEFT JOIN session_counts s ON s.distinct_id = t.distinct_id
    ${conversionJoin}
    GROUP BY t.dim_value
    ORDER BY users DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ dim_value: string; users: number; new_users: number; sessions: number; conversions: number }>;

  const list: AnalyticsAcquisitionRow[] = rows.map((r) => {
    const users = Number(r.users ?? 0);
    const conversions = Number(r.conversions ?? 0);
    return {
      key: r.dim_value ?? '',
      label: labelOf(dimension, r.dim_value ?? ''),
      users,
      newUsers: Number(r.new_users ?? 0),
      sessions: Number(r.sessions ?? 0),
      conversions,
      conversionRate: percentOf(conversions, users) ?? 0,
    };
  });

  return {
    rows: list,
    dimension,
    model,
    conversionEvent,
    totalUsers: list.reduce((sum, r) => sum + r.users, 0),
    totalConversions: list.reduce((sum, r) => sum + r.conversions, 0),
    startDate: formatDate(start),
    endDate: formatDate(new Date()),
  };
}
