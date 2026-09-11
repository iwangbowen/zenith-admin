import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 支付财务报表 Service。
 *
 * Journal 是唯一资金事实来源：报表只聚合已过账凭证及其双分录行，不再读取旧单边台账或日切快照。
 * 金额口径由 sourceType + 标准科目 + 借贷方向共同确定，避免把同一凭证的两侧重复计入。
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { PAYMENT_CHANNEL_LABELS, paymentReportContract } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentReportGroupBy, PaymentReportRow } from '@zenith/shared/payment';
import { readSnapshot } from '../../db';
import { paymentApps, paymentChannelConfigs, paymentJournalLines, paymentJournals, paymentLedgerAccounts } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { currentUser } from '../../lib/context';
import { getTenantScopeId, optionalExactTenantCondition } from '../../lib/tenant';
import { APP_TIME_ZONE, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { buildWhere, dateRangeConditions } from '../../lib/where-helpers';

export type ReportSummaryQuery = QueryOutputOf<typeof paymentReportContract.summary>;

export interface ReportTotals {
  totalGross: number;
  totalFee: number;
  totalRefund: number;
  /** 净分账支出（分账减分账冲正，分） */
  totalSharing: number;
  totalNet: number;
  totalCount: number;
}

export interface ReportSummary extends ReportTotals {
  groupBy: PaymentReportGroupBy;
  rows: PaymentReportRow[];
  /** 环比周期（compare=true 且提供时间范围时返回）：汇总 + 逐行（按 key 对齐做行级环比） */
  prev?: (ReportTotals & { rows: PaymentReportRow[] }) | null;
}

interface AggRow {
  key: string;
  label: string;
  gross: number;
  fee: number;
  refund: number;
  sharing: number;
  count: number;
}

interface RawAggRow {
  key: string;
  label: string;
  gross: string;
  fee: string;
  refund: string;
  sharing: string;
  count: number;
}

function toSafeMinorNumber(value: string, label: string): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${label} 超出报表安全精度范围，请按更小时间范围查询`);
  }
  return Number(parsed);
}

interface DimensionExpressions {
  key: SQL<string>;
  label: SQL<string>;
}

function dimensionExpressions(groupBy: PaymentReportGroupBy): DimensionExpressions {
  switch (groupBy) {
    case 'application':
      return {
        key: sql<string>`${paymentJournals.appId}::text`,
        label: sql<string>`${paymentApps.name}`,
      };
    case 'merchantAccount':
      return {
        key: sql<string>`${paymentJournals.channelConfigId}::text`,
        label: sql<string>`${paymentChannelConfigs.name}`,
      };
    case 'currency':
      return {
        key: sql<string>`${paymentJournals.currency}`,
        label: sql<string>`${paymentJournals.currency}`,
      };
    case 'channel':
      return {
        key: sql<string>`${paymentChannelConfigs.channel}::text`,
        label: sql<string>`${paymentChannelConfigs.channel}::text`,
      };
    case 'day':
      return {
        key: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${paymentJournals.postedAt}), 'YYYY-MM-DD')`,
        label: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${paymentJournals.postedAt}), 'YYYY-MM-DD')`,
      };
  }
}

function labelFor(groupBy: PaymentReportGroupBy, key: string, label: string): string {
  if (groupBy === 'channel') return PAYMENT_CHANNEL_LABELS[key as PaymentChannel] ?? (label || key || '未知');
  return label || key || '未知';
}

/**
 * 从双分录按指定维度聚合。维度表只提供名称/渠道元数据，所有金额均来自 Journal 与标准科目行。
 */
async function aggregateFromJournals(
  executor: DbExecutor,
  groupBy: PaymentReportGroupBy,
  start: Date | null,
  end: Date | null,
  tenantId: number | null | undefined,
): Promise<AggRow[]> {
  const { key, label } = dimensionExpressions(groupBy);
  // PostgreSQL treats parameterized copies of the same `timezone()` expression
  // as different group keys. For the day dimension select and group by one
  // canonical expression only; the row label is the key itself.
  const selectLabel = groupBy === 'day' ? sql<string>`'day'` : label;
  const where = buildWhere(
    optionalExactTenantCondition(paymentJournals.tenantId, tenantId),
    ...dateRangeConditions(paymentJournals.postedAt, start, end),
  );
  const rows: RawAggRow[] = await executor
    .select({
      key,
      label: selectLabel,
      gross: sql<string>`coalesce(sum(case
        when ${paymentJournals.sourceType} = 'payment.capture'
          and ${paymentLedgerAccounts.code} = 'provider_clearing'
        then ${paymentJournalLines.debitAmount}
        when ${paymentJournals.sourceType} = 'payment.preauth.capture'
          and ${paymentLedgerAccounts.code} = 'merchant_available'
        then ${paymentJournalLines.creditAmount}
        else 0 end), 0)::text`,
      fee: sql<string>`coalesce(sum(case
        when ${paymentJournals.sourceType} = 'payment.fee'
          and ${paymentLedgerAccounts.code} = 'platform_fee'
        then ${paymentJournalLines.creditAmount}
        when ${paymentJournals.sourceType} = 'payment.fee_refund'
          and ${paymentLedgerAccounts.code} = 'platform_fee'
        then -${paymentJournalLines.debitAmount}
        else 0 end), 0)::text`,
      refund: sql<string>`coalesce(sum(case
        when ${paymentJournals.sourceType} = 'payment.refund'
          and ${paymentLedgerAccounts.code} = 'provider_clearing'
        then ${paymentJournalLines.creditAmount} else 0 end), 0)::text`,
      sharing: sql<string>`coalesce(sum(case
        when ${paymentJournals.sourceType} = 'payment.sharing'
          and ${paymentLedgerAccounts.code} = 'merchant_available'
        then ${paymentJournalLines.debitAmount}
        when ${paymentJournals.sourceType} = 'payment.sharing_reversal'
          and ${paymentLedgerAccounts.code} = 'merchant_available'
        then -${paymentJournalLines.creditAmount}
        else 0 end), 0)::text`,
      count: sql<number>`count(distinct case
        when ${paymentJournals.sourceType} in ('payment.capture', 'payment.preauth.capture')
          and ${paymentLedgerAccounts.code} in ('provider_clearing', 'merchant_available')
          and (${paymentJournalLines.debitAmount} > 0 or ${paymentJournalLines.creditAmount} > 0)
        then ${paymentJournals.id} end)::int`,
    })
    .from(paymentJournals)
    .innerJoin(paymentJournalLines, eq(paymentJournalLines.journalId, paymentJournals.id))
    .innerJoin(paymentLedgerAccounts, and(
      eq(paymentLedgerAccounts.id, paymentJournalLines.accountId),
      eq(paymentLedgerAccounts.appId, paymentJournals.appId),
      eq(paymentLedgerAccounts.channelConfigId, paymentJournals.channelConfigId),
      eq(paymentLedgerAccounts.currency, paymentJournals.currency),
      optionalExactTenantCondition(paymentLedgerAccounts.tenantId, tenantId),
    ))
    .innerJoin(paymentApps, and(
      eq(paymentApps.id, paymentJournals.appId),
      optionalExactTenantCondition(paymentApps.tenantId, tenantId),
    ))
    .innerJoin(paymentChannelConfigs, and(
      eq(paymentChannelConfigs.id, paymentJournals.channelConfigId),
      optionalExactTenantCondition(paymentChannelConfigs.tenantId, tenantId),
    ))
    .where(where)
    .groupBy(...(groupBy === 'day' ? [sql`1`] : [key, label]));

  return rows
    .map((row) => ({
      key: row.key,
      label: labelFor(groupBy, row.key, groupBy === 'day' ? row.key : row.label),
      gross: toSafeMinorNumber(row.gross, '收款金额'),
      fee: toSafeMinorNumber(row.fee, '手续费'),
      refund: toSafeMinorNumber(row.refund, '退款金额'),
      sharing: toSafeMinorNumber(row.sharing, '分账金额'),
      count: Number(row.count),
    }))
    .filter((row) => row.gross !== 0 || row.fee !== 0 || row.refund !== 0 || row.sharing !== 0 || row.count !== 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function toTotals(rows: AggRow[]): ReportTotals {
  const totalGross = rows.reduce((sum, row) => sum + row.gross, 0);
  const totalFee = rows.reduce((sum, row) => sum + row.fee, 0);
  const totalRefund = rows.reduce((sum, row) => sum + row.refund, 0);
  const totalSharing = rows.reduce((sum, row) => sum + row.sharing, 0);
  return {
    totalGross,
    totalFee,
    totalRefund,
    totalSharing,
    totalNet: totalGross - totalFee - totalRefund - totalSharing,
    totalCount: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

function toReportRows(rows: AggRow[]): PaymentReportRow[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    gross: row.gross,
    fee: row.fee,
    refund: row.refund,
    sharing: row.sharing,
    net: row.gross - row.fee - row.refund - row.sharing,
    count: row.count,
  }));
}

export async function getReportSummary(q: ReportSummaryQuery): Promise<ReportSummary> {
  const groupBy: PaymentReportGroupBy = q.groupBy ?? 'day';
  const start = parseDateRangeStart(q.startTime);
  const end = parseDateRangeEnd(q.endTime);
  const tenantId = getTenantScopeId(currentUser());

  return readSnapshot(async (tx) => {
    const aggregate = await aggregateFromJournals(tx, groupBy, start, end, tenantId);
    let prev: (ReportTotals & { rows: PaymentReportRow[] }) | null = null;
    if (q.compare && start && end && end >= start) {
      const periodMs = end.getTime() - start.getTime() + 1;
      const previous = await aggregateFromJournals(
        tx,
        groupBy,
        new Date(start.getTime() - periodMs),
        new Date(start.getTime() - 1),
        tenantId,
      );
      prev = { ...toTotals(previous), rows: toReportRows(previous) };
    }

    return {
      groupBy,
      rows: toReportRows(aggregate),
      ...toTotals(aggregate),
      prev,
    };
  });
}
