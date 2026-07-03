import React, { useState, useMemo } from 'react';
import { Spin, Select } from '@douyinfe/semi-ui';
import { LogIn, CheckCircle2, XCircle, Users } from 'lucide-react';
import {
  AreaChart,
  BarChart,
  PieChart,
  EmptyChart,
  useChartPalette,
  chartOptions,
  sectionStyle,
  sectionTitleStyle,
  makeAreaSpec,
  makeBarSpec,
  makePieSpec,
  isEmptyValues,
} from '@/components/charts';
import dayjs from 'dayjs';
import { useLoginLogStats } from '@/hooks/queries/login-logs';

const DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

const FAIL_COLOR = 'var(--semi-color-danger)';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

interface BarDatum {
  readonly name: string;
  readonly count: number;
}

interface PieDatum {
  readonly name: string;
  readonly value: number;
}

interface StatCardProps {
  readonly title: string;
  readonly value: string | number;
  readonly sub?: string;
  readonly icon: React.ReactNode;
  readonly accent?: string;
}

function StatCard({ title, value, sub, icon, accent }: StatCardProps) {
  return (
    <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: accent ? `color-mix(in srgb, ${accent} 14%, transparent)` : 'var(--semi-color-fill-1)',
          color: accent ?? 'var(--semi-color-text-2)',
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? 'var(--semi-color-text-0)', lineHeight: 1.2 }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{sub}</div>}
        <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)' }}>{title}</div>
      </div>
    </div>
  );
}

function ChartShell({ title, children, danger }: Readonly<{ title: React.ReactNode; children: React.ReactNode; danger?: boolean }>) {
  return (
    <div style={{ ...sectionStyle, border: danger ? `1px solid color-mix(in srgb, ${FAIL_COLOR} 44%, var(--semi-color-border))` : sectionStyle.border }}>
      <div style={{ ...sectionTitleStyle, color: danger ? FAIL_COLOR : sectionTitleStyle.color }}>{title}</div>
      {children}
    </div>
  );
}

export default function LoginLogStatsPanel() {
  const palette = useChartPalette();
  const [days, setDays] = useState<number>(30);
  const statsQuery = useLoginLogStats({ days });
  const stats = statsQuery.data ?? null;

  const filledDailyStats = useMemo(() => {
    if (!stats) return [];
    const dataMap = new Map(stats.dailyStats.map((d) => [d.date, d]));
    const today = dayjs();
    return Array.from({ length: days }, (_, i) => {
      const date = today.subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
      return dataMap.get(date) ?? { date, count: 0, successCount: 0, failCount: 0 };
    });
  }, [stats, days]);

  const weekdayChartData = useMemo<BarDatum[]>(() => {
    const buckets = new Array(7).fill(0);
    for (const d of stats?.dailyStats ?? []) {
      buckets[(dayjs(d.date).day() + 6) % 7] += d.count;
    }
    return WEEKDAY_LABELS.map((name, i) => ({ name, count: buckets[i] }));
  }, [stats]);

  const userChartData = useMemo<BarDatum[]>(
    () => [...(stats?.userStats ?? [])].reverse().map((d) => ({ name: d.username, count: d.count })),
    [stats],
  );
  const ipFailChartData = useMemo<BarDatum[]>(
    () => [...(stats?.ipFailStats ?? [])].reverse().map((d) => ({ name: d.ip, count: d.count })),
    [stats],
  );
  const hourlyChartData = useMemo<BarDatum[]>(
    () => (stats?.hourlyStats ?? []).map((d) => ({ name: `${String(d.hour).padStart(2, '0')}:00`, count: d.count })),
    [stats],
  );
  const browserData = useMemo<PieDatum[]>(
    () => (stats?.browserStats ?? []).map((d) => ({ name: d.browser, value: d.count })),
    [stats],
  );
  const osData = useMemo<PieDatum[]>(
    () => (stats?.osStats ?? []).map((d) => ({ name: d.os, value: d.count })),
    [stats],
  );

  const summary = stats?.summary;
  const successRate = summary == null || summary.total === 0
    ? null
    : ((summary.successCount / summary.total) * 100).toFixed(1);

  const statusPieData = useMemo<PieDatum[]>(
    () => (summary
      ? [
          { name: '成功', value: summary.successCount },
          { name: '失败', value: summary.failCount },
        ]
      : []),
    [summary],
  );

  const trendSpec = useMemo(() => makeAreaSpec({
    data: filledDailyStats,
    xField: 'date',
    series: [
      { field: 'successCount', name: '成功', color: palette.success },
      { field: 'failCount', name: '失败', color: palette.danger },
    ],
    palette,
    stack: true,
    point: days <= 7,
    pointSize: 6,
    fillOpacity: 0.26,
    axis: { xLabel: (value) => value.slice(5) },
    tooltip: {
      title: (value) => `日期：${value}`,
      value: (value) => `${value} 次`,
    },
  }), [days, filledDailyStats, palette]);
  const userBarSpec = useMemo(() => makeBarSpec({
    data: userChartData,
    xField: 'name',
    series: [{ field: 'count', name: '登录次数', color: palette.success }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    labelColor: palette.success,
    categoryAxisWidth: 88,
    tooltip: { value: (value) => `${value} 次` },
  }), [palette, userChartData]);
  const ipFailBarSpec = useMemo(() => makeBarSpec({
    data: ipFailChartData,
    xField: 'name',
    series: [{ field: 'count', name: '失败次数', color: palette.risk }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    labelColor: palette.risk,
    categoryAxisWidth: 120,
    tooltip: { value: (value) => `${value} 次` },
  }), [ipFailChartData, palette]);
  const hourlySpec = useMemo(() => makeBarSpec({
    data: hourlyChartData,
    xField: 'name',
    series: [{ field: 'count', name: '登录次数', color: palette.active }],
    palette,
    barMaxWidth: 18,
    axis: { xLabel: (value) => value.replace(':00', 'h') },
    tooltip: {
      title: (value) => `${value} - ${value.replace(':00', ':59')}`,
      value: (value) => `${value} 次`,
    },
  }), [hourlyChartData, palette]);
  const statusSpec = useMemo(() => makePieSpec({
    data: statusPieData,
    categoryField: 'name',
    valueField: 'value',
    palette,
    donut: true,
    colors: [palette.success, palette.danger],
    outerRadius: 0.86,
    innerRadius: 0.58,
    padAngle: 1.5,
    cornerRadius: 5,
    label: 'value',
    labelPosition: 'inside',
    labelColor: '#fff',
    labelFontSize: 12,
    indicator: { title: successRate == null ? '--' : `${successRate}%`, subtitle: '成功率' },
    indicatorTitleFontSize: 28,
    tooltipKey: '次数',
    valueUnit: '次',
  }), [palette, statusPieData, successRate]);
  const browserSpec = useMemo(() => makePieSpec({
    data: browserData,
    categoryField: 'name',
    valueField: 'value',
    palette,
    donut: true,
    innerRadius: 0.48,
    outerRadius: 0.82,
    padAngle: 1,
    cornerRadius: 3,
    legendLabelFontSize: 11,
    tooltipKey: '访问次数',
    valueUnit: '次',
  }), [browserData, palette]);
  const osSpec = useMemo(() => makePieSpec({
    data: osData,
    categoryField: 'name',
    valueField: 'value',
    palette,
    donut: true,
    innerRadius: 0.48,
    outerRadius: 0.82,
    padAngle: 1,
    cornerRadius: 3,
    legendLabelFontSize: 11,
    tooltipKey: '访问次数',
    valueUnit: '次',
  }), [osData, palette]);
  const weekdaySpec = useMemo(() => makeBarSpec({
    data: weekdayChartData,
    xField: 'name',
    series: [{ field: 'count', name: '登录次数', color: palette.primary }],
    palette,
    showLabel: true,
    tooltip: { value: (v) => `${v} 次` },
  }), [weekdayChartData, palette]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Select value={days} onChange={(v) => setDays(v as number)} style={{ width: 140 }}>
          {DAYS_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
          ))}
        </Select>
      </div>

      <Spin spinning={statsQuery.isFetching}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard title="总登录次数" value={summary ? summary.total.toLocaleString() : '—'} sub={`近 ${days} 天累计`} icon={<LogIn size={22} />} accent="var(--semi-color-primary)" />
          <StatCard
            title="登录成功率"
            value={successRate == null ? '—' : `${successRate}%`}
            sub={summary ? `成功 ${summary.successCount.toLocaleString()} · 失败 ${summary.failCount.toLocaleString()}` : undefined}
            icon={<CheckCircle2 size={22} />}
            accent="var(--semi-color-success)"
          />
          <StatCard
            title="登录失败次数"
            value={summary ? summary.failCount.toLocaleString() : '—'}
            sub="密码错误、账号锁定等"
            icon={<XCircle size={22} />}
            accent={summary && summary.failCount > 0 ? 'var(--semi-color-danger)' : undefined}
          />
          <StatCard title="活跃用户数" value={summary ? summary.uniqueUsers.toLocaleString() : '—'} sub="不重复用户账号" icon={<Users size={22} />} accent="var(--semi-color-data-2)" />
        </div>

        <ChartShell title="每日登录趋势（成功 / 失败）">
          {isEmptyValues(filledDailyStats) ? <EmptyChart height={230} /> : (
            <AreaChart {...trendSpec} options={chartOptions} height={230} />
          )}
        </ChartShell>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginTop: 16, marginBottom: 16 }}>
          <ChartShell title="Top 10 登录用户">
            {userChartData.length === 0 ? <EmptyChart /> : (
              <BarChart {...userBarSpec} options={chartOptions} height={260} />
            )}
          </ChartShell>
          <ChartShell
            danger={ipFailChartData.length > 0}
            title={(
              <>
                失败登录 Top 10 IP
                {ipFailChartData.length > 0 && <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 8, color: 'var(--semi-color-text-2)' }}>可能存在安全风险</span>}
              </>
            )}
          >
            {ipFailChartData.length === 0 ? <EmptyChart tone="success" text="该时间段无失败登录" /> : (
              <BarChart {...ipFailBarSpec} options={chartOptions} height={260} />
            )}
          </ChartShell>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
          <ChartShell title="按小时登录分布">
            {isEmptyValues(hourlyChartData) ? <EmptyChart height={240} /> : (
              <BarChart {...hourlySpec} options={chartOptions} height={240} />
            )}
          </ChartShell>
          <ChartShell title="成功 / 失败占比">
            {isEmptyValues(statusPieData) ? <EmptyChart height={240} /> : (
              <PieChart {...statusSpec} options={chartOptions} height={240} />
            )}
          </ChartShell>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
          <ChartShell title="浏览器分布">
            {browserData.length === 0 ? <EmptyChart height={260} /> : (
              <PieChart {...browserSpec} options={chartOptions} height={260} />
            )}
          </ChartShell>
          <ChartShell title="操作系统分布">
            {osData.length === 0 ? <EmptyChart height={260} /> : (
              <PieChart {...osSpec} options={chartOptions} height={260} />
            )}
          </ChartShell>
        </div>

        <ChartShell title={`按星期登录分布（近 ${days} 天）`}>
          {isEmptyValues(weekdayChartData) ? <EmptyChart height={220} /> : (
            <BarChart {...weekdaySpec} options={chartOptions} height={220} />
          )}
        </ChartShell>
      </Spin>
    </div>
  );
}
