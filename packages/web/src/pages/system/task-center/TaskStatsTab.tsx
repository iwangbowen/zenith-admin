import { useMemo } from 'react';
import { Card } from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import type { AsyncTaskStats } from '@zenith/shared/tasks';
import {
  BarChart,
  PieChart,
  EmptyChart,
  StatCard,
  StatGrid,
  chartOptions,
  datumNumber,
  makeBarSpec,
  makePieSpec,
  useChartPalette,
} from '@/components/charts';
import { asyncTaskRateColor } from '@/utils/async-task';
import { formatDurationMs as formatDuration } from '@/utils/format';
import { shortDate } from '@/utils/date';

const SUCCESS_COLOR = '#10b981';
const FAIL_COLOR = '#ef4444';
const RUNNING_COLOR = '#3b82f6';
const PENDING_COLOR = '#f59e0b';
const CANCELLED_COLOR = '#9ca3af';
const TREND_DAYS = 14;
const CHART_HEIGHT = 260;

/** 积压等待时长展示：超过一小时按小时计 */
function formatWaiting(minutes: number | null): string {
  if (minutes === null) return '无积压';
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.round((minutes / 60) * 10) / 10} 小时`;
}

/** 任务统计页签：健康度指标卡 + 趋势/分布图表。按类型的执行质量并入「任务类型」页签 */
export default function TaskStatsTab({ stats }: Readonly<{ stats: AsyncTaskStats | null }>) {
  const palette = useChartPalette();

  // 近 14 天趋势：补齐无提交的日期，堆叠 = 当日提交总量
  const filledDaily = useMemo(() => {
    const map = new Map((stats?.daily ?? []).map((d) => [d.date, d]));
    const today = dayjs();
    return Array.from({ length: TREND_DAYS }, (_, i) => {
      const date = today.subtract(TREND_DAYS - 1 - i, 'day').format('YYYY-MM-DD');
      const d = map.get(date);
      const submitted = d?.submitted ?? 0;
      const success = d?.success ?? 0;
      const failed = d?.failed ?? 0;
      return { date, submitted, success, failed, other: Math.max(submitted - success - failed, 0) };
    });
  }, [stats]);
  const dailyEmpty = filledDaily.every((d) => d.submitted === 0);

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

  // 近 24 小时分布：按整点补齐 24 个桶
  const filledHourly = useMemo(() => {
    const map = new Map((stats?.hourly ?? []).map((h) => [h.hour, h]));
    const nowHour = dayjs().startOf('hour');
    return Array.from({ length: 24 }, (_, i) => {
      const t = nowHour.subtract(23 - i, 'hour');
      const h = map.get(t.format('YYYY-MM-DD HH:00'));
      const submitted = h?.submitted ?? 0;
      const failed = h?.failed ?? 0;
      return { hourLabel: t.format('HH:00'), ok: Math.max(submitted - failed, 0), failed };
    });
  }, [stats]);
  const hourlyEmpty = filledHourly.every((d) => d.ok === 0 && d.failed === 0);

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
    { name: '排队中', value: stats.pending, fill: PENDING_COLOR },
    { name: '执行中', value: stats.running, fill: RUNNING_COLOR },
    { name: '已完成', value: stats.success, fill: SUCCESS_COLOR },
    { name: '失败', value: stats.failed, fill: FAIL_COLOR },
    { name: '已取消', value: stats.cancelled, fill: CANCELLED_COLOR },
  ].filter((d) => d.value > 0) : []), [stats]);

  const statusSpec = useMemo(() => makePieSpec({
    data: statusData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: statusData.map((d) => d.fill),
    palette,
    indicator: { title: String(stats?.total ?? 0), subtitle: '总任务' },
    valueUnit: '个',
  }), [statusData, palette, stats?.total]);

  // 提交人 Top：水平条形自下而上排列，reverse 让提交最多的显示在最上方
  const submitterData = useMemo(
    () => [...(stats?.topSubmitters ?? [])].reverse(),
    [stats],
  );

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
    tooltip: {
      value: (value, _seriesName, datum) => `${value} 个（失败 ${datumNumber(datum, 'failed')} 个）`,
    },
  }), [submitterData, palette]);

  const todayDelta = stats ? stats.today.submitted - stats.today.yesterdaySubmitted : null;

  return (
    <div className="zx-flat-panels">
      <StatGrid minItemWidth={150} style={{ marginBottom: 16 }}>
        <StatCard title="总任务" value={stats?.total ?? '-'} />
        <StatCard
          title="进行中"
          value={stats ? stats.pending + stats.running : '-'}
          sub={stats ? `排队 ${stats.pending} · 执行 ${stats.running}` : undefined}
          accent={stats && stats.pending + stats.running > 0 ? 'var(--semi-color-info)' : undefined}
        />
        <StatCard
          title="待执行积压"
          value={stats?.backlog.pending ?? '-'}
          sub={stats ? `最久等待 ${formatWaiting(stats.backlog.oldestPendingMinutes)}` : undefined}
          accent={stats && stats.backlog.pending > 0 ? 'var(--semi-color-warning)' : undefined}
        />
        <StatCard
          title="今日提交"
          value={stats?.today.submitted ?? '-'}
          sub={stats ? `成功 ${stats.today.success} · 失败 ${stats.today.failed}` : undefined}
          delta={todayDelta}
        />
        <StatCard
          title="成功率"
          value={stats?.successRate == null ? '-' : `${stats.successRate}%`}
          accent={asyncTaskRateColor(stats?.successRate ?? null)}
        />
        <StatCard
          title="失败"
          value={stats?.failed ?? '-'}
          accent={stats && stats.failed > 0 ? 'var(--semi-color-danger)' : undefined}
        />
        <StatCard title="已完成" value={stats?.success ?? '-'} accent="var(--semi-color-success)" />
        <StatCard title="已取消" value={stats?.cancelled ?? '-'} accent="var(--semi-color-text-2)" />
        <StatCard
          title="发生过重试"
          value={stats?.retried ?? '-'}
          sub={stats ? `重试后成功 ${stats.retriedRecovered} 个` : undefined}
          accent={stats && stats.retried > 0 ? 'var(--semi-color-warning)' : undefined}
        />
        <StatCard title="近24h平均耗时" value={stats ? formatDuration(stats.avgDurationMs) : '-'} />
        <StatCard
          title="近24h P95 耗时"
          value={stats ? formatDuration(stats.duration.p95) : '-'}
          sub={stats ? `P50 ${formatDuration(stats.duration.p50)} · 最长 ${formatDuration(stats.duration.max)}` : undefined}
        />
        <StatCard
          title="累计处理行数"
          value={stats ? stats.items.processed.toLocaleString() : '-'}
          sub={stats ? `失败 ${stats.items.failed.toLocaleString()} 行` : undefined}
        />
      </StatGrid>

      <div className="chart-grid" style={{ marginBottom: 16 }}>
        <Card title="近 14 天任务趋势">
          {dailyEmpty
            ? <EmptyChart height={CHART_HEIGHT} />
            : <BarChart {...trendSpec} options={chartOptions} height={CHART_HEIGHT} />}
        </Card>
        <Card title="近 24 小时提交分布">
          {hourlyEmpty
            ? <EmptyChart height={CHART_HEIGHT} />
            : <BarChart {...hourlySpec} options={chartOptions} height={CHART_HEIGHT} />}
        </Card>
      </div>

      <div className="chart-grid" style={{ marginBottom: 16 }}>
        <Card title="任务状态分布">
          {statusData.length === 0
            ? <EmptyChart height={CHART_HEIGHT} />
            : <PieChart {...statusSpec} options={chartOptions} height={CHART_HEIGHT} />}
        </Card>
        <Card title="提交人 Top 5（近 30 天）">
          {submitterData.length === 0
            ? <EmptyChart height={CHART_HEIGHT} />
            : <BarChart {...submitterSpec} options={chartOptions} height={CHART_HEIGHT} />}
        </Card>
      </div>
    </div>
  );
}
