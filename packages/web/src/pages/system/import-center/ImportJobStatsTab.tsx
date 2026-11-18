import { useMemo } from 'react';
import dayjs from 'dayjs';
import {
  BarChart,
  ChartCard,
  PieChart,
  StatCard,
  StatGrid,
  chartOptions,
  datumNumber,
  makeBarSpec,
  makePieSpec,
  useChartPalette,
} from '@/components/charts';
import type { AsyncTaskStatus, ImportJobStats } from '@zenith/shared/tasks';
import { useImportEntities, useImportJobStats } from '@/hooks/queries/import-jobs';
import { SearchToolbar } from '@/components/SearchToolbar';
import { RefreshButton } from '@/components/toolbar-controls';
import { formatDurationMs } from '@/utils/format';
import { shortDate } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const TREND_DAYS = 14;
const CHART_HEIGHT = 240;
const SUCCESS_COLOR = '#10b981';
const FAIL_COLOR = '#ef4444';
const RUNNING_COLOR = '#3b82f6';
const PENDING_COLOR = '#f59e0b';
const CANCELLED_COLOR = '#9ca3af';

/** 无数据时保留图表坐标系；环形图用中性占位环，不展示伪占比标签 */
const NO_DATA_PIE = [{ name: '暂无数据', value: 1 }];
const NO_DATA_BAR = [{ label: '暂无数据', total: 0, failed: 0 }];
const NO_DATA_SUBMITTER_BAR = [{ username: '暂无数据', count: 0, failed: 0 }];

const STATUS_META: Record<AsyncTaskStatus, { label: string; color: string }> = {
  pending: { label: '排队中', color: PENDING_COLOR },
  running: { label: '执行中', color: RUNNING_COLOR },
  success: { label: '成功', color: SUCCESS_COLOR },
  failed: { label: '失败', color: FAIL_COLOR },
  cancelled: { label: '已取消', color: CANCELLED_COLOR },
};

function successRateColor(rate: number | null): string | undefined {
  if (rate == null) return undefined;
  if (rate >= 99) return 'var(--semi-color-success)';
  if (rate >= 90) return 'var(--semi-color-warning)';
  return 'var(--semi-color-danger)';
}

function rateText(rate: number | null): string {
  return rate == null ? EMPTY_PLACEHOLDER : `${rate}%`;
}

function modeCount(stats: ImportJobStats | null, mode: 'preview' | 'import'): { total: number; success: number; failed: number } {
  const row = stats?.modes.find((item) => item.mode === mode);
  return { total: row?.total ?? 0, success: row?.success ?? 0, failed: row?.failed ?? 0 };
}

/** 导入中心统计页签：健康度指标卡 + 趋势/分布/实体榜单图表 */
export default function ImportJobStatsTab() {
  const statsQuery = useImportJobStats();
  const stats = statsQuery.data ?? null;
  const entitiesQuery = useImportEntities();
  const palette = useChartPalette();

  const entityTitles = useMemo(
    () => new Map((entitiesQuery.data ?? []).map((item) => [item.entity, item.title])),
    [entitiesQuery.data],
  );

  const filledDaily = useMemo(() => {
    const map = new Map((stats?.daily ?? []).map((item) => [item.date, item]));
    const today = dayjs();
    return Array.from({ length: TREND_DAYS }, (_, index) => {
      const date = today.subtract(TREND_DAYS - 1 - index, 'day').format('YYYY-MM-DD');
      const item = map.get(date);
      const submitted = item?.submitted ?? 0;
      const success = item?.success ?? 0;
      const failed = item?.failed ?? 0;
      return { date, submitted, success, failed, other: Math.max(submitted - success - failed, 0) };
    });
  }, [stats]);

  const trendSpec = useMemo(() => makeBarSpec({
    data: filledDaily,
    xField: 'date',
    series: [
      { field: 'success', name: '成功', color: SUCCESS_COLOR },
      { field: 'failed', name: '失败', color: FAIL_COLOR },
      { field: 'other', name: '进行中/取消', color: CANCELLED_COLOR },
    ],
    palette,
    stack: true,
    barMaxWidth: 18,
    axis: { xLabel: shortDate },
    tooltip: {
      title: (value) => `日期：${value}`,
      value: (value) => `${value} 个`,
    },
  }), [filledDaily, palette]);

  const filledHourly = useMemo(() => {
    const map = new Map((stats?.hourly ?? []).map((item) => [item.hour, item]));
    const nowHour = dayjs().startOf('hour');
    return Array.from({ length: 24 }, (_, index) => {
      const at = nowHour.subtract(23 - index, 'hour');
      const item = map.get(at.format('YYYY-MM-DD HH:00'));
      const submitted = item?.submitted ?? 0;
      const failed = item?.failed ?? 0;
      return { hourLabel: at.format('HH:00'), ok: Math.max(submitted - failed, 0), failed };
    });
  }, [stats]);

  const hourlySpec = useMemo(() => makeBarSpec({
    data: filledHourly,
    xField: 'hourLabel',
    series: [
      { field: 'ok', name: '正常', color: RUNNING_COLOR },
      { field: 'failed', name: '失败', color: FAIL_COLOR },
    ],
    palette,
    stack: true,
    barMaxWidth: 14,
    axis: { xLabel: (value) => value.replace(':00', 'h') },
    tooltip: {
      title: (value) => `${value} - ${value.replace(':00', ':59')}`,
      value: (value) => `${value} 个`,
    },
  }), [filledHourly, palette]);

  const statusData = useMemo(() => (stats ? [
    { name: STATUS_META.pending.label, value: stats.pending, fill: STATUS_META.pending.color },
    { name: STATUS_META.running.label, value: stats.running, fill: STATUS_META.running.color },
    { name: STATUS_META.success.label, value: stats.success, fill: STATUS_META.success.color },
    { name: STATUS_META.failed.label, value: stats.failed, fill: STATUS_META.failed.color },
    { name: STATUS_META.cancelled.label, value: stats.cancelled, fill: STATUS_META.cancelled.color },
  ].filter((item) => item.value > 0) : []), [stats]);

  const statusEmpty = statusData.length === 0;
  const statusSpec = useMemo(() => makePieSpec({
    data: statusEmpty ? NO_DATA_PIE : statusData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: statusEmpty ? [palette.fill1] : statusData.map((item) => item.fill),
    palette,
    indicator: { title: String(stats?.total ?? 0), subtitle: '总任务' },
    label: statusEmpty ? 'none' : 'percent',
    legend: !statusEmpty,
    valueUnit: '个',
  }), [palette, stats?.total, statusData, statusEmpty]);

  const modeData = useMemo(() => (stats ? [
    { name: '正式导入', value: modeCount(stats, 'import').total, fill: RUNNING_COLOR },
    { name: '预检', value: modeCount(stats, 'preview').total, fill: PENDING_COLOR },
  ].filter((item) => item.value > 0) : []), [stats]);
  const modeEmpty = modeData.length === 0;

  const modeSpec = useMemo(() => makePieSpec({
    data: modeEmpty ? NO_DATA_PIE : modeData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: modeEmpty ? [palette.fill1] : modeData.map((item) => item.fill),
    palette,
    indicator: { title: String(modeData.reduce((sum, item) => sum + item.value, 0)), subtitle: '导入模式' },
    label: modeEmpty ? 'none' : 'percent',
    legend: !modeEmpty,
    valueUnit: '个',
  }), [modeData, modeEmpty, palette]);

  const entityData = useMemo(() => {
    const rows = [...(stats?.topEntities ?? [])]
      .map((item) => ({ ...item, label: entityTitles.get(item.entity) ?? item.entity }))
      .reverse();
    return rows.length > 0 ? rows : NO_DATA_BAR;
  }, [entityTitles, stats]);

  const entitySpec = useMemo(() => makeBarSpec({
    data: entityData,
    xField: 'label',
    series: [{ field: 'total', name: '导入任务数', color: RUNNING_COLOR }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 110,
    axis: { yLabel: (value) => Number.isInteger(value) ? String(value) : '' },
    tooltip: {
      value: (value, _seriesName, datum) => `${value} 个（失败 ${datumNumber(datum, 'failed')} 个）`,
    },
  }), [entityData, palette]);

  const submitterData = useMemo(() => {
    const rows = [...(stats?.topSubmitters ?? [])].reverse();
    return rows.length > 0 ? rows : NO_DATA_SUBMITTER_BAR;
  }, [stats]);

  const submitterSpec = useMemo(() => makeBarSpec({
    data: submitterData,
    xField: 'username',
    series: [{ field: 'count', name: '提交任务数', color: RUNNING_COLOR }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 88,
    axis: { yLabel: (value) => Number.isInteger(value) ? String(value) : '' },
    tooltip: {
      value: (value, _seriesName, datum) => `${value} 个（失败 ${datumNumber(datum, 'failed')} 个）`,
    },
  }), [palette, submitterData]);

  const todayDelta = stats ? stats.today.submitted - stats.today.yesterdaySubmitted : null;
  const importMode = modeCount(stats, 'import');
  const previewMode = modeCount(stats, 'preview');

  return (
    <>
      <SearchToolbar>
        <RefreshButton onClick={() => void statsQuery.refetch()} loading={statsQuery.isFetching} />
      </SearchToolbar>
      <div className="zx-flat-panels">
        <StatGrid minItemWidth={150} style={{ marginBottom: 16 }}>
        <StatCard title="总任务" value={stats?.total ?? EMPTY_PLACEHOLDER} />
        <StatCard
          title="进行中"
          value={stats ? stats.pending + stats.running : EMPTY_PLACEHOLDER}
          sub={stats ? `排队 ${stats.pending} · 执行 ${stats.running}` : undefined}
          accent={stats && stats.pending + stats.running > 0 ? 'var(--semi-color-info)' : undefined}
        />
        <StatCard
          title="今日提交"
          value={stats?.today.submitted ?? EMPTY_PLACEHOLDER}
          sub={stats ? `成功 ${stats.today.success} · 失败 ${stats.today.failed}` : undefined}
          delta={todayDelta}
        />
        <StatCard
          title="成功率"
          value={rateText(stats?.successRate ?? null)}
          accent={successRateColor(stats?.successRate ?? null)}
        />
        <StatCard title="失败" value={stats?.failed ?? EMPTY_PLACEHOLDER} accent={stats && stats.failed > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="成功" value={stats?.success ?? EMPTY_PLACEHOLDER} accent="var(--semi-color-success)" />
        <StatCard title="已取消" value={stats?.cancelled ?? EMPTY_PLACEHOLDER} accent="var(--semi-color-text-2)" />
        <StatCard
          title="正式导入"
          value={stats ? importMode.total : EMPTY_PLACEHOLDER}
          sub={stats ? `成功 ${importMode.success} · 失败 ${importMode.failed}` : undefined}
        />
        <StatCard
          title="预检任务"
          value={stats ? previewMode.total : EMPTY_PLACEHOLDER}
          sub={stats ? `成功 ${previewMode.success} · 失败 ${previewMode.failed}` : undefined}
          accent={stats && previewMode.total > 0 ? 'var(--semi-color-warning)' : undefined}
        />
        <StatCard
          title="累计处理行数"
          value={stats ? stats.rows.processed.toLocaleString() : EMPTY_PLACEHOLDER}
          sub={stats ? `失败 ${stats.rows.failed.toLocaleString()} 行` : undefined}
        />
        <StatCard
          title="近24h平均耗时"
          value={stats ? formatDurationMs(stats.avgDurationMs) : EMPTY_PLACEHOLDER}
        />
      </StatGrid>

      <div className="chart-grid" style={{ marginBottom: 16 }}>
        <ChartCard
          title={`近 ${TREND_DAYS} 天导入趋势`}
          loading={statsQuery.isPending}
          height={CHART_HEIGHT}
        >
          <BarChart {...trendSpec} options={chartOptions} height={CHART_HEIGHT} />
        </ChartCard>
        <ChartCard
          title="近 24 小时提交分布"
          loading={statsQuery.isPending}
          height={CHART_HEIGHT}
        >
          <BarChart {...hourlySpec} options={chartOptions} height={CHART_HEIGHT} />
        </ChartCard>
      </div>

      <div className="chart-grid" style={{ marginBottom: 16 }}>
        <ChartCard
          title="任务状态分布"
          loading={statsQuery.isPending}
          height={CHART_HEIGHT}
        >
          <PieChart {...statusSpec} options={chartOptions} height={CHART_HEIGHT} />
        </ChartCard>
        <ChartCard
          title="导入模式分布"
          loading={statsQuery.isPending}
          height={CHART_HEIGHT}
        >
          <PieChart {...modeSpec} options={chartOptions} height={CHART_HEIGHT} />
        </ChartCard>
      </div>

      <div className="chart-grid">
        <ChartCard
          title="导入实体 Top 5"
          loading={statsQuery.isPending}
          height={CHART_HEIGHT}
        >
          <BarChart {...entitySpec} options={chartOptions} height={CHART_HEIGHT} />
        </ChartCard>
        <ChartCard
          title="提交人 Top 5（近 30 天）"
          loading={statsQuery.isPending}
          height={CHART_HEIGHT}
        >
          <BarChart {...submitterSpec} options={chartOptions} height={CHART_HEIGHT} />
        </ChartCard>
      </div>
      </div>
    </>
  );
}
