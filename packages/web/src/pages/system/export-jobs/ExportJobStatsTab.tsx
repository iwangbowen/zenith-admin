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
import type { ExportJobFormat, ExportJobStatus } from '@zenith/shared/tasks';
import { formatBytes } from '@zenith/shared/core';
import { useExportJobStats } from '@/hooks/queries/export-jobs';
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
const EXPIRED_COLOR = '#f97316';

const STATUS_META: Record<ExportJobStatus, { label: string; color: string }> = {
  pending: { label: '等待中', color: PENDING_COLOR },
  running: { label: '执行中', color: RUNNING_COLOR },
  success: { label: '已完成', color: SUCCESS_COLOR },
  failed: { label: '失败', color: FAIL_COLOR },
  cancelled: { label: '已取消', color: CANCELLED_COLOR },
  expired: { label: '已过期', color: EXPIRED_COLOR },
};

const FORMAT_LABELS: Record<ExportJobFormat, string> = {
  xlsx: 'Excel',
  csv: 'CSV',
  pdf: 'PDF',
  docx: 'Word',
};

/** 无数据时保留图表坐标系；环形图用中性占位环，不展示伪占比标签 */
const NO_DATA_PIE = [{ name: '暂无数据', value: 1 }];
const NO_DATA_BAR = [{ label: '暂无数据', total: 0, failed: 0 }];
const NO_DATA_SUBMITTER_BAR = [{ username: '暂无数据', count: 0, failed: 0 }];

function successRateColor(rate: number | null): string | undefined {
  if (rate == null) return undefined;
  if (rate >= 99) return 'var(--semi-color-success)';
  if (rate >= 90) return 'var(--semi-color-warning)';
  return 'var(--semi-color-danger)';
}

function rateText(rate: number | null): string {
  return rate == null ? EMPTY_PLACEHOLDER : `${rate}%`;
}

/** 导出中心统计页签：健康度指标卡 + 趋势/分布/榜单图表 */
export default function ExportJobStatsTab() {
  const statsQuery = useExportJobStats();
  const stats = statsQuery.data ?? null;
  const palette = useChartPalette();

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
    { name: STATUS_META.expired.label, value: stats.expired, fill: STATUS_META.expired.color },
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

  const formatData = useMemo(
    () => (stats?.formats ?? []).map((item) => ({
      name: FORMAT_LABELS[item.format] ?? item.format.toUpperCase(),
      value: item.total,
    })),
    [stats],
  );
  const formatEmpty = formatData.length === 0;

  const formatSpec = useMemo(() => makePieSpec({
    data: formatEmpty ? NO_DATA_PIE : formatData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: formatEmpty ? [palette.fill1] : undefined,
    palette,
    indicator: { title: String(formatData.reduce((sum, item) => sum + item.value, 0)), subtitle: '格式分布' },
    label: formatEmpty ? 'none' : 'percent',
    legend: !formatEmpty,
    valueUnit: '个',
  }), [formatData, formatEmpty, palette]);

  const entityData = useMemo(() => {
    const rows = [...(stats?.topEntities ?? [])].map((item) => ({ ...item, label: item.moduleName || item.entity })).reverse();
    return rows.length > 0 ? rows : NO_DATA_BAR;
  }, [stats]);

  const entitySpec = useMemo(() => makeBarSpec({
    data: entityData,
    xField: 'label',
    series: [{ field: 'total', name: '导出任务数', color: RUNNING_COLOR }],
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
  const files = stats?.files;
  const downloads = stats?.downloads;

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
          sub={stats ? `等待 ${stats.pending} · 执行 ${stats.running}` : undefined}
          accent={stats && stats.pending + stats.running > 0 ? 'var(--semi-color-info)' : undefined}
        />
        <StatCard
          title="今日导出"
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
        <StatCard title="已完成" value={stats?.success ?? EMPTY_PLACEHOLDER} accent="var(--semi-color-success)" />
        <StatCard title="已过期" value={stats?.expired ?? EMPTY_PLACEHOLDER} accent={stats && stats.expired > 0 ? 'var(--semi-color-warning)' : undefined} />
        <StatCard title="已取消" value={stats?.cancelled ?? EMPTY_PLACEHOLDER} accent="var(--semi-color-text-2)" />
        <StatCard
          title="下载次数"
          value={downloads?.total ?? EMPTY_PLACEHOLDER}
          sub={downloads ? `近 30 天 ${downloads.last30d} 次 · ${downloads.jobs} 个任务` : undefined}
        />
        <StatCard
          title="文件总量"
          value={files ? formatBytes(files.totalBytes) : EMPTY_PLACEHOLDER}
          sub={files ? `${files.count} 个文件 · 平均 ${formatBytes(files.avgBytes ?? 0)}` : undefined}
        />
        <StatCard
          title="累计导出行数"
          value={files ? files.totalRows.toLocaleString() : EMPTY_PLACEHOLDER}
          sub={files ? `平均 ${(files.avgRows ?? 0).toLocaleString()} 行/文件` : undefined}
        />
        <StatCard
          title="近24h平均耗时"
          value={stats ? formatDurationMs(stats.avgDurationMs) : EMPTY_PLACEHOLDER}
        />
      </StatGrid>

      <div className="chart-grid" style={{ marginBottom: 16 }}>
        <ChartCard
          title={`近 ${TREND_DAYS} 天导出趋势`}
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
          title="导出格式分布"
          loading={statsQuery.isPending}
          height={CHART_HEIGHT}
        >
          <PieChart {...formatSpec} options={chartOptions} height={CHART_HEIGHT} />
        </ChartCard>
      </div>

      <div className="chart-grid">
        <ChartCard
          title="模块导出 Top 5"
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
