import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Spin, Select } from '@douyinfe/semi-ui';
import { LogIn, CheckCircle2, XCircle, Users } from 'lucide-react';
import {
  AreaChart,
  BarChart,
  HeatmapChart,
  PieChart,
  type IAreaChartSpec,
  type IBarChartSpec,
  type IHeatmapChartSpec,
  type IPieChartSpec,
} from '@visactor/react-vchart';
import dayjs from 'dayjs';
import { request } from '@/utils/request';
import { formatDate } from '@/utils/date';
import { useThemeController } from '@/providers/theme-controller';
import type { LoginLogStats } from '@zenith/shared';

const DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const SUCCESS_COLOR = 'var(--semi-color-success)';
const FAIL_COLOR = 'var(--semi-color-danger)';
const RISK_COLOR = '#f43f5e';

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

interface HeatmapDatum {
  readonly week: string;
  readonly weekday: string;
  readonly date: string;
  readonly count: number;
  readonly inRange: boolean;
  readonly monthLabel: string;
}

type ChartDatum = Record<string, unknown> | undefined;

interface ChartPalette {
  readonly success: string;
  readonly danger: string;
  readonly risk: string;
  readonly active: string;
  readonly primary: string;
  readonly text0: string;
  readonly text1: string;
  readonly text2: string;
  readonly border: string;
  readonly fill1: string;
  readonly grid: string;
  readonly tooltipBg: string;
  readonly tooltipShadow: string;
  readonly dataColors: string[];
  readonly heatColors: string[];
}

function cssVar(name: string, fallback: string): string {
  const fromBody = getComputedStyle(document.body).getPropertyValue(name).trim();
  if (fromBody) return fromBody;
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return fromRoot || fallback;
}

function readChartPalette(isDark: boolean): ChartPalette {
  const primary = cssVar('--semi-color-primary', isDark ? '#6aa1ff' : '#1664ff');
  const fill1 = cssVar('--semi-color-fill-1', isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(28, 31, 35, 0.06)');

  return {
    success: cssVar('--semi-color-success', isDark ? '#37d196' : '#00b42a'),
    danger: cssVar('--semi-color-danger', isDark ? '#ff7875' : '#f53f3f'),
    risk: isDark ? '#ff6b8a' : RISK_COLOR,
    active: cssVar('--semi-color-data-2', isDark ? '#74d8ff' : '#1ac6ff'),
    primary,
    text0: cssVar('--semi-color-text-0', isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.9)'),
    text1: cssVar('--semi-color-text-1', isDark ? 'rgba(255, 255, 255, 0.75)' : 'rgba(0, 0, 0, 0.62)'),
    text2: cssVar('--semi-color-text-2', isDark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.36)'),
    border: cssVar('--semi-color-border', isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(28, 31, 35, 0.12)'),
    fill1,
    grid: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(28, 31, 35, 0.10)',
    tooltipBg: cssVar('--semi-color-bg-2', isDark ? '#2f3037' : '#ffffff'),
    tooltipShadow: isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.10)',
    dataColors: Array.from({ length: 10 }, (_, i) => cssVar(`--semi-color-data-${i}`, [
      '#1664ff',
      '#1ac6ff',
      '#ff8a00',
      '#3cc780',
      '#7442d4',
      '#f54f63',
      '#00a8a8',
      '#b88400',
      '#7c5cff',
      '#6b7280',
    ][i])),
    heatColors: isDark
      ? [fill1, 'rgba(106, 161, 255, 0.22)', 'rgba(106, 161, 255, 0.42)', 'rgba(106, 161, 255, 0.66)', primary]
      : [fill1, 'rgba(22, 100, 255, 0.14)', 'rgba(22, 100, 255, 0.30)', 'rgba(22, 100, 255, 0.56)', primary],
  };
}

function useChartPalette(): ChartPalette {
  const { isDark, themeColor } = useThemeController();
  const [palette, setPalette] = useState(() => readChartPalette(isDark));

  useEffect(() => {
    const refresh = () => setPalette(readChartPalette(isDark));
    refresh();
    const raf = window.requestAnimationFrame(refresh);
    return () => window.cancelAnimationFrame(raf);
  }, [isDark, themeColor]);

  return palette;
}

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

const chartOptions = {
  mode: 'desktop-browser' as const,
  dpr: window.devicePixelRatio,
};

function compactCount(value: number): string {
  return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value);
}

function makeCommonTooltip(palette: ChartPalette): NonNullable<IAreaChartSpec['tooltip']> {
  return {
    style: {
      panel: {
        backgroundColor: palette.tooltipBg,
        border: { color: palette.border, width: 1 },
        shadow: { x: 0, y: 8, blur: 10, spread: 0, color: palette.tooltipShadow },
      },
      titleLabel: { fill: palette.text1 },
      keyLabel: { fill: palette.text2 },
      valueLabel: { fill: palette.text0 },
    },
  };
}

function makeCommonCartesianSpec(palette: ChartPalette) {
  return {
    padding: { top: 8, right: 12, bottom: 8, left: 8 },
    background: 'transparent',
    animation: true,
    tooltip: makeCommonTooltip(palette),
  };
}

function axisText(value: string | string[]): string {
  return Array.isArray(value) ? value.join('') : value;
}

function axisNumber(value: string | string[]): number {
  return Number(axisText(value)) || 0;
}

function datumText(datum: ChartDatum, field: string): string {
  const value = datum?.[field];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function datumNumber(datum: ChartDatum, field: string): number {
  const value = datum?.[field];
  return typeof value === 'number' ? value : Number(value) || 0;
}

function datumBoolean(datum: ChartDatum, field: string): boolean {
  return datum?.[field] === true;
}

function getHeatmapFill(datum: ChartDatum, max: number, palette: ChartPalette): string {
  if (!datumBoolean(datum, 'inRange')) return 'rgba(0, 0, 0, 0)';
  const count = datumNumber(datum, 'count');
  if (count <= 0 || max <= 0) return palette.heatColors[0];
  const pct = count / max;
  if (pct < 0.25) return palette.heatColors[1];
  if (pct < 0.5) return palette.heatColors[2];
  if (pct < 0.75) return palette.heatColors[3];
  return palette.heatColors[4];
}

function isEmptyValues(values: readonly { readonly count?: number; readonly value?: number }[]): boolean {
  return values.length === 0 || values.every((d) => (d.count ?? d.value ?? 0) === 0);
}

function EmptyChart({ height = 260, tone = 'muted' }: { readonly height?: number; readonly tone?: 'muted' | 'success' }) {
  return (
    <div
      style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: tone === 'success' ? SUCCESS_COLOR : 'var(--semi-color-text-2)',
        fontSize: 13,
      }}
    >
      {tone === 'success' ? '该时间段无失败登录' : '暂无数据'}
    </div>
  );
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

function makeCalendarHeatmapSpec(data: readonly HeatmapDatum[], maxCount: number, palette: ChartPalette): Partial<IHeatmapChartSpec> {
  const commonTooltip = makeCommonTooltip(palette);
  const monthLabelByWeek = new Map(data.map((d) => [d.week, d.monthLabel]));

  return {
    ...makeCommonCartesianSpec(palette),
    padding: { top: 8, right: 12, bottom: 22, left: 38 },
    data: [{ id: 'calendar-heatmap', values: [...data] }],
    xField: 'week',
    yField: 'weekday',
    valueField: 'count',
    cell: {
      style: {
        fill: (datum: ChartDatum) => getHeatmapFill(datum, maxCount, palette),
        stroke: (datum: ChartDatum) => (datumBoolean(datum, 'inRange') ? palette.tooltipBg : 'rgba(0, 0, 0, 0)'),
        lineWidth: 2,
        cornerRadius: 4,
      },
    },
    label: { visible: false },
    axes: [
      {
        orient: 'bottom',
        type: 'band',
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: false },
        label: {
          style: { fill: palette.text2, fontSize: 11 },
          space: 8,
          formatMethod: (value) => monthLabelByWeek.get(axisText(value)) ?? '',
        },
      },
      {
        orient: 'left',
        type: 'band',
        inverse: true,
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: false },
        label: {
          style: { fill: palette.text2, fontSize: 11 },
        },
      },
    ],
    tooltip: {
      ...commonTooltip,
      mark: {
        title: {
          value: (datum?: ChartDatum) => {
            const date = datumText(datum, 'date');
            return datumBoolean(datum, 'inRange') ? date : `${date}（范围外）`;
          },
        },
        content: [
          {
            key: '登录次数',
            value: (datum?: ChartDatum) => `${datumNumber(datum, 'count')} 次`,
          },
        ],
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

  const heatmapData = useMemo<HeatmapDatum[]>(() => {
    if (!stats) return [];
    const dataMap = new Map(stats.dailyStats.map((d) => [d.date, d.count]));
    const today = dayjs().startOf('day');
    const startDay = today.subtract(days - 1, 'day');
    const startMon = startDay.subtract((startDay.day() + 6) % 7, 'day');
    const data: HeatmapDatum[] = [];
    let cur = startMon;
    let weekIndex = 0;
    while (!cur.isAfter(today)) {
      const week = String(weekIndex + 1);
      const firstDate = formatDate(cur.valueOf());
      const prevFirstDate = weekIndex === 0 ? null : formatDate(cur.subtract(7, 'day').valueOf());
      const monthLabel = firstDate.slice(5, 7) === prevFirstDate?.slice(5, 7) ? '' : `${firstDate.slice(5, 7)}月`;
      for (let di = 0; di < 7; di++) {
        const dt = cur.add(di, 'day');
        const dateStr = formatDate(dt.valueOf());
        data.push({
          week,
          weekday: WEEKDAY_LABELS[di],
          date: dateStr,
          count: dataMap.get(dateStr) ?? 0,
          inRange: !dt.isBefore(startDay) && !dt.isAfter(today),
          monthLabel,
        });
      }
      cur = cur.add(7, 'day');
      weekIndex += 1;
    }
    return data;
  }, [stats, days]);

  const heatmapMaxCount = useMemo(
    () => Math.max(1, ...heatmapData.filter((d) => d.inRange).map((d) => d.count)),
    [heatmapData],
  );

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
  const heatmapSpec = useMemo(() => makeCalendarHeatmapSpec(heatmapData, heatmapMaxCount, palette), [heatmapData, heatmapMaxCount, palette]);

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
            {ipFailChartData.length === 0 ? <EmptyChart tone="success" /> : (
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

        <ChartShell title={`登录热力图（近 ${days} 天）`}>
          {heatmapData.length === 0 ? <EmptyChart height={220} /> : (
            <>
              <HeatmapChart {...heatmapSpec} options={chartOptions} height={220} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: 'var(--semi-color-text-2)' }}>
                <span>少</span>
                {palette.heatColors.map((color) => (
                  <div key={color} style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
                ))}
                <span>多</span>
              </div>
            </>
          )}
        </ChartShell>
      </Spin>
    </div>
  );
}
