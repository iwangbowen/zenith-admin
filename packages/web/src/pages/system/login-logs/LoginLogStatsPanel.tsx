import { useState, useMemo } from 'react';
import { LogIn, CheckCircle2, XCircle, Users } from 'lucide-react';
import {
  AreaChart,
  BarChart,
  HeatmapChart,
  PieChart,
  EmptyChart,
  useChartPalette,
  chartOptions,
  makeAreaSpec,
  makeBarSpec,
  makeHeatmapSpec,
  makePieSpec,
  isEmptyValues,
  StatCard,
  StatGrid,
} from '@/components/charts';
import dayjs from 'dayjs';
import { useLoginLogStats } from '@/hooks/queries/login-logs';
import { buildUserChartLabels } from '@/components/UserDisplay';
import { ChartPanel, LogStatsScaffold, WEEKDAY_LABELS, calcSuccessRate, calcSuccessRateDelta, deltaOf } from '@/components/logs/LogStatsScaffold';

interface BarDatum {
  readonly name: string;
  readonly count: number;
}

interface PieDatum {
  readonly name: string;
  readonly value: number;
}

/** GPU 名多为 "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 ...)"，提取括号内主体便于坐标轴展示 */
function shortGpuName(gpu: string): string {
  const inner = /\(([^)]+)\)/.exec(gpu)?.[1] ?? gpu;
  const parts = inner.split(',').map((s) => s.trim());
  return (parts[1] || parts[0] || gpu).slice(0, 40);
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

  const { userChartData, userChartTitleOf } = useMemo(() => {
    const items = [...(stats?.userStats ?? [])].reverse();
    const { nameOf, fullOf } = buildUserChartLabels(items);
    return {
      userChartData: items.map((d) => ({ name: nameOf(d), count: d.count })),
      userChartTitleOf: (x: string) => fullOf.get(x) ?? x,
    };
  }, [stats]);
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
  const failReasonData = useMemo<PieDatum[]>(
    () => (stats?.failReasonStats ?? []).map((d) => ({ name: d.message, value: d.count })),
    [stats],
  );
  const locationChartData = useMemo<BarDatum[]>(
    () => [...(stats?.locationStats ?? [])].reverse().map((d) => ({ name: d.location, count: d.count })),
    [stats],
  );
  const resolutionChartData = useMemo<BarDatum[]>(
    () => [...(stats?.resolutionStats ?? [])].reverse().map((d) => ({ name: d.resolution, count: d.count })),
    [stats],
  );
  const gpuChartData = useMemo<BarDatum[]>(
    () => [...(stats?.gpuStats ?? [])].reverse().map((d) => ({ name: shortGpuName(d.gpu), count: d.count })),
    [stats],
  );
  const dowHourData = useMemo(
    () => (stats?.dowHourStats ?? []).map((d) => ({
      hour: `${String(d.hour).padStart(2, '0')}h`,
      weekday: WEEKDAY_LABELS[d.dow - 1] ?? `周${d.dow}`,
      count: d.count,
    })),
    [stats],
  );

  const summary = stats?.summary;
  const prevSummary = stats?.prevSummary;
  const successRate = calcSuccessRate(summary);
  const successRateDelta = calcSuccessRateDelta(summary, prevSummary);

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
    categoryAxisWidth: 96,
    tooltip: { title: userChartTitleOf, value: (value) => `${value} 次` },
  }), [palette, userChartData, userChartTitleOf]);
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
  const failReasonSpec = useMemo(() => makePieSpec({
    data: failReasonData,
    categoryField: 'name',
    valueField: 'value',
    palette,
    donut: true,
    innerRadius: 0.48,
    outerRadius: 0.82,
    padAngle: 1,
    cornerRadius: 3,
    legendLabelFontSize: 11,
    tooltipKey: '失败次数',
    valueUnit: '次',
  }), [failReasonData, palette]);
  const locationSpec = useMemo(() => makeBarSpec({
    data: locationChartData,
    xField: 'name',
    series: [{ field: 'count', name: '登录次数', color: palette.active }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    labelColor: palette.active,
    categoryAxisWidth: 120,
    tooltip: { value: (v) => `${v} 次` },
  }), [locationChartData, palette]);
  const resolutionSpec = useMemo(() => makeBarSpec({
    data: resolutionChartData,
    xField: 'name',
    series: [{ field: 'count', name: '登录次数', color: palette.dataColors[4] ?? palette.primary }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 96,
    tooltip: { value: (v) => `${v} 次` },
  }), [resolutionChartData, palette]);
  const gpuSpec = useMemo(() => makeBarSpec({
    data: gpuChartData,
    xField: 'name',
    series: [{ field: 'count', name: '登录次数', color: palette.dataColors[6] ?? palette.primary }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 150,
    tooltip: { value: (v) => `${v} 次` },
  }), [gpuChartData, palette]);
  const dowHourSpec = useMemo(() => makeHeatmapSpec({
    data: dowHourData,
    xField: 'hour',
    yField: 'weekday',
    valueField: 'count',
    palette,
    tooltip: {
      title: (d) => `${(d as { weekday?: string })?.weekday ?? ''} ${(d as { hour?: string })?.hour ?? ''}`,
      valueName: '登录次数',
      value: (v) => `${v} 次`,
    },
  }), [dowHourData, palette]);

  return (
    <LogStatsScaffold days={days} onDaysChange={setDays} loading={statsQuery.isLoading} fetching={statsQuery.isFetching}>
        <StatGrid style={{ marginBottom: 16 }}>
          <StatCard
            title="总登录次数"
            value={summary ? summary.total.toLocaleString() : '—'}
            sub={`近 ${days} 天累计`}
            icon={<LogIn size={22} />}
            accent="var(--semi-color-primary)"
            delta={summary && prevSummary ? deltaOf(summary.total, prevSummary.total) : null}
            deltaLabel="较上一周期"
          />
          <StatCard
            title="登录成功率"
            value={successRate == null ? '—' : `${successRate}%`}
            sub={summary ? `成功 ${summary.successCount.toLocaleString()} · 失败 ${summary.failCount.toLocaleString()}` : undefined}
            icon={<CheckCircle2 size={22} />}
            accent="var(--semi-color-success)"
            delta={successRateDelta}
            deltaLabel="较上一周期"
            deltaFormat="ratio"
          />
          <StatCard
            title="登录失败次数"
            value={summary ? summary.failCount.toLocaleString() : '—'}
            sub="密码错误、账号锁定等"
            icon={<XCircle size={22} />}
            accent={summary && summary.failCount > 0 ? 'var(--semi-color-danger)' : undefined}
            delta={summary && prevSummary ? deltaOf(summary.failCount, prevSummary.failCount) : null}
            deltaLabel="较上一周期"
          />
          <StatCard
            title="活跃用户数"
            value={summary ? summary.uniqueUsers.toLocaleString() : '—'}
            sub="不重复用户账号"
            icon={<Users size={22} />}
            accent="var(--semi-color-data-2)"
            delta={summary && prevSummary ? deltaOf(summary.uniqueUsers, prevSummary.uniqueUsers) : null}
            deltaLabel="较上一周期"
          />
        </StatGrid>

        <ChartPanel title="每日登录趋势（成功 / 失败）">
          {isEmptyValues(filledDailyStats) ? <EmptyChart height={230} /> : (
            <AreaChart {...trendSpec} options={chartOptions} height={230} />
          )}
        </ChartPanel>

        <div className="chart-grid" style={{ marginTop: 16, marginBottom: 16 }}>
          <ChartPanel title="Top 10 登录用户">
            {userChartData.length === 0 ? <EmptyChart /> : (
              <BarChart {...userBarSpec} options={chartOptions} height={260} />
            )}
          </ChartPanel>
          <ChartPanel
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
          </ChartPanel>
        </div>

        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <ChartPanel title="按小时登录分布">
            {isEmptyValues(hourlyChartData) ? <EmptyChart height={240} /> : (
              <BarChart {...hourlySpec} options={chartOptions} height={240} />
            )}
          </ChartPanel>
          <ChartPanel title="成功 / 失败占比">
            {isEmptyValues(statusPieData) ? <EmptyChart height={240} /> : (
              <PieChart {...statusSpec} options={chartOptions} height={240} />
            )}
          </ChartPanel>
        </div>

        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <ChartPanel title="浏览器分布">
            {browserData.length === 0 ? <EmptyChart height={260} /> : (
              <PieChart {...browserSpec} options={chartOptions} height={260} />
            )}
          </ChartPanel>
          <ChartPanel title="操作系统分布">
            {osData.length === 0 ? <EmptyChart height={260} /> : (
              <PieChart {...osSpec} options={chartOptions} height={260} />
            )}
          </ChartPanel>
        </div>

        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <ChartPanel danger={failReasonData.length > 0} title="失败原因分布">
            {failReasonData.length === 0 ? <EmptyChart tone="success" text="该时间段无失败登录" height={260} /> : (
              <PieChart {...failReasonSpec} options={chartOptions} height={260} />
            )}
          </ChartPanel>
          <ChartPanel title="登录地点 Top 10">
            {locationChartData.length === 0 ? <EmptyChart height={260} /> : (
              <BarChart {...locationSpec} options={chartOptions} height={260} />
            )}
          </ChartPanel>
        </div>

        <ChartPanel title={`星期 × 小时登录热力（近 ${days} 天）`}>
          {isEmptyValues(dowHourData) ? <EmptyChart height={280} /> : (
            <HeatmapChart {...dowHourSpec} options={chartOptions} height={280} />
          )}
        </ChartPanel>

        <div className="chart-grid" style={{ marginTop: 16, marginBottom: 16 }}>
          <ChartPanel title="设备分辨率 Top 8">
            {resolutionChartData.length === 0 ? <EmptyChart height={240} /> : (
              <BarChart {...resolutionSpec} options={chartOptions} height={240} />
            )}
          </ChartPanel>
          <ChartPanel title="设备 GPU Top 8">
            {gpuChartData.length === 0 ? <EmptyChart height={240} /> : (
              <BarChart {...gpuSpec} options={chartOptions} height={240} />
            )}
          </ChartPanel>
        </div>

        <ChartPanel title={`按星期登录分布（近 ${days} 天）`}>
          {isEmptyValues(weekdayChartData) ? <EmptyChart height={220} /> : (
            <BarChart {...weekdaySpec} options={chartOptions} height={220} />
          )}
        </ChartPanel>
    </LogStatsScaffold>
  );
}
