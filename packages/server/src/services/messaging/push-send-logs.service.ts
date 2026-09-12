/**
 * App 推送发送记录（追加型日志,回执回调更新送达状态）。
 */
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import type { PushDeliveryStatus, PushProvider, PushSendLogStats, pushSendLogContract } from '@zenith/shared/messaging';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { pushSendLogs, type PushSendLogRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime, startOfRecentDays } from '../../lib/datetime';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { buildListResult } from '../../lib/list-query';
import { resolveUserNames } from '../../lib/user-nicknames';

export function mapPushSendLog(row: PushSendLogRow & { app?: { name: string } | null }, subjectName?: string | null) {
  return {
    id: row.id,
    configId: row.configId ?? null,
    appId: row.appId ?? null,
    appName: row.app?.name ?? null,
    provider: row.provider,
    subjectType: row.subjectType ?? null,
    subjectId: row.subjectId ?? null,
    subjectName: subjectName ?? null,
    deviceCount: row.deviceCount,
    title: row.title,
    content: row.content,
    link: row.link ?? null,
    eventKey: row.eventKey ?? null,
    status: row.status,
    providerMsgId: row.providerMsgId ?? null,
    deliveryStatus: (row.deliveryStatus as PushDeliveryStatus | null) ?? null,
    deliveredAt: formatNullableDateTime(row.deliveredAt),
    clickedAt: formatNullableDateTime(row.clickedAt),
    errorMsg: row.errorMsg ?? null,
    source: row.source,
    tenantId: row.tenantId ?? null,
    sentAt: formatNullableDateTime(row.sentAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listPushSendLogs(q: QueryOutputOf<typeof pushSendLogContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [pushSendLogs.title, pushSendLogs.content, pushSendLogs.eventKey]),
    q.provider ? eq(pushSendLogs.provider, q.provider) : undefined,
    q.status ? eq(pushSendLogs.status, q.status) : undefined,
    ...dateRangeConditions(pushSendLogs.createdAt, q.startTime, q.endTime),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(pushSendLogs, where),
    rows: async () => {
      const rows = await db.query.pushSendLogs.findMany({
        where,
        with: { app: { columns: { name: true } } },
        orderBy: desc(pushSendLogs.id),
        limit: pageSize,
        offset: pageOffset(page, pageSize),
      });

      // 管理端收件人只展示 user 主体的昵称;member 主体显示 ID 即可
      const nameMap = await resolveUserNames(rows.filter((r) => r.subjectType === 'user').map((r) => r.subjectId));

      return rows.map((row) => ({ row, subjectName: row.subjectType === 'user' && row.subjectId ? nameMap.get(row.subjectId) : null }));
    },
    map: ({ row, subjectName }) => mapPushSendLog(row, subjectName),
  });
}

// ─── 送达回执（供应商回调）────────────────────────────────────────────────────

export interface PushReceiptEvent {
  provider: PushProvider;
  msgId: string;
  /** received=送达,click=点击 */
  type: 'received' | 'click';
  /** 事件发生时间（秒级时间戳）,缺省用当前时间 */
  itime?: number;
}

/**
 * 将供应商回执写回发送记录。
 * 按 (provider, providerMsgId) 定位;点击蕴含送达;时间列只写一次(重复回执幂等)。
 * 找不到对应记录时静默忽略——回调方无法区分,返回错误只会招致重试轰炸。
 */
export async function applyPushReceipt(event: PushReceiptEvent): Promise<boolean> {
  const eventAt = (event.itime ? new Date(event.itime * 1000) : new Date()).toISOString();
  const result = await db
    .update(pushSendLogs)
    .set(event.type === 'click'
      ? {
        deliveryStatus: 'clicked' satisfies PushDeliveryStatus,
        clickedAt: sql`coalesce(${pushSendLogs.clickedAt}, ${eventAt}::timestamptz)`,
        deliveredAt: sql`coalesce(${pushSendLogs.deliveredAt}, ${eventAt}::timestamptz)`,
      }
      : {
        // 已是 clicked 的不回退为 delivered
        deliveryStatus: sql`coalesce(${pushSendLogs.deliveryStatus}, 'delivered')`,
        deliveredAt: sql`coalesce(${pushSendLogs.deliveredAt}, ${eventAt}::timestamptz)`,
      })
    .where(and(
      eq(pushSendLogs.provider, event.provider),
      eq(pushSendLogs.providerMsgId, event.msgId),
      event.type === 'click'
        ? or(isNull(pushSendLogs.clickedAt), isNull(pushSendLogs.deliveredAt))
        : isNull(pushSendLogs.deliveredAt),
    ))
    .returning({ id: pushSendLogs.id });
  return result.length > 0;
}

// ─── 记录页统计（窗口汇总 + 按日趋势补零）────────────────────────────────────

export async function getPushSendLogStats(days = 14): Promise<PushSendLogStats> {
  const since = startOfRecentDays(days);

  const dateExpr = sql<string>`to_char(${pushSendLogs.createdAt}, 'YYYY-MM-DD')`;
  const successExpr = sql<number>`count(*) filter (where ${pushSendLogs.status} = 'success')::int`;
  const failedExpr = sql<number>`count(*) filter (where ${pushSendLogs.status} = 'failed')::int`;
  const deliveredExpr = sql<number>`count(*) filter (where ${pushSendLogs.deliveredAt} is not null)::int`;
  const clickedExpr = sql<number>`count(*) filter (where ${pushSendLogs.clickedAt} is not null)::int`;

  const [[totals], trendRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        success: successExpr,
        failed: failedExpr,
        delivered: deliveredExpr,
        clicked: clickedExpr,
      })
      .from(pushSendLogs)
      .where(gte(pushSendLogs.createdAt, since)),
    db
      .select({
        date: dateExpr,
        total: sql<number>`count(*)::int`,
        success: successExpr,
        failed: failedExpr,
        delivered: deliveredExpr,
        clicked: clickedExpr,
      })
      .from(pushSendLogs)
      .where(gte(pushSendLogs.createdAt, since))
      .groupBy(dateExpr),
  ]);

  // 趋势补零:图表需要连续日期轴
  const trendMap = new Map<string, PushSendLogStats['trend'][number]>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    trendMap.set(key, { date: key, total: 0, success: 0, failed: 0, delivered: 0, clicked: 0 });
  }
  for (const row of trendRows) {
    if (trendMap.has(row.date)) trendMap.set(row.date, row);
  }

  return {
    totals: {
      total: totals?.total ?? 0,
      success: totals?.success ?? 0,
      failed: totals?.failed ?? 0,
      delivered: totals?.delivered ?? 0,
      clicked: totals?.clicked ?? 0,
    },
    trend: [...trendMap.values()],
  };
}
