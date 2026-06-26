import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Spin, Select } from '@douyinfe/semi-ui';
import { LogIn, CheckCircle2, XCircle, Users } from 'lucide-react';
import {
  AreaChart,
  BarChart,
  PieChart,
  EmptyChart,
  useChartPalette,
  chartOptions,
  compactCount,
  sectionStyle,
  sectionTitleStyle,
  makeCommonTooltip,
  makeCommonCartesianSpec,
  makeBarSpec,
  axisText,
  axisNumber,
  datumText,
  datumNumber,
  isEmptyValues,
  type ChartPalette,
  type ChartDatum,
  type IAreaChartSpec,
  type IBarChartSpec,
  type IPieChartSpec,
} from '@/components/charts';
import dayjs from 'dayjs';
import { request } from '@/utils/request';
import type { LoginLogStats } from '@zenith/shared';

const DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

const FAIL_COLOR = 'var(--semi-color-danger)';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

interface TrendDatum {
  readonly date: string;
  readonly type: '成功' | '失败';
  readonly count: number;
}

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

function makeTrendSpec(data: readonly TrendDatum[], days: number, palette: ChartPalette): Partial<IAreaChartSpec> {
  const commonTooltip = makeCommonTooltip(palette);
  return {
    ...makeCommonCartesianSpec(palette),
    data: [{ id: 'trend', values: [...data] }],
    xField: 'date',
    yField: 'count',
    seriesField: 'type',
    stack: true,
    color: [palette.success, palette.danger],
    area: {
      style: {
        fillOpacity: (datum: ChartDatum) => (datumText(datum, 'type') === '失败' ? 0.32 : 0.22),
        curveType: 'monotone',
      },
    },
    line: {
      style: {
        lineWidth: 2,
        curveType: 'monotone',
      },
    },
    point: {
      visible: days <= 7,
      style: { size: 6 },
    },
    axes: [
      {
        orient: 'bottom',
        type: 'band',
        label: {
          style: { fontSize: 11, fill: palette.text2 },
          space: 8,
          formatMethod: (value) => axisText(value).slice(5),
        },
        sampling: false,
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: false },
      },
      {
        orient: 'left',
        type: 'linear',
        label: {
          style: { fontSize: 12, fill: palette.text2 },
          formatMethod: (value) => compactCount(axisNumber(value)),
        },
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: true, style: { stroke: palette.grid, lineDash: [3, 4], lineWidth: 1 } },
      },
    ],
    legends: {
      visible: true,
      orient: 'bottom',
      position: 'middle',
      item: {
        label: { style: { fill: palette.text1, fontSize: 12 } },
      },
    },
    tooltip: {
      ...commonTooltip,
      dimension: {
        title: {
          value: (datum?: ChartDatum | ChartDatum[]) => {
            const first = Array.isArray(datum) ? datum[0] : datum;
            return `日期：${datumText(first, 'date')}`;
          },
        },
      },
      mark: {
        content: [
          {
            key: (datum?: ChartDatum) => datumText(datum, 'type'),
            value: (datum?: ChartDatum) => `${datumNumber(datum, 'count')} 次`,
          },
        ],
      },
    },
  };
}

function makeHorizontalBarSpec(data: readonly BarDatum[], color: string, labelWidth: number, palette: ChartPalette): Partial<IBarChartSpec> {
  const commonTooltip = makeCommonTooltip(palette);
  return {
    ...makeCommonCartesianSpec(palette),
    data: [{ id: 'bar', values: [...data] }],
    direction: 'horizontal',
    xField: 'count',
    yField: 'name',
    color: [color],
    barMaxWidth: 16,
    barMinHeight: 3,
    bar: {
      style: {
        cornerRadius: [0, 5, 5, 0],
        fillOpacity: 0.9,
      },
    },
    label: {
      visible: true,
      position: 'right',
      formatMethod: (_text, datum) => compactCount(datumNumber(datum, 'count')),
      style: { fill: color, fontSize: 11 },
    },
    axes: [
      {
        orient: 'bottom',
        type: 'linear',
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: true, style: { stroke: palette.grid, lineDash: [3, 4] } },
        label: {
          style: { fill: palette.text2, fontSize: 12 },
          formatMethod: (value) => compactCount(axisNumber(value)),
        },
      },
      {
        orient: 'left',
        type: 'band',
        width: labelWidth,
        tick: { visible: false },
        domainLine: { visible: false },
        label: {
          style: { fill: palette.text1, fontSize: 12 },
          autoLimit: true,
        },
      },
    ],
    tooltip: {
      ...commonTooltip,
      mark: {
        title: { value: (datum?: ChartDatum) => datumText(datum, 'name') },
        content: [
          {
            key: '次数',
            value: (datum?: ChartDatum) => `${datumNumber(datum, 'count')} 次`,
          },
        ],
      },
    },
  };
}

function makeHourlySpec(data: readonly BarDatum[], palette: ChartPalette): Partial<IBarChartSpec> {
  const commonTooltip = makeCommonTooltip(palette);
  return {
    ...makeCommonCartesianSpec(palette),
    data: [{ id: 'hourly', values: [...data] }],
    xField: 'name',
    yField: 'count',
    color: [palette.active],
    barMaxWidth: 18,
    bar: {
      style: {
        cornerRadius: [4, 4, 0, 0],
        fillOpacity: 0.92,
      },
      state: {
        hover: { fillOpacity: 1 },
      },
    },
    axes: [
      {
        orient: 'bottom',
        type: 'band',
        tick: { visible: false },
        domainLine: { visible: false },
        label: {
          style: { fill: palette.text2, fontSize: 11 },
          formatMethod: (value) => axisText(value).replace(':00', 'h'),
        },
        sampling: false,
      },
      {
        orient: 'left',
        type: 'linear',
        width: 40,
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: true, style: { stroke: palette.grid, lineDash: [3, 4] } },
        label: {
          style: { fill: palette.text2, fontSize: 12 },
          formatMethod: (value) => compactCount(axisNumber(value)),
        },
      },
    ],
    tooltip: {
      ...commonTooltip,
      mark: {
        title: {
          value: (datum?: ChartDatum) => {
            const hour = datumText(datum, 'name');
            return `${hour} - ${hour.replace(':00', ':59')}`;
          },
        },
        content: [{ key: '登录次数', value: (datum?: ChartDatum) => `${datumNumber(datum, 'count')} 次` }],
      },
    },
  };
}

function makeDonutSpec(data: readonly PieDatum[], successRate: string | null, palette: ChartPalette): Partial<IPieChartSpec> {
  const commonTooltip = makeCommonTooltip(palette);
  return {
    type: 'pie',
    data: [{ id: 'status', values: [...data] }],
    categoryField: 'name',
    valueField: 'value',
    color: [palette.success, palette.danger],
    outerRadius: 0.86,
    innerRadius: 0.58,
    padAngle: 1.5,
    cornerRadius: 5,
    legends: {
      visible: true,
      orient: 'bottom',
      item: { label: { style: { fill: palette.text1, fontSize: 12 } } },
    },
    indicator: {
      visible: true,
      title: {
        visible: true,
        autoLimit: true,
        style: { text: successRate == null ? '--' : `${successRate}%`, fill: palette.text0, fontSize: 28, fontWeight: 700 },
      },
      content: [
        {
          visible: true,
          style: { text: '成功率', fill: palette.text2, fontSize: 12 },
        },
      ],
    },
    label: {
      visible: true,
      position: 'inside',
      formatMethod: (_text, datum) => {
        const value = datumNumber(datum, 'value');
        return value > 0 ? compactCount(value) : '';
      },
      style: { fill: '#fff', fontSize: 12, fontWeight: 600 },
    },
    tooltip: {
      ...commonTooltip,
      mark: {
        title: { value: (datum?: ChartDatum) => datumText(datum, 'name') },
        content: [{ key: '次数', value: (datum?: ChartDatum) => `${datumNumber(datum, 'value')} 次` }],
      },
    },
  };
}

function makeCategoryDonutSpec(data: readonly PieDatum[], palette: ChartPalette): Partial<IPieChartSpec> {
  const commonTooltip = makeCommonTooltip(palette);
  return {
    type: 'pie',
    data: [{ id: 'category-pie', values: [...data] }],
    categoryField: 'name',
    valueField: 'value',
    color: palette.dataColors,
    innerRadius: 0.48,
    outerRadius: 0.82,
    padAngle: 1,
    cornerRadius: 3,
    legends: {
      visible: true,
      orient: 'bottom',
      position: 'middle',
      item: { label: { style: { fill: palette.text1, fontSize: 11 } } },
    },
    label: {
      visible: true,
      position: 'outside',
      formatMethod: (_text, datum) => {
        const value = datumNumber(datum, 'value');
        const name = datumText(datum, 'name');
        const total = data.reduce((sum, item) => sum + item.value, 0);
        if (total <= 0 || value / total < 0.05) return '';
        return `${name} ${Math.round((value / total) * 100)}%`;
      },
      line: { visible: true },
      style: { fill: palette.text1, fontSize: 11 },
    },
    tooltip: {
      ...commonTooltip,
      mark: {
        title: { value: (datum?: ChartDatum) => datumText(datum, 'name') },
        content: [{ key: '访问次数', value: (datum?: ChartDatum) => `${datumNumber(datum, 'value')} 次` }],
      },
    },
  };
}

export default function LoginLogStatsPanel() {
  const palette = useChartPalette();
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<LoginLogStats | null>(null);

  const fetchStats = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await request.get<LoginLogStats>(`/api/login-logs/stats?days=${d}`);
      setStats(res.data);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats(days);
  }, [days, fetchStats]);

  const filledDailyStats = useMemo(() => {
    if (!stats) return [];
    const dataMap = new Map(stats.dailyStats.map((d) => [d.date, d]));
    const today = dayjs();
    return Array.from({ length: days }, (_, i) => {
      const date = today.subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
      return dataMap.get(date) ?? { date, count: 0, successCount: 0, failCount: 0 };
    });
  }, [stats, days]);

  const trendData = useMemo<TrendDatum[]>(
    () => filledDailyStats.flatMap((d) => [
      { date: d.date, type: '成功', count: d.successCount },
      { date: d.date, type: '失败', count: d.failCount },
    ]),
    [filledDailyStats],
  );

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

  const trendSpec = useMemo(() => makeTrendSpec(trendData, days, palette), [days, palette, trendData]);
  const userBarSpec = useMemo(() => makeHorizontalBarSpec(userChartData, palette.success, 88, palette), [palette, userChartData]);
  const ipFailBarSpec = useMemo(() => makeHorizontalBarSpec(ipFailChartData, palette.risk, 120, palette), [ipFailChartData, palette]);
  const hourlySpec = useMemo(() => makeHourlySpec(hourlyChartData, palette), [hourlyChartData, palette]);
  const statusSpec = useMemo(() => makeDonutSpec(statusPieData, successRate, palette), [palette, statusPieData, successRate]);
  const browserSpec = useMemo(() => makeCategoryDonutSpec(browserData, palette), [browserData, palette]);
  const osSpec = useMemo(() => makeCategoryDonutSpec(osData, palette), [osData, palette]);
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

      <Spin spinning={loading}>
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
          {isEmptyValues(trendData) ? <EmptyChart height={230} /> : (
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
