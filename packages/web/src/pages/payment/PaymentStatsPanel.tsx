import React, { useState, useMemo } from 'react';
import { formatYuan } from '@/utils/payment';
import { Spin, Select } from '@douyinfe/semi-ui';
import {
  AreaChart,
  BarChart,
  PieChart,
  chartOptions,
  makeAreaSpec,
  makeBarSpec,
  makePieSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentMethod, PaymentOrderStatus } from '@zenith/shared/payment';
import { usePaymentStats, usePaymentTrend } from '@/hooks/queries/payment-stats';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const yuan = formatYuan;

const CHANNEL_COLORS: Record<string, string> = { wechat: '#10b981', alipay: '#3b82f6' };
const STATUS_COLORS: Record<string, string> = {
  pending: '#9ca3af', paying: '#3b82f6', success: '#10b981', closed: '#6b7280',
  refunding: '#f59e0b', refunded: '#f97316', failed: '#ef4444',
};

const DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--semi-color-text-0)', marginBottom: 12,
};

export default function PaymentStatsPanel() {
  const palette = useChartPalette();
  const [days, setDays] = useState(30);
  const statsQuery = usePaymentStats();
  const trendQuery = usePaymentTrend(days);
  const stats = statsQuery.data ?? null;
  const trend = trendQuery.data ?? [];

  function handleDaysChange(d: number) {
    setDays(d);
  }

  const channelData = (stats?.byChannel ?? []).map((c) => ({
    name: PAYMENT_CHANNEL_LABELS[c.channel as PaymentChannel] ?? c.channel,
    amount: Number((c.amount / 100).toFixed(2)),
    count: c.count,
    fill: CHANNEL_COLORS[c.channel] ?? '#6b7280',
  }));
  const statusData = (stats?.byStatus ?? []).map((s) => ({
    name: PAYMENT_ORDER_STATUS_LABELS[s.status as PaymentOrderStatus] ?? s.status,
    value: s.count,
    fill: STATUS_COLORS[s.status] ?? '#6b7280',
  }));
  const payMethodData = (stats?.byPayMethod ?? [])
    .filter((m) => m.amount > 0 || m.count > 0)
    .map((m) => ({
      name: PAYMENT_METHOD_LABELS[m.payMethod as PaymentMethod] ?? m.payMethod,
      amount: Number((m.amount / 100).toFixed(2)),
      count: m.count,
    }))
    .sort((a, b) => b.amount - a.amount);
  const bizTypeData = (stats?.byBizType ?? []).map((b) => ({
    name: b.bizType || '（未标记）',
    value: b.amount,
    count: b.count,
  }));
  const trendData = trend.map((p) => ({
    date: p.date.slice(5),
    amount: Number((p.amount / 100).toFixed(2)),
    refundAmount: Number((p.refundAmount / 100).toFixed(2)),
    count: p.count,
  }));

  const trendSpec = useMemo(() => makeAreaSpec({
    data: trendData,
    xField: 'date',
    series: [
      { field: 'amount', name: '收款金额', color: '#10b981' },
      { field: 'refundAmount', name: '退款金额', color: '#f97316' },
    ],
    palette,
    fillOpacity: 0.25,
    tooltip: { value: (v) => `¥${v}` },
  }), [palette, trendData]);

  const channelSpec = useMemo(() => makeBarSpec({
    data: channelData,
    xField: 'name',
    series: [{ field: 'amount', name: '成功金额', color: '#10b981' }],
    palette,
    colorByDatum: (d) => String(d?.['fill'] ?? '#6b7280'),
    tooltip: { value: (v) => `¥${Number(v).toFixed(2)}` },
  }), [channelData, palette]);

  const statusSpec = useMemo(() => makePieSpec({
    data: statusData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: statusData.map((d) => d.fill),
    palette,
    valueUnit: '单',
  }), [palette, statusData]);

  const payMethodSpec = useMemo(() => makeBarSpec({
    data: payMethodData,
    xField: 'name',
    series: [{ field: 'amount', name: '成功金额', color: '#3b82f6' }],
    palette,
    tooltip: { value: (v) => `¥${Number(v).toFixed(2)}` },
  }), [palette, payMethodData]);

  const bizTypeSpec = useMemo(() => makePieSpec({
    data: bizTypeData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    palette,
    valueFormatter: (v) => yuan(Number(v)),
  }), [bizTypeData, palette]);

  const countTrendSpec = useMemo(() => makeBarSpec({
    data: trendData,
    xField: 'date',
    series: [{ field: 'count', name: '成功笔数', color: '#8b5cf6' }],
    palette,
    tooltip: { value: (v) => `${v} 笔` },
  }), [palette, trendData]);

  return (
    <Spin spinning={statsQuery.isFetching || trendQuery.isFetching}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 汇总卡片 */}
        <StatGrid minItemWidth={168}>
          <StatCard title="累计成功金额" value={stats ? yuan(stats.totalAmount) : EMPTY_PLACEHOLDER} accent="var(--semi-color-success)" />
          <StatCard title="今日成功金额" value={stats ? yuan(stats.todayAmount) : EMPTY_PLACEHOLDER} sub={stats ? `${stats.todayCount} 笔` : ''} />
          <StatCard title="支付成功率" value={stats ? `${stats.successRate}%` : EMPTY_PLACEHOLDER} sub={stats ? `${stats.successCount}/${stats.orderCount} 单` : ''} accent="var(--semi-color-primary)" />
          <StatCard title="累计退款" value={stats ? yuan(stats.refundAmount) : EMPTY_PLACEHOLDER} sub={stats ? `${stats.refundCount} 笔` : ''} accent="var(--semi-color-warning)" />
          <StatCard title="退款率" value={stats ? `${stats.refundRate}%` : EMPTY_PLACEHOLDER} accent={stats && stats.refundRate > 20 ? 'var(--semi-color-danger)' : undefined} />
          <StatCard title="成功笔均" value={stats ? yuan(stats.avgAmount) : EMPTY_PLACEHOLDER} />
        </StatGrid>

        {/* 收款趋势 */}
        <div className="zx-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>收款趋势</div>
            <Select size="small" value={days} onChange={(v) => handleDaysChange(v as number)} optionList={DAYS_OPTIONS} style={{ width: 130 }} />
          </div>
          <AreaChart {...trendSpec} options={chartOptions} height={280} />
        </div>

        {/* 渠道金额分布 + 支付方式金额分布 */}
        <div className="chart-grid">
          <div className="zx-panel">
            <div style={sectionTitleStyle}>渠道成功金额分布</div>
            <BarChart {...channelSpec} options={chartOptions} height={240} />
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>支付方式成功金额分布</div>
            <BarChart {...payMethodSpec} options={chartOptions} height={240} />
          </div>
        </div>

        {/* 订单状态分布 + 业务类型金额分布 */}
        <div className="chart-grid">
          <div className="zx-panel">
            <div style={sectionTitleStyle}>订单状态分布</div>
            <PieChart {...statusSpec} options={chartOptions} height={240} />
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>业务类型成功金额 TOP 10</div>
            <PieChart {...bizTypeSpec} options={chartOptions} height={240} />
          </div>
        </div>

        {/* 成功笔数趋势 */}
        <div className="zx-panel">
          <div style={sectionTitleStyle}>成功笔数趋势</div>
          <BarChart {...countTrendSpec} options={chartOptions} height={220} />
        </div>
      </div>
    </Spin>
  );
}
