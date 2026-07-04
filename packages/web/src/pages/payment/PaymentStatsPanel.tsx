import React, { useState, useMemo } from 'react';
import { formatYuan } from '@/utils/payment';
import { Spin, Row, Col, Select } from '@douyinfe/semi-ui';
import {
  AreaChart,
  BarChart,
  PieChart,
  chartOptions,
  makeAreaSpec,
  makeBarSpec,
  makePieSpec,
  useChartPalette,
} from '@/components/charts';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_ORDER_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentOrderStatus } from '@zenith/shared';
import { usePaymentStats, usePaymentTrend } from '@/hooks/queries/payment-stats';

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

const sectionStyle: React.CSSProperties = {
  background: 'var(--semi-color-bg-1)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 6,
  padding: '16px 20px',
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: 'var(--semi-color-text-0)', marginBottom: 12,
};

interface StatCardProps {
  readonly title: string;
  readonly value: string | number;
  readonly sub?: string;
  readonly accent?: string;
}
function StatCard({ title, value, sub, accent }: StatCardProps) {
  return (
    <div style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 92, boxSizing: 'border-box' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? 'var(--semi-color-text-0)', lineHeight: 1.2 }}>{String(value)}</div>
      <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', minHeight: 16 }}>{sub ?? ''}</div>
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginTop: 'auto' }}>{title}</div>
    </div>
  );
}

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
    amount: c.amount,
    count: c.count,
    fill: CHANNEL_COLORS[c.channel] ?? '#6b7280',
  }));
  const statusData = (stats?.byStatus ?? []).map((s) => ({
    name: PAYMENT_ORDER_STATUS_LABELS[s.status as PaymentOrderStatus] ?? s.status,
    value: s.count,
    fill: STATUS_COLORS[s.status] ?? '#6b7280',
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
    tooltip: { value: (v) => yuan(Number(v)) },
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

  return (
    <Spin spinning={statsQuery.isFetching || trendQuery.isFetching}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 汇总卡片 */}
        <Row gutter={[16, 16]} type="flex">
          <Col xs={24} sm={12} xl={4}>
            <StatCard title="累计成功金额" value={stats ? yuan(stats.totalAmount) : '—'} accent="#10b981" />
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <StatCard title="今日成功金额" value={stats ? yuan(stats.todayAmount) : '—'} sub={stats ? `${stats.todayCount} 笔` : ''} />
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <StatCard title="支付成功率" value={stats ? `${stats.successRate}%` : '—'} sub={stats ? `${stats.successCount}/${stats.orderCount} 单` : ''} accent="#3b82f6" />
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <StatCard title="累计退款" value={stats ? yuan(stats.refundAmount) : '—'} sub={stats ? `${stats.refundCount} 笔` : ''} accent="#f97316" />
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <StatCard title="退款率" value={stats ? `${stats.refundRate}%` : '—'} accent={stats && stats.refundRate > 20 ? '#ef4444' : undefined} />
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <StatCard title="成功笔均" value={stats ? yuan(stats.avgAmount) : '—'} />
          </Col>
        </Row>

        {/* 收款趋势 */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>收款趋势</div>
            <Select size="small" value={days} onChange={(v) => handleDaysChange(v as number)} optionList={DAYS_OPTIONS} style={{ width: 130 }} />
          </div>
          <AreaChart {...trendSpec} options={chartOptions} height={280} />
        </div>

        {/* 渠道金额分布 + 订单状态分布 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>渠道成功金额分布</div>
              <BarChart {...channelSpec} options={chartOptions} height={240} />
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>订单状态分布</div>
              <PieChart {...statusSpec} options={chartOptions} height={240} />
            </div>
          </Col>
        </Row>
      </div>
    </Spin>
  );
}
