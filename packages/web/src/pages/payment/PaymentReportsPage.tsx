import { useMemo } from 'react';
import { formatYuan } from '@/utils/payment';
import { Banner, Button, Checkbox, Select, Spin, Typography } from '@douyinfe/semi-ui';
import { Download } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { AreaChart, BarChart, PieChart, chartOptions, makeAreaSpec, makeBarSpec, makePieSpec, useChartPalette, StatCard, StatGrid } from '@/components/charts';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { downloadBlob } from '@/utils/download';
import { usePermission } from '@/hooks/usePermission';
import { paymentReportKeys, usePaymentReportSummary } from '@/hooks/queries/payment-reports';
import { useListSearch } from '@/hooks/useListSearch';
import { PAYMENT_REPORT_GROUP_BY_LABELS, PAYMENT_REPORT_GROUP_BY_OPTIONS } from '@zenith/shared/payment';
import type { PaymentReportGroupBy, PaymentReportRow } from '@zenith/shared/payment';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter } from '@/components/search-filters';

const yuan = formatYuan;
const groupByOptions = PAYMENT_REPORT_GROUP_BY_OPTIONS;


/** 环比增幅：上一周期为 0 时不显示 */
function calcDelta(cur: number, prev: number | undefined | null): number | null {
  if (prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

/** 导出当前聚合结果为 CSV（含 BOM，Excel 直接打开不乱码） */
function exportReportCsv(dimensionTitle: string, rows: PaymentReportRow[]): void {
  const esc = (v: string | number) => {
    const raw = String(v);
    // Excel 会把这些前缀解释为公式；仅处理文本维度，数值列保持可计算格式。
    const s = typeof v === 'string' && /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const toYuan = (cents: number) => (cents / 100).toFixed(2);
  const header = [dimensionTitle, '收款(元)', '手续费(元)', '退款(元)', '分账(元)', '净额(元)', '成功笔数'];
  const lines = rows.map((r) => [r.label, toYuan(r.gross), toYuan(r.fee), toYuan(r.refund), toYuan(r.sharing), toYuan(r.net), r.count].map(esc).join(','));
  const csv = `\uFEFF${header.map(esc).join(',')}\n${lines.join('\n')}`;
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `财务报表_${dimensionTitle}_${stamp}.csv`);
}

/** 行级环比涨跌展示 */
function DeltaText({ cur, prev }: Readonly<{ cur: number; prev: number | undefined }>) {
  const delta = calcDelta(cur, prev);
  if (delta == null) return <Typography.Text type="tertiary">—</Typography.Text>;
  const pct = (delta * 100).toFixed(1);
  return <Typography.Text type={delta >= 0 ? 'success' : 'danger'}>{delta >= 0 ? '+' : ''}{pct}%</Typography.Text>;
}

interface SearchParams { groupBy: PaymentReportGroupBy; timeRange: [Date, Date] | null; compare: boolean; }
const defaultSearch: SearchParams = { groupBy: 'day', timeRange: null, compare: false };

export default function PaymentReportsPage() {
  const { hasPermission } = usePermission();
  const canView = hasPermission('payment:report:view');
  const palette = useChartPalette();
  const {
    draftParams, setDraftParams, submittedParams,
    applySearch, handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentReportKeys.lists });
  const summaryQuery = usePaymentReportSummary({
    groupBy: submittedParams.groupBy,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
    compare: submittedParams.compare && submittedParams.timeRange ? true : undefined,
  }, canView);
  const summary = summaryQuery.data ?? null;
  const prev = summary?.prev ?? null;
  // 行级环比映射（compare 开启时按 key 对齐）
  const prevRowMap = useMemo(() => new Map((prev?.rows ?? []).map((r) => [r.key, r])), [prev?.rows]);
  const loading = summaryQuery.isFetching;
  // 期内逐日走势（主维度非「按日」时补一份 day 聚合；选「按日」时主图即走势，避免重复请求）
  const isDayGroup = submittedParams.groupBy === 'day';
  const trendQuery = usePaymentReportSummary({
    groupBy: 'day',
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }, canView && !isDayGroup);
  const trendRows = useMemo(
    () => (isDayGroup ? (summary?.rows ?? []) : (trendQuery.data?.rows ?? [])),
    [isDayGroup, summary?.rows, trendQuery.data?.rows],
  );

  const chartData = useMemo(
    () => (summary?.rows ?? []).map((r) => ({
      name: r.label,
      收款: Number((r.gross / 100).toFixed(2)),
      退款: Number((r.refund / 100).toFixed(2)),
      分账: Number((r.sharing / 100).toFixed(2)),
      净额: Number((r.net / 100).toFixed(2)),
      count: r.count,
    })),
    [summary?.rows],
  );
  const trendData = useMemo(
    () => trendRows.map((r) => ({
      date: r.label.slice(5),
      收款: Number((r.gross / 100).toFixed(2)),
      退款: Number((r.refund / 100).toFixed(2)),
      净额: Number((r.net / 100).toFixed(2)),
    })),
    [trendRows],
  );
  const trendSpec = useMemo(
    () =>
      makeAreaSpec({
        data: trendData,
        xField: 'date',
        series: [
          { field: '收款', name: '收款', color: '#10b981' },
          { field: '退款', name: '退款', color: '#f97316' },
          { field: '净额', name: '净额', color: '#3b82f6' },
        ],
        palette,
        fillOpacity: 0.2,
        tooltip: { value: (v) => `¥${v}` },
      }),
    [palette, trendData],
  );
  const barSpec = useMemo(
    () =>
      makeBarSpec({
        data: chartData,
        xField: 'name',
        series: [
          { field: '收款', name: '收款', color: '#10b981' },
          { field: '退款', name: '退款', color: '#f97316' },
          { field: '分账', name: '分账', color: '#eab308' },
          { field: '净额', name: '净额', color: '#3b82f6' },
        ],
        palette,
        tooltip: { value: (v) => `¥${v}` },
        axis: { yLabel: (v) => `¥${v}` },
      }),
    [chartData, palette],
  );
  const netPieSpec = useMemo(
    () =>
      makePieSpec({
        data: chartData.filter((d) => d.净额 > 0).map((d) => ({ name: d.name, value: d.净额 })),
        categoryField: 'name',
        valueField: 'value',
        donut: true,
        palette,
        valueFormatter: (v) => `¥${v}`,
      }),
    [chartData, palette],
  );
  const countBarSpec = useMemo(
    () =>
      makeBarSpec({
        data: chartData,
        xField: 'name',
        series: [{ field: 'count', name: '成功笔数', color: '#8b5cf6' }],
        palette,
        tooltip: { value: (v) => `${v} 笔` },
      }),
    [chartData, palette],
  );

  // 衍生指标（分转元前先算比率，避免精度损耗）
  const avgTicket = summary && summary.totalCount > 0 ? Math.round(summary.totalGross / summary.totalCount) : null;
  const refundRatio = summary && summary.totalGross > 0 ? (summary.totalRefund / summary.totalGross) * 100 : null;
  const feeRatio = summary && summary.totalGross > 0 ? (summary.totalFee / summary.totalGross) * 100 : null;

  const showCompareCols = Boolean(prev);
  const columns: ColumnProps<PaymentReportRow>[] = [
    { title: PAYMENT_REPORT_GROUP_BY_LABELS[summary?.groupBy ?? 'day'], dataIndex: 'label', width: 160 },
    { title: '收款', dataIndex: 'gross', width: 130, align: 'right', render: (v: number) => yuan(v) },
    { title: '手续费', dataIndex: 'fee', width: 120, align: 'right', render: (v: number) => yuan(v) },
    { title: '退款', dataIndex: 'refund', width: 120, align: 'right', render: (v: number) => yuan(v) },
    { title: '分账', dataIndex: 'sharing', width: 120, align: 'right', render: (v: number) => yuan(v ?? 0) },
    { title: '净额', dataIndex: 'net', width: 130, align: 'right', render: (v: number) => yuan(v) },
    { title: '成功笔数', dataIndex: 'count', width: 100, align: 'right' },
    { title: '笔均', dataIndex: 'avg', width: 110, align: 'right', render: (_: unknown, r: PaymentReportRow) => (r.count > 0 ? yuan(Math.round(r.gross / r.count)) : '—') },
    { title: '退款率', dataIndex: 'refundRate', width: 100, align: 'right', render: (_: unknown, r: PaymentReportRow) => (r.gross > 0 ? `${((r.refund / r.gross) * 100).toFixed(1)}%` : '—') },
    ...(showCompareCols ? [
      { title: '收款环比', dataIndex: 'grossDelta', width: 110, align: 'right' as const, render: (_: unknown, r: PaymentReportRow) => <DeltaText cur={r.gross} prev={prevRowMap.get(r.key)?.gross} /> },
      { title: '净额环比', dataIndex: 'netDelta', width: 110, align: 'right' as const, render: (_: unknown, r: PaymentReportRow) => <DeltaText cur={r.net} prev={prevRowMap.get(r.key)?.net} /> },
    ] : []),
  ];

  const dimensionTitle = PAYMENT_REPORT_GROUP_BY_LABELS[summary?.groupBy ?? 'day'];

  const renderGroupByFilter = () => (
    <Select
      value={draftParams.groupBy}
      // 分组维度是视图切换而非筛选条件：选择后立即提交查询，无需再点「查询」
      onChange={(v) => applySearch({ ...draftParams, groupBy: v as PaymentReportGroupBy })}
      style={{ width: 140 }}
      optionList={groupByOptions}
      placeholder="选择维度"
    />
  );

  const renderTimeRangeFilter = () => (
    <DateRangeFilter value={draftParams.timeRange ?? undefined} onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v ? (v as [Date, Date]) : null }))} width={330} />
  );

  const renderCompareToggle = () => (
    <Checkbox
      checked={draftParams.compare}
      onChange={(e) => setDraftParams((p) => ({ ...p, compare: Boolean(e.target.checked) }))}
      disabled={!draftParams.timeRange}
    >
      环比对照
    </Checkbox>
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} disabled={!canView} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} disabled={!canView} />;
  const renderExportButton = () => (
    <Button icon={<Download size={14} />} disabled={!canView || !summary?.rows.length} onClick={() => summary && exportReportCsv(dimensionTitle, summary.rows)}>
      导出 CSV
    </Button>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderGroupByFilter()}
            {renderTimeRangeFilter()}
            {renderCompareToggle()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={renderExportButton()}
        mobilePrimary={renderSearchButton()}
        mobileActions={renderExportButton()}
        mobileFilters={(
          <>
            {renderGroupByFilter()}
            {renderTimeRangeFilter()}
            {renderCompareToggle()}
          </>
        )}
        filterTitle="财务报表筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!canView && (
        <Banner
          type="warning"
          bordered
          closeIcon={null}
          description="当前账号缺少「payment:report:view」权限，无法查看财务报表。"
          style={{ marginBottom: 12 }}
        />
      )}

      <Spin spinning={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StatGrid minItemWidth={168}>
            <StatCard title="收款总额" value={summary ? yuan(summary.totalGross) : '—'} accent="var(--semi-color-success)" deltaLabel="环比" deltaFormat="ratio" delta={summary && prev ? calcDelta(summary.totalGross, prev.totalGross) : null} />
            <StatCard title="手续费总额" value={summary ? yuan(summary.totalFee) : '—'} accent="var(--semi-color-warning)" deltaLabel="环比" deltaFormat="ratio" delta={summary && prev ? calcDelta(summary.totalFee, prev.totalFee) : null} />
            <StatCard title="退款总额" value={summary ? yuan(summary.totalRefund) : '—'} accent="var(--semi-color-warning)" deltaLabel="环比" deltaFormat="ratio" delta={summary && prev ? calcDelta(summary.totalRefund, prev.totalRefund) : null} />
            <StatCard title="分账支出" value={summary ? yuan(summary.totalSharing ?? 0) : '—'} deltaLabel="环比" deltaFormat="ratio" delta={summary && prev ? calcDelta(summary.totalSharing, prev.totalSharing) : null} />
            <StatCard title="净额" value={summary ? yuan(summary.totalNet) : '—'} accent="var(--semi-color-primary)" sub="收款 - 手续费 - 退款 - 分账" deltaLabel="环比" deltaFormat="ratio" delta={summary && prev ? calcDelta(summary.totalNet, prev.totalNet) : null} />
            <StatCard title="成功笔数" value={summary?.totalCount ?? '—'} deltaLabel="环比" deltaFormat="ratio" delta={summary && prev ? calcDelta(summary.totalCount, prev.totalCount) : null} />
            <StatCard title="客单价" value={avgTicket != null ? yuan(avgTicket) : '—'} sub="收款总额 / 成功笔数" />
            <StatCard title="退款率" value={refundRatio != null ? `${refundRatio.toFixed(1)}%` : '—'} accent={refundRatio != null && refundRatio > 20 ? 'var(--semi-color-danger)' : undefined} sub="退款 / 收款" />
            <StatCard title="费率成本" value={feeRatio != null ? `${feeRatio.toFixed(2)}%` : '—'} sub="手续费 / 收款" />
          </StatGrid>

          {/* 期内逐日走势（主维度为「按日」时下方柱状图即走势，避免重复展示） */}
          {!isDayGroup && trendData.length > 0 && (
            <div className="zx-panel">
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>收款走势（按日）</div>
              <AreaChart {...trendSpec} options={chartOptions} height={260} />
            </div>
          )}

          <div className="zx-panel">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>收款 / 退款 / 分账 / 净额分布</div>
            <BarChart {...barSpec} options={chartOptions} height={300} />
          </div>

          <div className="chart-grid">
            <div className="zx-panel">
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>净额占比</div>
              <PieChart {...netPieSpec} options={chartOptions} height={240} />
            </div>
            <div className="zx-panel">
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>成功笔数分布</div>
              <BarChart {...countBarSpec} options={chartOptions} height={240} />
            </div>
          </div>

          <ConfigurableTable
            bordered columns={columns} dataSource={summary?.rows ?? []} loading={loading} rowKey="key" size="small" empty="暂无数据"
            onRefresh={() => void summaryQuery.refetch()} refreshLoading={loading} pagination={false}
          />
        </div>
      </Spin>
    </div>
  );
}
