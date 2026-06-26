import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Spin, Select } from '@douyinfe/semi-ui';
import {
  AreaChart,
  BarChart,
  PieChart,
  HeatmapChart,
  EmptyChart,
  HeatmapLegend,
  useChartPalette,
  chartOptions,
  makeAreaSpec,
  makeBarSpec,
  makePieSpec,
  buildCalendarHeatmap,
  makeCalendarHeatmapSpec,
} from '@/components/charts';
import { request } from '@/utils/request';
import type { OperationLogStats } from '@zenith/shared';

const DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

const METHOD_COLORS: Record<string, string> = {
  GET: '#3b82f6',
  POST: '#10b981',
  PUT: '#f59e0b',
  DELETE: '#ef4444',
  PATCH: '#8b5cf6',
};
const DEFAULT_METHOD_COLOR = '#6b7280';
const SUCCESS_COLOR = '#10b981';
const FAIL_COLOR = '#ef4444';

const sectionStyle: React.CSSProperties = {
  background: 'var(--semi-color-bg-1)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 6,
  padding: '16px 20px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--semi-color-text-0)',
  marginBottom: 12,
};

interface StatCardProps {
  readonly title: string;
  readonly value: string | number;
  readonly sub?: string;
  readonly color: string;
}

function formatAvgDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function StatCard({ title, value, sub, color: _color }: StatCardProps) {
  return (
    <div
      style={{
        ...sectionStyle,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--semi-color-text-0)', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{sub}</div>
      )}
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginTop: 2 }}>{title}</div>
    </div>
  );
}

const EMPTY_PLACEHOLDER_STYLE: React.CSSProperties = {
  height: 260,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--semi-color-text-2)',
};

export default function OperationLogStatsPanel() {
  const palette = useChartPalette();
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<OperationLogStats | null>(null);

  const fetchStats = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await request.get<OperationLogStats>(`/api/operation-logs/stats?days=${d}`);
      setStats(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats(days);
  }, [days, fetchStats]);

  const moduleChartData = useMemo(() => [...(stats?.moduleStats ?? [])].slice(0, 10).reverse(), [stats]);
  const userChartData = useMemo(() => [...(stats?.userStats ?? [])].reverse(), [stats]);
  const moduleTimingChartData = useMemo(() => [...(stats?.moduleTimingStats ?? [])].slice(0, 10).reverse(), [stats]);
  const methodChartData = useMemo(
    () => (stats?.methodStats ?? []).map((m) => ({ ...m, fill: METHOD_COLORS[m.method] ?? DEFAULT_METHOD_COLOR })),
    [stats],
  );
  const hourlyChartData = useMemo(() => [...(stats?.hourlyStats ?? [])], [stats]);
  const dailyChartData = useMemo(() => [...(stats?.dailyStats ?? [])], [stats]);

  const heatmap = useMemo(() => buildCalendarHeatmap(stats?.dailyStats ?? [], days), [stats, days]);

  const summary = stats?.summary;
  const successRate = summary == null || summary.total === 0
    ? null
    : ((summary.successCount / summary.total) * 100).toFixed(1);
  const avgDuration = summary?.avgDurationMs == null ? null : formatAvgDuration(summary.avgDurationMs);

  const moduleSpec = useMemo(() => makeBarSpec({
    data: moduleChartData,
    xField: 'module',
    series: [{ field: 'count', name: '操作次数', color: '#3b82f6' }],
    palette,
    horizontal: true,
    categoryAxisWidth: 88,
    showLabel: true,
    tooltip: { value: (v) => `${v} 次` },
  }), [moduleChartData, palette]);

  const userSpec = useMemo(() => makeBarSpec({
    data: userChartData,
    xField: 'username',
    series: [{ field: 'count', name: '操作次数', color: '#10b981' }],
    palette,
    horizontal: true,
    categoryAxisWidth: 88,
    showLabel: true,
    tooltip: { value: (v) => `${v} 次` },
  }), [userChartData, palette]);

  const timingSpec = useMemo(() => makeBarSpec({
    data: moduleTimingChartData,
    xField: 'module',
    series: [
      { field: 'avgMs', name: '平均耗时', color: '#f59e0b' },
      { field: 'maxMs', name: '最大耗时', color: 'rgba(239, 68, 68, 0.5)' },
    ],
    palette,
    horizontal: true,
    categoryAxisWidth: 88,
    axis: { xLabel: (v) => `${v}ms` },
    tooltip: { value: (v) => `${v} ms` },
  }), [moduleTimingChartData, palette]);

  const methodSpec = useMemo(() => makePieSpec({
    data: methodChartData,
    categoryField: 'method',
    valueField: 'count',
    donut: true,
    colors: methodChartData.map((d) => d.fill),
    palette,
    label: 'none',
    valueUnit: '次',
  }), [methodChartData, palette]);

  const hourlySpec = useMemo(() => makeBarSpec({
    data: hourlyChartData,
    xField: 'hour',
    series: [{ field: 'count', name: '操作次数', color: '#8b5cf6' }],
    palette,
    axis: { xLabel: (v) => `${String(v).padStart(2, '0')}h` },
    tooltip: {
      title: (x) => `${String(x).padStart(2, '0')}:00 – ${String(x).padStart(2, '0')}:59`,
      value: (v) => `${v} 次`,
    },
  }), [hourlyChartData, palette]);

  const dailySpec = useMemo(() => makeAreaSpec({
    data: dailyChartData,
    xField: 'date',
    series: [
      { field: 'successCount', name: '成功', color: SUCCESS_COLOR },
      { field: 'failCount', name: '失败', color: FAIL_COLOR },
    ],
    palette,
    fillOpacity: 0.28,
    axis: { xLabel: (v) => v.slice(5) },
    tooltip: { title: (x) => `日期：${x}`, value: (v) => `${v} 次` },
  }), [dailyChartData, palette]);

  const heatmapSpec = useMemo(
    () => makeCalendarHeatmapSpec(heatmap.data, heatmap.maxCount, palette, { valueLabel: '操作次数' }),
    [heatmap, palette],
  );

  return (
    <div>
      {/* 时间选择器 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Select value={days} onChange={(v) => setDays(v as number)} style={{ width: 140 }}>
          {DAYS_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
          ))}
        </Select>
      </div>

      <Spin spinning={loading}>
        {/* ── 汇总指标卡 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <StatCard title="总请求数" value={summary ? summary.total.toLocaleString() : '—'} sub={`近 ${days} 天累计`} color="#3b82f6" />
          <StatCard
            title="请求成功率"
            value={successRate == null ? '—' : `${successRate}%`}
            sub={summary ? `成功 ${summary.successCount.toLocaleString()} · 失败 ${summary.failCount.toLocaleString()}` : undefined}
            color="#10b981"
          />
          <StatCard title="平均响应时间" value={avgDuration ?? '—'} sub="基于有记录的请求" color="#f59e0b" />
          <StatCard title="活跃用户数" value={summary ? summary.uniqueUsers.toLocaleString() : '—'} sub="不重复用户账号" color="#8b5cf6" />
        </div>

        {/* ── 模块 Top 10 + 用户 Top 10 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>按模块操作统计（Top 10）</div>
            {moduleChartData.length === 0 ? (
              <div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>
            ) : (
              <BarChart {...moduleSpec} options={chartOptions} height={260} />
            )}
          </div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Top 10 操作用户</div>
            {userChartData.length === 0 ? (
              <div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>
            ) : (
              <BarChart {...userSpec} options={chartOptions} height={260} />
            )}
          </div>
        </div>

        {/* ── 各模块接口耗时统计 ── */}
        <div style={{ ...sectionStyle, marginBottom: 16 }}>
          <div style={sectionTitleStyle}>各模块平均响应时间（取有耗时记录的请求，Top 10）</div>
          {moduleTimingChartData.length === 0 ? (
            <div style={EMPTY_PLACEHOLDER_STYLE}>暂无耗时数据</div>
          ) : (
            <BarChart {...timingSpec} options={chartOptions} height={260} />
          )}
        </div>

        {/* ── HTTP 方法分布 + 小时分布 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>HTTP 方法分布</div>
            {methodChartData.length === 0 ? (
              <div style={{ ...EMPTY_PLACEHOLDER_STYLE, height: 240 }}>暂无数据</div>
            ) : (
              <PieChart {...methodSpec} options={chartOptions} height={240} />
            )}
          </div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>按小时操作分布</div>
            <BarChart {...hourlySpec} options={chartOptions} height={240} />
          </div>
        </div>

        {/* ── 每日操作趋势（成功/失败面积） ── */}
        <div style={{ ...sectionStyle, marginBottom: 16 }}>
          <div style={sectionTitleStyle}>每日操作趋势（成功 / 失败）</div>
          <AreaChart {...dailySpec} options={chartOptions} height={210} />
        </div>

        {/* ── 操作热力图 ── */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>操作热力图（近 {days} 天）</div>
          {!stats ? (
            <EmptyChart height={220} />
          ) : (
            <>
              <HeatmapChart {...heatmapSpec} options={chartOptions} height={220} />
              <HeatmapLegend palette={palette} />
            </>
          )}
        </div>
      </Spin>
    </div>
  );
}