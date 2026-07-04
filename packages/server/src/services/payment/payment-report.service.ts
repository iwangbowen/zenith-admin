/**
 * 支付财务报表 Service。
 * 基于资金台账（payment_ledger_entries）按业务类型/渠道/日聚合，
 * 输出每组的收款(gross)/手续费(fee)/退款(refund)/净额(net)/成功笔数(count)。
 *
 * 性能：历史日期走日切快照表 payment_report_daily（cron rebuildPaymentReportDaily 预聚合），
 * 仅当日数据实时聚合台账后合并，避免大表全量扫描；支持环比（对比上一等长周期）。
 */
import { and, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { paymentLedgerEntries, paymentReportDaily } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { mergeWhere } from '../../lib/where-helpers';
import { formatDate, parseDateTimeInput } from '../../lib/datetime';
import logger from '../../lib/logger';
import { PAYMENT_CHANNEL_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentReportGroupBy, PaymentReportRow } from '@zenith/shared';

export interface ReportSummaryQuery {
  groupBy?: PaymentReportGroupBy;
  startTime?: string;
  endTime?: string;
  /** 环比：附带上一等长周期的汇总（需同时提供 startTime/endTime） */
  compare?: boolean;
}

export interface ReportTotals {
  totalGross: number;
  totalFee: number;
  totalRefund: number;
  totalNet: number;
  totalCount: number;
}

export interface ReportSummary extends ReportTotals {
  groupBy: PaymentReportGroupBy;
  rows: PaymentReportRow[];
  /** 环比周期汇总（compare=true 且提供时间范围时返回） */
  prev?: ReportTotals | null;
}

function labelFor(groupBy: PaymentReportGroupBy, key: string): string {
  if (groupBy === 'channel') return PAYMENT_CHANNEL_LABELS[key as PaymentChannel] ?? (key || '未知');
  return key || '未知';
}

interface AggRow {
  key: string;
  gross: number;
  fee: number;
  refund: number;
  count: number;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 实时聚合台账（仅用于当日或快照未覆盖的窗口） */
async function aggregateFromLedger(groupBy: PaymentReportGroupBy, start: Date | null, end: Date | null): Promise<AggRow[]> {
  const conds: SQL[] = [];
  if (start) conds.push(gte(paymentLedgerEntries.createdAt, start));
  if (end) conds.push(lte(paymentLedgerEntries.createdAt, end));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentLedgerEntries, currentUser()));
  const keyExpr =
    groupBy === 'channel'
      ? sql<string>`coalesce(${paymentLedgerEntries.channel}::text, '')`
      : groupBy === 'bizType'
        ? sql<string>`coalesce(${paymentLedgerEntries.bizType}, '')`
        : sql<string>`to_char(${paymentLedgerEntries.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      key: keyExpr,
      gross: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'payment' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      fee: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'fee' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      refund: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'refund' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      count: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'payment' then 1 else 0 end),0)`,
    })
    .from(paymentLedgerEntries)
    .where(where)
    .groupBy(keyExpr);
  return rows.map((r) => ({ key: r.key, gross: Number(r.gross), fee: Number(r.fee), refund: Number(r.refund), count: Number(r.count) }));
}

/** 快照聚合（历史整日数据；statDate 为闭区间） */
async function aggregateFromSnapshot(groupBy: PaymentReportGroupBy, startDate: string | null, endDate: string): Promise<AggRow[]> {
  const conds: SQL[] = [lte(paymentReportDaily.statDate, endDate)];
  if (startDate) conds.push(gte(paymentReportDaily.statDate, startDate));
  const where = mergeWhere(and(...conds), tenantCondition(paymentReportDaily, currentUser()));
  const keyExpr =
    groupBy === 'channel'
      ? paymentReportDaily.channel
      : groupBy === 'bizType'
        ? paymentReportDaily.bizType
        : paymentReportDaily.statDate;
  const rows = await db
    .select({
      key: sql<string>`${keyExpr}`,
      gross: sql<number>`coalesce(sum(${paymentReportDaily.gross}),0)`,
      fee: sql<number>`coalesce(sum(${paymentReportDaily.fee}),0)`,
      refund: sql<number>`coalesce(sum(${paymentReportDaily.refund}),0)`,
      count: sql<number>`coalesce(sum(${paymentReportDaily.count}),0)`,
    })
    .from(paymentReportDaily)
    .where(where)
    .groupBy(keyExpr);
  return rows.map((r) => ({ key: r.key, gross: Number(r.gross), fee: Number(r.fee), refund: Number(r.refund), count: Number(r.count) }));
}

function mergeAggRows(parts: AggRow[][]): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const rows of parts) {
    for (const r of rows) {
      const exist = map.get(r.key);
      if (exist) {
        exist.gross += r.gross;
        exist.fee += r.fee;
        exist.refund += r.refund;
        exist.count += r.count;
      } else {
        map.set(r.key, { ...r });
      }
    }
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** 聚合指定窗口：历史整日走快照，今日部分实时聚合台账后合并。 */
async function aggregateReport(groupBy: PaymentReportGroupBy, start: Date | null, end: Date | null): Promise<AggRow[]> {
  const todayStart = startOfToday();
  const parts: AggRow[][] = [];
  if (!start || start < todayStart) {
    const histEndDate = end && end < todayStart ? formatDate(end) : formatDate(new Date(todayStart.getTime() - 1));
    const histStartDate = start ? formatDate(start) : null;
    parts.push(await aggregateFromSnapshot(groupBy, histStartDate, histEndDate));
  }
  if (!end || end >= todayStart) {
    const rtStart = start && start > todayStart ? start : todayStart;
    parts.push(await aggregateFromLedger(groupBy, rtStart, end));
  }
  return mergeAggRows(parts);
}

function toTotals(rows: AggRow[]): ReportTotals {
  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalFee = rows.reduce((s, r) => s + r.fee, 0);
  const totalRefund = rows.reduce((s, r) => s + r.refund, 0);
  return { totalGross, totalFee, totalRefund, totalNet: totalGross - totalFee - totalRefund, totalCount: rows.reduce((s, r) => s + r.count, 0) };
}

export async function getReportSummary(q: ReportSummaryQuery): Promise<ReportSummary> {
  const groupBy: PaymentReportGroupBy = q.groupBy ?? 'bizType';
  const start = parseDateTimeInput(q.startTime);
  const end = parseDateTimeInput(q.endTime);

  const agg = await aggregateReport(groupBy, start, end);
  const reportRows: PaymentReportRow[] = agg.map((r) => ({
    key: r.key || '未知',
    label: labelFor(groupBy, r.key),
    gross: r.gross,
    fee: r.fee,
    refund: r.refund,
    net: r.gross - r.fee - r.refund,
    count: r.count,
  }));

  let prev: ReportTotals | null = null;
  if (q.compare && start && end && end > start) {
    const duration = end.getTime() - start.getTime();
    const prevAgg = await aggregateReport(groupBy, new Date(start.getTime() - duration), new Date(start.getTime() - 1));
    prev = toTotals(prevAgg);
  }

  return { groupBy, rows: reportRows, ...toTotals(agg), prev };
}

/** Cron：重建近 N 天（含今天）的日切快照。delete + insert-select 原子重建，天然幂等。 */
export async function rebuildPaymentReportDaily(days = 2): Promise<number> {
  const n = Math.max(1, Math.min(days, 365));
  const sinceDate = formatDate(new Date(startOfToday().getTime() - (n - 1) * 24 * 60 * 60 * 1000));
  const since = parseDateTimeInput(`${sinceDate} 00:00:00`);
  if (!since) return 0;
  let inserted = 0;
  await db.transaction(async (tx) => {
    await tx.delete(paymentReportDaily).where(gte(paymentReportDaily.statDate, sinceDate));
    const rows = await tx
      .select({
        statDate: sql<string>`to_char(${paymentLedgerEntries.createdAt}, 'YYYY-MM-DD')`,
        channel: sql<string>`coalesce(${paymentLedgerEntries.channel}::text, '')`,
        bizType: sql<string>`coalesce(${paymentLedgerEntries.bizType}, '')`,
        gross: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'payment' then ${paymentLedgerEntries.amount} else 0 end),0)`,
        fee: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'fee' then ${paymentLedgerEntries.amount} else 0 end),0)`,
        refund: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'refund' then ${paymentLedgerEntries.amount} else 0 end),0)`,
        count: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'payment' then 1 else 0 end),0)`,
        tenantId: paymentLedgerEntries.tenantId,
      })
      .from(paymentLedgerEntries)
      .where(gte(paymentLedgerEntries.createdAt, since))
      .groupBy(sql`1, 2, 3`, paymentLedgerEntries.tenantId);
    if (rows.length > 0) {
      await tx.insert(paymentReportDaily).values(
        rows.map((r) => ({
          statDate: r.statDate,
          channel: r.channel,
          bizType: r.bizType,
          gross: Number(r.gross),
          fee: Number(r.fee),
          refund: Number(r.refund),
          count: Number(r.count),
          tenantId: r.tenantId,
        })),
      );
      inserted = rows.length;
    }
  });
  logger.info('[payment-report] daily snapshot rebuilt', { days: n, rows: inserted });
  return inserted;
}
