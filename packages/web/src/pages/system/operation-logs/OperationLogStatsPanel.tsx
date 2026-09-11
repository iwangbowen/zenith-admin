import { useState, useMemo, type CSSProperties } from 'react';
import {
  AreaChart,
  BarChart,
  CommonChart,
  PieChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
  EmptyChart,
  useChartPalette,
  chartOptions,
  datumNumber,
  datumText,
  makeAreaSpec,
  makeBarSpec,
  makeMixedBarLineSpec,
  makePieSpec,
  makeSankeySpec,
  makeScatterSpec,
  makeTreemapSpec,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { useOperationLogStats } from '@/hooks/queries/operation-logs';
import { ModuleOperationPie } from '@/components/logs/ModuleOperationPie';
import { buildUserChartLabels, formatUserLabel } from '@/components/UserDisplay';
import { LogStatsScaffold, calcSuccessRate, calcSuccessRateDelta, deltaOf, weekdayBuckets } from '@/components/logs/LogStatsScaffold';
import { shortDate } from '@/utils/date';

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

const STATUS_CLASS_COLORS: Record<string, string> = {
  '2xx': '#10b981',
  '3xx': '#3b82f6',
  '4xx': '#f59e0b',
  '5xx': '#ef4444',
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--semi-color-text-0)',
  marginBottom: 12,
};

function formatAvgDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

const EMPTY_PLACEHOLDER_STYLE: CSSProperties = {
  height: 260,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--semi-color-text-2)',
};

export default function OperationLogStatsPanel() {
  const palette = useChartPalette();
  const [days, setDays] = useState<number>(30);
  const statsQuery = useOperationLogStats({ days });
  const stats = statsQuery.data ?? null;

  const moduleChartData = useMemo(() => [...(stats?.moduleStats ?? [])].slice(0, 10).reverse(), [stats]);
  const { userChartData, userChartTitleOf } = useMemo(() => {
    const items = [...(stats?.userStats ?? [])].reverse();
    const { nameOf, fullOf } = buildUserChartLabels(items);
    return {
      userChartData: items.map((d) => ({ displayName: nameOf(d), count: d.count })),
      userChartTitleOf: (x: string) => fullOf.get(x) ?? x,
    };
  }, [stats]);
  const moduleTimingChartData = useMemo(() => [...(stats?.moduleTimingStats ?? [])].slice(0, 10).reverse(), [stats]);
  const methodChartData = useMemo(
    () => (stats?.methodStats ?? []).map((m) => ({ ...m, fill: METHOD_COLORS[m.method] ?? DEFAULT_METHOD_COLOR })),
    [stats],
  );
  const hourlyChartData = useMemo(() => [...(stats?.hourlyStats ?? [])], [stats]);
  const dailyChartData = useMemo(() => [...(stats?.dailyStats ?? [])], [stats]);
  const statusClassData = useMemo(
    () => (stats?.statusClassStats ?? []).map((d) => ({ ...d, fill: STATUS_CLASS_COLORS[d.statusClass] ?? DEFAULT_METHOD_COLOR })),
    [stats],
  );
  const durationHistogramData = useMemo(() => [...(stats?.durationHistogram ?? [])], [stats]);
  const slowPathChartData = useMemo(() => [...(stats?.slowPaths ?? [])].reverse(), [stats]);
  const failModuleChartData = useMemo(() => [...(stats?.failModuleStats ?? [])].reverse(), [stats]);
  const dailyMixedData = useMemo(
    () => (stats?.dailyStats ?? []).map((d) => ({ ...d, avgMs: d.avgMs ?? 0 })),
    [stats],
  );
  const treemapData = useMemo(
    () => (stats?.moduleStats ?? []).map((m) => ({ name: m.module, value: m.count })),
    [stats],
  );
  const scatterData = useMemo(() => stats?.moduleTimingStats ?? [], [stats]);
  const sankeyData = useMemo(() => {
    const flows = stats?.userModuleFlows ?? [];
    if (flows.length === 0) return { nodes: [], links: [] };
    // 控制可读性：只保留操作量最大的前 8 个用户 × 前 8 个模块
    const sumBy = (key: 'username' | 'module') => {
      const m = new Map<string, number>();
      for (const f of flows) m.set(f[key], (m.get(f[key]) ?? 0) + f.count);
      return m;
    };
    const topUsers = new Set([...sumBy('username').entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k));
    const topModules = new Set([...sumBy('module').entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k));
    const kept = flows.filter((f) => topUsers.has(f.username) && topModules.has(f.module));
    // 节点仍按 username 聚合保证唯一；轴上只放短昵称（冲突退化为完整标签），完整标签给 tooltip
    const userItems = [...new Map(flows.map((f) => [f.username, { username: f.username, nickname: f.nickname }])).values()];
    const { nameOf } = buildUserChartLabels(userItems);
    const shortNameOf = new Map(userItems.map((it) => [it.username, nameOf(it)]));
    const fullNameOf = new Map(userItems.map((it) => [it.username, formatUserLabel(it.username, it.nickname)]));
    const nodeValue = new Map<string, number>();
    for (const f of kept) {
      nodeValue.set(`u:${f.username}`, (nodeValue.get(`u:${f.username}`) ?? 0) + f.count);
      nodeValue.set(`m:${f.module}`, (nodeValue.get(`m:${f.module}`) ?? 0) + f.count);
    }
    return {
      nodes: [...nodeValue.entries()].map(([id, value]) => ({
        id,
        label: id.startsWith('u:') ? shortNameOf.get(id.slice(2)) ?? id.slice(2) : id.slice(2),
        fullLabel: id.startsWith('u:') ? fullNameOf.get(id.slice(2)) ?? id.slice(2) : id.slice(2),
        value,
      })),
      links: kept.map((f) => ({ source: `u:${f.username}`, target: `m:${f.module}`, value: f.count })),
    };
  }, [stats]);

  const weekdayChartData = useMemo(() => weekdayBuckets(stats?.dailyStats), [stats]);

  const summary = stats?.summary;
  const prevSummary = stats?.prevSummary;
  const successRate = calcSuccessRate(summary);
  const avgDuration = summary?.avgDurationMs == null ? null : formatAvgDuration(summary.avgDurationMs);
  const successRateDelta = calcSuccessRateDelta(summary, prevSummary);

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
    xField: 'displayName',
    series: [{ field: 'count', name: '操作次数', color: '#10b981' }],
    palette,
    horizontal: true,
    categoryAxisWidth: 96,
    showLabel: true,
    tooltip: { title: userChartTitleOf, value: (v) => `${v} 次` },
  }), [userChartData, userChartTitleOf, palette]);

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
    axis: { xLabel: shortDate },
    tooltip: { title: (x) => `日期：${x}`, value: (v) => `${v} 次` },
  }), [dailyChartData, palette]);

  const weekdaySpec = useMemo(
    () => makeBarSpec({
      data: weekdayChartData,
      xField: 'name',
      series: [{ field: 'count', name: '操作次数', color: '#6366f1' }],
      palette,
      showLabel: true,
      tooltip: { value: (v) => `${v} 次` },
    }),
    [weekdayChartData, palette],
  );

  const statusClassSpec = useMemo(() => makePieSpec({
    data: statusClassData,
    categoryField: 'statusClass',
    valueField: 'count',
    donut: true,
    colors: statusClassData.map((d) => d.fill),
    palette,
    label: 'none',
    valueUnit: '次',
  }), [statusClassData, palette]);

  const durationHistogramSpec = useMemo(() => makeBarSpec({
    data: durationHistogramData,
    xField: 'bucket',
    series: [{ field: 'count', name: '请求数', color: '#f59e0b' }],
    palette,
    showLabel: true,
    tooltip: { value: (v) => `${v} 次` },
  }), [durationHistogramData, palette]);

  const slowPathSpec = useMemo(() => makeBarSpec({
    data: slowPathChartData,
    xField: 'path',
    series: [
      { field: 'avgMs', name: '平均耗时', color: '#f59e0b' },
      { field: 'maxMs', name: '最大耗时', color: 'rgba(239, 68, 68, 0.5)' },
    ],
    palette,
    horizontal: true,
    categoryAxisWidth: 200,
    axis: { xLabel: (v) => `${v}ms` },
    tooltip: { value: (v) => `${v} ms` },
  }), [slowPathChartData, palette]);

  const failModuleSpec = useMemo(() => makeBarSpec({
    data: failModuleChartData,
    xField: 'module',
    series: [{ field: 'count', name: '失败次数', color: FAIL_COLOR }],
    palette,
    horizontal: true,
    categoryAxisWidth: 88,
    showLabel: true,
    labelColor: FAIL_COLOR,
    tooltip: { value: (v) => `${v} 次` },
  }), [failModuleChartData, palette]);

  const dailyMixedSpec = useMemo(() => makeMixedBarLineSpec({
    data: dailyMixedData,
    xField: 'date',
    palette,
    bar: { field: 'count', name: '请求数', color: palette.dataColors[0] ?? palette.primary },
    line: { field: 'avgMs', name: '平均耗时', color: '#f59e0b' },
    axis: {
      xLabel: shortDate,
      rightLabel: (v) => `${v}ms`,
    },
    tooltip: {
      title: (x) => `日期：${x}`,
      barValue: (v) => `${v} 次`,
      lineValue: (v) => `${v} ms`,
    },
  }), [dailyMixedData, palette]);

  const treemapSpec = useMemo(() => makeTreemapSpec({
    data: treemapData,
    palette,
    tooltipItems: [{ key: '操作次数', value: (d) => `${datumNumber(d, 'value')} 次` }],
  }), [treemapData, palette]);

  const scatterSpec = useMemo(() => {
    const maxOfMax = Math.max(1, ...scatterData.map((d) => d.maxMs));
    return makeScatterSpec({
      data: scatterData,
      xField: 'count',
      yField: 'avgMs',
      palette,
      point: {
        // 气泡大小按最大耗时开方缩放（8-28px）
        size: (d) => 8 + Math.sqrt(datumNumber(d, 'maxMs') / maxOfMax) * 20,
        fill: palette.primary,
        fillOpacity: 0.55,
        stroke: palette.primary,
        lineWidth: 1,
      },
      xAxis: { label: (v) => `${v} 次` },
      yAxis: { label: (v) => `${v}ms` },
      tooltip: {
        title: (d) => datumText(d, 'module'),
        items: [
          { key: '请求数', value: (d) => `${datumNumber(d, 'count')} 次` },
          { key: '平均耗时', value: (d) => `${datumNumber(d, 'avgMs')} ms` },
          { key: '最大耗时', value: (d) => `${datumNumber(d, 'maxMs')} ms` },
        ],
      },
    });
  }, [scatterData, palette]);

  const sankeySpec = useMemo(() => makeSankeySpec({
    nodes: sankeyData.nodes,
    links: sankeyData.links,
    palette,
    nodeLayer: (node) => (node.id.startsWith('u:') ? 0 : 1),
    valueFormatter: (v) => `${v} 次`,
    tooltip: {
      nodeTitle: (datum) => String((datum as { fullLabel?: string }).fullLabel ?? (datum as { name?: string }).name ?? ''),
    },
  }), [sankeyData, palette]);

  return (
    <LogStatsScaffold days={days} onDaysChange={setDays} loading={statsQuery.isLoading} fetching={statsQuery.isFetching}>
        {/* ── 汇总指标卡 ── */}
        <StatGrid style={{ marginBottom: 16 }}>
          <StatCard
            title="总请求数"
            value={summary ? summary.total.toLocaleString() : '—'}
            sub={`近 ${days} 天累计`}
            accent="var(--semi-color-primary)"
            delta={summary && prevSummary ? deltaOf(summary.total, prevSummary.total) : null}
            deltaLabel="较上一周期"
          />
          <StatCard
            title="请求成功率"
            value={successRate == null ? '—' : `${successRate}%`}
            sub={summary ? `成功 ${summary.successCount.toLocaleString()} · 失败 ${summary.failCount.toLocaleString()}` : undefined}
            accent="var(--semi-color-success)"
            delta={successRateDelta}
            deltaLabel="较上一周期"
            deltaFormat="ratio"
          />
          <StatCard title="平均响应时间" value={avgDuration ?? '—'} sub="基于有记录的请求" accent="var(--semi-color-warning)" />
          <StatCard
            title="P95 响应时间"
            value={summary?.p95DurationMs == null ? '—' : formatAvgDuration(summary.p95DurationMs)}
            sub={summary?.p50DurationMs == null ? undefined : `P50 ${formatAvgDuration(summary.p50DurationMs)}`}
            accent="var(--semi-color-warning)"
          />
          <StatCard
            title="P99 响应时间"
            value={summary?.p99DurationMs == null ? '—' : formatAvgDuration(summary.p99DurationMs)}
            sub="长尾请求耗时"
            accent={summary?.p99DurationMs != null && summary.p99DurationMs >= 3000 ? 'var(--semi-color-danger)' : 'var(--semi-color-warning)'}
          />
          <StatCard
            title="活跃用户数"
            value={summary ? summary.uniqueUsers.toLocaleString() : '—'}
            sub="不重复用户账号"
            accent="var(--semi-color-data-2)"
            delta={summary && prevSummary ? deltaOf(summary.uniqueUsers, prevSummary.uniqueUsers) : null}
            deltaLabel="较上一周期"
          />
        </StatGrid>

        {/* ── 模块 Top 10 + 模块分布 + 用户 Top 10 ── */}
        <div className="chart-grid chart-grid--3" style={{ marginBottom: 16 }}>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>按模块操作统计（Top 10）</div>
            {moduleChartData.length === 0 ? (
              <div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>
            ) : (
              <BarChart {...moduleSpec} options={chartOptions} height={260} />
            )}
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>按模块操作分布</div>
            <ModuleOperationPie
              data={stats?.moduleStats ?? []}
              height={260}
              empty={<div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>}
            />
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>Top 10 操作用户</div>
            {userChartData.length === 0 ? (
              <div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>
            ) : (
              <BarChart {...userSpec} options={chartOptions} height={260} />
            )}
          </div>
        </div>

        {/* ── 各模块接口耗时统计 ── */}
        <div className="zx-panel" style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>各模块平均响应时间（取有耗时记录的请求，Top 10）</div>
          {moduleTimingChartData.length === 0 ? (
            <div style={EMPTY_PLACEHOLDER_STYLE}>暂无耗时数据</div>
          ) : (
            <BarChart {...timingSpec} options={chartOptions} height={260} />
          )}
        </div>

        {/* ── HTTP 方法分布 + 小时分布 ── */}
        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>HTTP 方法分布</div>
            {methodChartData.length === 0 ? (
              <div style={{ ...EMPTY_PLACEHOLDER_STYLE, height: 240 }}>暂无数据</div>
            ) : (
              <PieChart {...methodSpec} options={chartOptions} height={240} />
            )}
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>按小时操作分布</div>
            <BarChart {...hourlySpec} options={chartOptions} height={240} />
          </div>
        </div>

        {/* ── 响应状态码分布 + 耗时区间分布 ── */}
        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>响应状态码分布</div>
            {statusClassData.length === 0 ? (
              <div style={{ ...EMPTY_PLACEHOLDER_STYLE, height: 240 }}>暂无数据</div>
            ) : (
              <PieChart {...statusClassSpec} options={chartOptions} height={240} />
            )}
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>耗时区间分布</div>
            {durationHistogramData.length === 0 ? (
              <div style={{ ...EMPTY_PLACEHOLDER_STYLE, height: 240 }}>暂无耗时数据</div>
            ) : (
              <BarChart {...durationHistogramSpec} options={chartOptions} height={240} />
            )}
          </div>
        </div>

        {/* ── 慢接口 Top 10 + 失败热点模块 ── */}
        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>慢接口 Top 10（按平均耗时）</div>
            {slowPathChartData.length === 0 ? (
              <div style={EMPTY_PLACEHOLDER_STYLE}>暂无耗时数据</div>
            ) : (
              <BarChart {...slowPathSpec} options={chartOptions} height={260} />
            )}
          </div>
          <div className="zx-panel">
            <div style={{ ...sectionTitleStyle, color: failModuleChartData.length > 0 ? FAIL_COLOR : sectionTitleStyle.color }}>失败热点模块 Top 10</div>
            {failModuleChartData.length === 0 ? (
              <EmptyChart tone="success" text="该时间段无失败请求" height={260} />
            ) : (
              <BarChart {...failModuleSpec} options={chartOptions} height={260} />
            )}
          </div>
        </div>

        {/* ── 每日操作趋势（成功/失败面积） ── */}
        <div className="zx-panel" style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>每日操作趋势（成功 / 失败）</div>
          <AreaChart {...dailySpec} options={chartOptions} height={210} />
        </div>

        {/* ── 每日请求量与平均耗时 ── */}
        <div className="zx-panel" style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>每日请求量与平均耗时</div>
          {dailyMixedData.length === 0 ? (
            <div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>
          ) : (
            <CommonChart {...dailyMixedSpec} options={chartOptions} height={240} />
          )}
        </div>

        {/* ── 模块操作量占比 + 模块耗时/请求量气泡 ── */}
        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>模块操作量占比</div>
            {treemapData.length === 0 ? (
              <div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>
            ) : (
              <TreemapChart {...treemapSpec} options={chartOptions} height={280} />
            )}
          </div>
          <div className="zx-panel">
            <div style={sectionTitleStyle}>模块耗时 vs 请求量（气泡大小 = 最大耗时）</div>
            {scatterData.length === 0 ? (
              <div style={EMPTY_PLACEHOLDER_STYLE}>暂无耗时数据</div>
            ) : (
              <ScatterChart {...scatterSpec} options={chartOptions} height={280} />
            )}
          </div>
        </div>

        {/* ── 用户 → 模块操作流向 ── */}
        <div className="zx-panel" style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>用户 → 模块操作流向（Top 8 用户 × Top 8 模块）</div>
          {sankeyData.links.length === 0 ? (
            <div style={EMPTY_PLACEHOLDER_STYLE}>暂无数据</div>
          ) : (
            <SankeyChart {...sankeySpec} options={chartOptions} height={320} />
          )}
        </div>

        {/* ── 按星期分布 ── */}
        <div className="zx-panel">
          <div style={sectionTitleStyle}>按星期操作分布（近 {days} 天）</div>
          {!stats ? (
            <EmptyChart height={220} />
          ) : (
            <BarChart {...weekdaySpec} options={chartOptions} height={220} />
          )}
        </div>
    </LogStatsScaffold>
  );
}