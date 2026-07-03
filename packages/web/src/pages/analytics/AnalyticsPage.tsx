import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CSSProperties, ReactNode } from 'react';
import { Avatar, Button, Card, Empty, Input, Progress, Select, SideSheet, Skeleton, Spin, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  Activity,
  BarChart3,
  Clock,
  Eye,
  Flame,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import {
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  chartOptions,
  makeAreaSpec,
  makeBarSpec,
  makeLineSpec,
  makePieSpec,
  makeScatterSpec,
  makeTreemapSpec,
  datumNumber,
  useChartPalette,
  type ChartDatum,
  type TreemapNode,
} from '@/components/charts';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import {
  analyticsKeys,
  useAnalyzeFunnel,
  useAnalyticsDimension,
  useAnalyticsFeatureStats,
  useAnalyticsHeatmap,
  useAnalyticsHeatmapPages,
  useAnalyticsOverview,
  useAnalyticsPageStats,
  useAnalyticsPath,
  useAnalyticsRealtime,
  useAnalyticsRetention,
  useAnalyticsSessions,
  useAnalyticsTrends,
  useAnalyticsUserStats,
  useAnalyticsUserTimeline,
} from '@/hooks/queries/analytics';
import type {
  DimensionBreakdown,
  FeatureStats,
  HeatmapData,
  HeatmapPageListItem,
  PageStats,
  SessionListItem,
  UserStats,
} from '@zenith/shared';

function msToReadable(ms: number | null): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
const DAYS_OPTIONS = [{ label: '近 7 天', value: 7 }, { label: '近 30 天', value: 30 }, { label: '近 90 天', value: 90 }];

const RETENTION_DAYS_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 14 天', value: 14 },
  { label: '近 30 天', value: 30 },
  { label: '近 60 天', value: 60 },
];

const DEVICE_OPTIONS = [
  { label: '全部设备', value: '' },
  { label: '桌面端', value: 'desktop' },
  { label: '移动端', value: 'mobile' },
  { label: '平板', value: 'tablet' },
  { label: '机器人', value: 'bot' },
  { label: '未知', value: 'unknown' },
];

const EMPTY_HEATMAP_PAGES: HeatmapPageListItem[] = [];

const DIMENSION_OPTIONS = [
  { label: '浏览器', value: 'browser' },
  { label: '操作系统', value: 'os' },
  { label: '设备', value: 'device' },
  { label: '地域', value: 'region' },
  { label: '来源', value: 'source' },
  { label: '引荐', value: 'referrer' },
  { label: '页面', value: 'page' },
];

const ACCENT_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b'];

const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 };
const chartGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(320px, 0.9fr)', gap: 16 };

function numberText(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function percentText(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '–';
  return `${value.toFixed(digits)}%`;
}

function DeltaText({ value, suffix = '%' }: Readonly<{ value: number; suffix?: string }>) {
  if (value === 0) return <span style={{ color: 'var(--semi-color-text-2)' }}>持平</span>;
  const positive = value > 0;
  return (
    <span style={{ color: positive ? 'var(--semi-color-success)' : 'var(--semi-color-danger)', fontWeight: 600 }}>
      {positive ? '▲' : '▼'} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  color = 'var(--semi-color-primary)',
}: Readonly<{ icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; color?: string }>) {
  return (
    <Card bodyStyle={{ padding: 16 }} style={{ borderRadius: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
          <div style={{ fontSize: 25, lineHeight: '32px', fontWeight: 700, color: 'var(--semi-color-text-0)' }}>{value}</div>
          {sub ? <div style={{ marginTop: 4, fontSize: 12 }}>{sub}</div> : null}
        </div>
      </div>
    </Card>
  );
}

function SectionHeader({
  title,
  description,
  extra,
}: Readonly<{ title: string; description?: string; extra?: ReactNode }>) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <Typography.Title heading={5} style={{ margin: 0 }}>{title}</Typography.Title>
        {description ? <Typography.Text type="tertiary">{description}</Typography.Text> : null}
      </div>
      {extra}
    </div>
  );
}

function emptyOrSpin(loading: boolean, description = '暂无数据') {
  if (loading) return <div style={{ height: 260, display: 'grid', placeItems: 'center' }}><Spin /></div>;
  return <Empty description={description} />;
}

type ChartRow = Record<string, number | string>;

function chartColor(index: number, primary: string): string {
  return index === 0 ? primary : ACCENT_COLORS[(index - 1) % ACCENT_COLORS.length];
}

function OverviewTab() {
  const palette = useChartPalette();
  const [days, setDays] = useState(7);
  const overviewQuery = useAnalyticsOverview(days);
  const trendsQuery = useAnalyticsTrends(days);
  const overview = overviewQuery.data ?? null;
  const trends = trendsQuery.data ?? null;
  const loading = overviewQuery.isFetching || trendsQuery.isFetching;

  const chartData = useMemo<ChartRow[]>(() => {
    if (!trends) return [];
    return trends.dates.map((date, index) => ({
      date,
      ...Object.fromEntries(trends.series.map((item) => [item.key, item.data[index] ?? 0])),
    }));
  }, [trends]);

  const trendSpec = useMemo(() => makeLineSpec({
    data: chartData,
    xField: 'date',
    series: (trends?.series ?? []).map((item, index) => ({
      field: item.key,
      name: item.name,
      color: index === 0 ? palette.primary : ACCENT_COLORS[(index - 1) % ACCENT_COLORS.length],
    })),
    palette,
  }), [chartData, palette, trends?.series]);

  const cards = overview ? [
    { label: '浏览量 PV', value: numberText(overview.pv), icon: <Eye size={19} />, color: palette.primary, sub: <DeltaText value={overview.pvDelta} /> },
    { label: '访客 UV', value: numberText(overview.uv), icon: <Users size={19} />, color: '#22c55e', sub: <DeltaText value={overview.uvDelta} /> },
    { label: '会话', value: numberText(overview.sessions), icon: <Activity size={19} />, color: '#8b5cf6', sub: <DeltaText value={overview.sessionsDelta} /> },
    { label: '事件', value: numberText(overview.events), icon: <Flame size={19} />, color: '#f59e0b' },
    { label: '新增用户', value: numberText(overview.newUsers), icon: <TrendingUp size={19} />, color: '#ef4444' },
    { label: '平均会话时长', value: msToReadable(overview.avgSessionMs), icon: <Clock size={19} />, color: '#06b6d4' },
    { label: '跳出率', value: percentText(overview.bounceRate), icon: <Target size={19} />, color: '#f97316', sub: <DeltaText value={overview.bounceRateDelta} suffix=" pts" /> },
    { label: '人均页数', value: overview.avgPagesPerSession.toFixed(2), icon: <BarChart3 size={19} />, color: '#84cc16' },
    { label: '实时在线', value: numberText(overview.activeNow), icon: <Zap size={19} />, color: '#ec4899' },
  ] : [];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="行为概览"
        description="关键指标与趋势"
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      {loading && !overview ? (
        <Skeleton
          loading
          active
          placeholder={
            <div style={gridStyle}>
              {Array.from({ length: 9 }, (_, i) => `sk-stat-${i}`).map((key) => (
                <Card key={key} bodyStyle={{ padding: 16 }} style={{ borderRadius: 14 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <Skeleton.Avatar style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Skeleton.Paragraph rows={1} style={{ width: '50%', marginBottom: 8 }} />
                      <Skeleton.Title style={{ width: '70%', marginBottom: 6 }} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          }
        >{null}</Skeleton>
      ) : <div style={gridStyle}>{cards.map((card) => <StatCard key={card.label} {...card} />)}</div>}
      <Card title="访问趋势" bodyStyle={{ padding: 16 }}>
        {chartData.length === 0 ? emptyOrSpin(loading) : (
          <LineChart {...trendSpec} options={chartOptions} height={300} />
        )}
      </Card>
    </div>
  );
}

function RealtimeTab() {
  const palette = useChartPalette();
  const realtimeQuery = useAnalyticsRealtime();
  const data = realtimeQuery.data ?? null;
  const loading = realtimeQuery.isFetching;

  const realtimeAreaSpec = useMemo(() => makeAreaSpec({
    data: data?.perMinute ?? [],
    xField: 'minute',
    series: [{ field: 'events', name: '事件数', color: palette.primary }],
    palette,
  }), [data?.perMinute, palette]);

  return (
    <div style={sectionStyle}>
      <SectionHeader title="实时看板" description="每 10 秒自动刷新" extra={<Button icon={<RefreshCcw size={14} />} onClick={() => void realtimeQuery.refetch()} loading={loading}>刷新</Button>} />
      <div style={gridStyle}>
        <StatCard label="实时在线" value={numberText(data?.activeUsers ?? 0)} icon={<Users size={19} />} color="#22c55e" />
        <StatCard label="近30分钟浏览" value={numberText(data?.pageViewsLast30Min ?? 0)} icon={<Eye size={19} />} color={palette.primary} />
        <StatCard label="近1分钟事件" value={numberText(data?.eventsLastMinute ?? 0)} icon={<Zap size={19} />} color="#f59e0b" />
      </div>
      <div style={chartGridStyle}>
        <Card title="事件脉冲" bodyStyle={{ padding: 16 }}>
          {!data?.perMinute.length ? emptyOrSpin(loading) : (
            <AreaChart {...realtimeAreaSpec} options={chartOptions} height={300} />
          )}
        </Card>
        <Card title="热门在线页面" bodyStyle={{ padding: 16 }}>
          {!data?.topPages.length ? emptyOrSpin(loading, '暂无在线页面') : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.topPages.map((page) => (
                <div key={page.pagePath} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis={{ showTooltip: true }}>{page.pageTitle || page.pagePath}</Typography.Text>
                    <div><Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{page.pagePath}</Typography.Text></div>
                  </div>
                  <Tag color="blue">{page.active} 人</Tag>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card title="最新事件" bodyStyle={{ padding: 16 }}>
        {!data?.recentEvents.length ? emptyOrSpin(loading, '暂无事件') : (
          <div style={{ display: 'grid', gap: 10 }}>
            {data.recentEvents.map((event, index) => (
              <div key={`${event.createdAt}-${index}`} style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr) 140px 170px', gap: 12, alignItems: 'center' }}>
                <Tag color="green">{event.eventType}</Tag>
                <Typography.Text ellipsis={{ showTooltip: true }}>{event.eventName || event.pagePath}</Typography.Text>
                <Typography.Text type="tertiary">{event.username || '匿名访客'}</Typography.Text>
                <Typography.Text type="tertiary">{formatDateTime(event.createdAt)}</Typography.Text>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

type PageStatsRow = PageStats['items'][number] & { id: string };
type MutableTreemapNode = {
  name: string;
  value?: number;
  children?: MutableTreemapNode[];
  [key: string]: unknown;
};

function getRouteSegments(pagePath: string): string[] {
  const parts = pagePath.split('/').filter(Boolean);
  return parts.length ? parts : ['首页'];
}

function addDwellPathNode(nodes: MutableTreemapNode[], segments: string[], row: PageStatsRow) {
  const [current, ...rest] = segments;
  if (!current) return;
  const isLeaf = rest.length === 0;
  const weight = Math.max(1, Math.round((row.avgMs ?? 0) * row.visits));
  const existing = nodes.find((node) => node.name === current);

  if (isLeaf) {
    const pageNode: MutableTreemapNode = {
      name: row.pageTitle || row.pagePath,
      value: weight,
      pagePath: row.pagePath,
      visits: row.visits,
      avgMs: row.avgMs,
      totalMs: weight,
    };
    if (existing) {
      existing.value = (existing.value ?? 0) + weight;
      existing.children = [...(existing.children ?? []), pageNode];
      return;
    }
    nodes.push(pageNode);
    return;
  }

  const branch = existing ?? { name: current, value: 0, children: [] };
  branch.value = (branch.value ?? 0) + weight;
  branch.children ??= [];
  if (!existing) nodes.push(branch);
  addDwellPathNode(branch.children, rest, row);
}

function sortTreemapNodes(nodes: TreemapNode[]): TreemapNode[] {
  return nodes
    .map((node) => ({ ...node, children: node.children ? sortTreemapNodes(node.children) : undefined }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

function buildDwellTreemap(rows: readonly PageStatsRow[]): TreemapNode {
  const children: MutableTreemapNode[] = [];
  for (const row of rows) {
    addDwellPathNode(children, getRouteSegments(row.pagePath), row);
  }
  return { name: '页面停留', children: sortTreemapNodes(children) };
}

function DwellTab() {
  const palette = useChartPalette();
  const [days, setDays] = useState(7);
  const pageStatsQuery = useAnalyticsPageStats(days);
  const data = pageStatsQuery.data ?? null;
  const loading = pageStatsQuery.isFetching;

  const rows = useMemo<PageStatsRow[]>(() => (data?.items ?? []).map((item) => ({ ...item, id: item.pagePath })), [data]);
  const maxAvg = useMemo(() => Math.max(1, ...rows.map((item) => item.avgMs ?? 0)), [rows]);
  const avgDwell = data?.avgDwellMs ?? null;
  const dwellTreemapData = useMemo(() => buildDwellTreemap(rows), [rows]);
  const dwellTreemapSpec = useMemo(() => makeTreemapSpec({
    data: dwellTreemapData,
    palette,
    valueFormatter: msToReadable,
    tooltipItems: [
      { key: '总停留', value: (datum) => msToReadable(datumNumber(datum, 'totalMs') || datumNumber(datum, 'value')) },
      { key: '访问次数', value: (datum) => numberText(datumNumber(datum, 'visits')) },
      { key: '平均停留', value: (datum) => msToReadable(datumNumber(datum, 'avgMs')) },
    ],
  }), [dwellTreemapData, palette]);

  const columns: ColumnProps<PageStatsRow>[] = [
    {
      title: '页面',
      dataIndex: 'pagePath',
      width: 320,
      render: (_value, record) => (
        <div>
          <Typography.Text strong ellipsis={{ showTooltip: true }}>{record.pageTitle || record.pagePath}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{record.pagePath}</Typography.Text></div>
        </div>
      ),
    },
    { title: '访问次数', dataIndex: 'visits', width: 120, render: (value) => numberText(Number(value)) },
    {
      title: '平均停留',
      dataIndex: 'avgMs',
      width: 220,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{msToReadable(record.avgMs)}</Typography.Text>
          <Progress percent={Math.min(100, ((record.avgMs ?? 0) / maxAvg) * 100)} showInfo={false} style={{ marginTop: 6 }} />
        </div>
      ),
    },
    { title: '中位数', dataIndex: 'medianMs', width: 120, render: (_value, record) => msToReadable(record.medianMs) },
    { title: 'P90', dataIndex: 'p90Ms', width: 120, render: (_value, record) => msToReadable(record.p90Ms) },
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="页面停留"
        description="页面访问深度与停留分布"
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <div style={gridStyle}>
        <StatCard label="总访问" value={numberText(data?.totalVisits ?? 0)} icon={<Eye size={19} />} color={palette.primary} />
        <StatCard label="统计页面" value={numberText(rows.length)} icon={<BarChart3 size={19} />} color="#8b5cf6" />
        <StatCard label="平均停留" value={msToReadable(avgDwell)} icon={<Clock size={19} />} color="#06b6d4" />
      </div>
      <Card title="页面停留热区" bodyStyle={{ padding: 16 }}>
        {!rows.length ? emptyOrSpin(loading, '暂无页面停留数据') : (
          <TreemapChart {...dwellTreemapSpec} options={chartOptions} height={360} />
        )}
      </Card>
      <ConfigurableTable<PageStatsRow>
        bordered
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowKey="id"
        onRefresh={() => void pageStatsQuery.refetch()}
        refreshLoading={loading}
        pagination={false}
      />
    </div>
  );
}

type FeatureStatsRow = FeatureStats['items'][number] & { id: string; rank: number };

function getFeaturePageLabel(pagePath: string): string {
  if (pagePath === '/') return '首页';
  return pagePath;
}

function buildFeatureTreemap(rows: readonly FeatureStatsRow[]): TreemapNode {
  const pageMap = new Map<string, Map<string, FeatureStatsRow[]>>();

  for (const row of rows) {
    const area = row.componentArea || '未标记区域';
    const areaMap = pageMap.get(row.pagePath) ?? new Map<string, FeatureStatsRow[]>();
    const items = areaMap.get(area) ?? [];
    items.push(row);
    areaMap.set(area, items);
    pageMap.set(row.pagePath, areaMap);
  }

  const children = [...pageMap.entries()]
    .map(([pagePath, areaMap]) => {
      const areaChildren = [...areaMap.entries()]
        .reduce<TreemapNode[]>((result, [area, items]) => {
          const children = items.map((item) => ({
            name: item.elementLabel || item.elementKey,
            value: item.count,
            pagePath: item.pagePath,
            componentArea: item.componentArea,
            elementKey: item.elementKey,
          }));
          const value = items.reduce((sum, item) => sum + item.count, 0);

          if (area === '未标记区域') return result.concat(children);
          return result.concat({ name: area, value, children });
        }, [])
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      return {
        name: getFeaturePageLabel(pagePath),
        value: areaChildren.reduce((sum, item) => sum + (item.value ?? 0), 0),
        pagePath,
        children: areaChildren,
      };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return { name: '功能使用', children };
}

function FeatureTab() {
  const palette = useChartPalette();
  const [days, setDays] = useState(7);
  const featureStatsQuery = useAnalyticsFeatureStats(days);
  const data = featureStatsQuery.data ?? null;
  const loading = featureStatsQuery.isFetching;

  const rows = useMemo<FeatureStatsRow[]>(() => (data?.items ?? []).map((item, index) => ({
    ...item,
    id: `${item.pagePath}:${item.elementKey}:${index}`,
    rank: index + 1,
  })), [data]);
  const maxCount = useMemo(() => Math.max(1, ...rows.map((item) => item.count)), [rows]);
  const treemapData = useMemo(() => buildFeatureTreemap(rows), [rows]);
  const treemapSpec = useMemo(() => makeTreemapSpec({
    data: treemapData,
    palette,
    valueFormatter: numberText,
  }), [palette, treemapData]);

  const columns: ColumnProps<FeatureStatsRow>[] = [
    { title: '排名', dataIndex: 'rank', width: 90, render: (value) => <Tag color={Number(value) <= 3 ? 'orange' : 'grey'}>#{String(value)}</Tag> },
    {
      title: '功能',
      dataIndex: 'elementKey',
      width: 260,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{record.elementLabel || record.elementKey}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small">{record.elementKey}</Typography.Text></div>
        </div>
      ),
    },
    { title: 'UI区域', dataIndex: 'componentArea', width: 140, render: (_value, record) => <Tag color="blue">{record.componentArea || '未标记'}</Tag> },
    { title: '所在页面', dataIndex: 'pagePath', width: 260, render: (value) => <Typography.Text ellipsis={{ showTooltip: true }}>{String(value)}</Typography.Text> },
    {
      title: '使用次数',
      dataIndex: 'count',
      width: 240,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{numberText(record.count)}</Typography.Text>
          <Progress percent={(record.count / maxCount) * 100} showInfo={false} style={{ marginTop: 6 }} />
        </div>
      ),
    },
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="功能使用"
        description={`总事件 ${numberText(data?.totalEvents ?? 0)}`}
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <Card title="功能热点" bodyStyle={{ padding: 16 }}>
        {!rows.length ? emptyOrSpin(loading, '暂无功能使用数据') : (
          <TreemapChart {...treemapSpec} options={chartOptions} height={360} />
        )}
      </Card>
      <ConfigurableTable<FeatureStatsRow>
        bordered
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowKey="id"
        onRefresh={() => void featureStatsQuery.refetch()}
        refreshLoading={loading}
        pagination={false}
      />
    </div>
  );
}

type DeviceFilter = '' | 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';

function SessionsTab() {
  const queryClient = useQueryClient();
  const [usernameInput, setUsernameInput] = useState('');
  const [deviceInput, setDeviceInput] = useState<DeviceFilter>('');
  const [filters, setFilters] = useState({ username: '', deviceType: '' as DeviceFilter });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sessionsQuery = useAnalyticsSessions({
    page,
    pageSize,
    username: filters.username || undefined,
    deviceType: filters.deviceType || undefined,
  });
  const data = sessionsQuery.data ?? { list: [], total: 0, page: 1, pageSize: 20 };

  const handleSearch = () => {
    setPage(1);
    setFilters({ username: usernameInput.trim(), deviceType: deviceInput });
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.sessionsLists });
  };

  const handleReset = () => {
    setUsernameInput('');
    setDeviceInput('');
    setPage(1);
    setFilters({ username: '', deviceType: '' });
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.sessionsLists });
  };

  const columns: ColumnProps<SessionListItem>[] = [
    { title: '用户', dataIndex: 'username', width: 150, render: (_value, record) => record.username || (record.userId == null ? '匿名访客' : `用户 #${record.userId}`) },
    { title: '入口页', dataIndex: 'entryPage', width: 200, render: (_value, record) => <Typography.Text ellipsis={{ showTooltip: true }}>{record.entryPage || '–'}</Typography.Text> },
    { title: '出口页', dataIndex: 'exitPage', width: 200, render: (_value, record) => <Typography.Text ellipsis={{ showTooltip: true }}>{record.exitPage || '–'}</Typography.Text> },
    { title: '页数', dataIndex: 'pageCount', width: 90 },
    { title: '事件', dataIndex: 'eventCount', width: 90 },
    { title: '时长', dataIndex: 'durationMs', width: 120, render: (_value, record) => msToReadable(record.durationMs) },
    {
      title: '设备 / 浏览器 / 系统',
      dataIndex: 'deviceType',
      width: 230,
      render: (_value, record) => (
        <div>
          <Tag color="blue">{record.deviceType || 'unknown'}</Tag>
          <Typography.Text size="small" type="tertiary"> {record.browser || '–'} / {record.os || '–'}</Typography.Text>
        </div>
      ),
    },
    { title: '地域', dataIndex: 'region', width: 120, render: (_value, record) => record.region || '–' },
    { title: '跳出', dataIndex: 'isBounce', width: 90, render: (_value, record) => <Tag color={record.isBounce ? 'red' : 'green'}>{record.isBounce ? '是' : '否'}</Tag> },
    { title: '开始时间', dataIndex: 'startedAt', width: 180, render: (_value, record) => formatDateTime(record.startedAt), fixed: 'right' },
  ];

  const renderUsernameSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="用户名"
      value={usernameInput}
      showClear
      onChange={setUsernameInput}
      onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
      style={{ width: 200 }}
    />
  );
  const renderDeviceFilter = () => (
    <Select
      value={deviceInput}
      optionList={DEVICE_OPTIONS}
      onChange={(v) => setDeviceInput(String(v ?? '') as DeviceFilter)}
      style={{ width: 150 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;

  return (
    <div style={sectionStyle}>
      <SearchToolbar
        primary={(
          <>
            {renderUsernameSearch()}
            {renderDeviceFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderUsernameSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={renderDeviceFilter()}
        filterTitle="会话筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable<SessionListItem>
        bordered
        columns={columns}
        dataSource={data.list}
        loading={sessionsQuery.isFetching}
        rowKey="id"
        onRefresh={() => void sessionsQuery.refetch()}
        refreshLoading={sessionsQuery.isFetching}
        pagination={{
          currentPage: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />
    </div>
  );
}

interface FunnelStepDraft {
  id: string;
  label: string;
  pagePath?: string;
  eventName?: string;
}

function FunnelTab() {
  const palette = useChartPalette();
  const [days, setDays] = useState(7);
  const [steps, setSteps] = useState<FunnelStepDraft[]>([
    { id: 'step-1', label: '进入首页', pagePath: '/' },
    { id: 'step-2', label: '进入仪表盘', pagePath: '/dashboard' },
  ]);
  const analyzeMutation = useAnalyzeFunnel();
  const result = analyzeMutation.data ?? null;
  const loading = analyzeMutation.isPending;

  const updateStep = (id: string, patch: Partial<Omit<FunnelStepDraft, 'id'>>) => {
    setSteps((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addStep = () => {
    setSteps((prev) => [...prev, { id: `step-${Date.now()}`, label: `步骤 ${prev.length + 1}`, eventName: '' }]);
  };

  const removeStep = (id: string) => {
    setSteps((prev) => (prev.length <= 2 ? prev : prev.filter((item) => item.id !== id)));
  };

  const funnelChartData = useMemo(() => (result?.steps ?? []).map((step, index) => ({
    ...step,
    __fill: chartColor(index, palette.primary),
  })), [palette.primary, result?.steps]);

  const funnelBarSpec = useMemo(() => makeBarSpec({
    data: funnelChartData,
    xField: 'label',
    series: [{ field: 'conversionRate', name: '总转化率', color: palette.primary }],
    palette,
    horizontal: true,
    categoryAxisWidth: 96,
    colorByDatum: (datum) => String(datum?.__fill ?? palette.primary),
    tooltip: { value: (value) => `${Number(value).toFixed(1)}%` },
    axis: { yLabel: (value) => `${value}%` },
  }), [funnelChartData, palette]);

  const analyze = async () => {
    await analyzeMutation.mutateAsync({
      days,
      steps: steps.map(({ label, pagePath, eventName }) => ({
        label: label.trim(),
        pagePath: pagePath?.trim() || undefined,
        eventName: eventName?.trim() || undefined,
      })),
    });
  };

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="转化漏斗"
        description="组合页面与事件步骤，分析用户转化"
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <Card bodyStyle={{ padding: 16 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          {steps.map((step, index) => (
            <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '48px minmax(140px, 1fr) minmax(160px, 1fr) minmax(160px, 1fr) 36px', gap: 10, alignItems: 'center' }}>
              <Tag color="blue">#{index + 1}</Tag>
              <Input placeholder="步骤名称" value={step.label} onChange={(value) => updateStep(step.id, { label: value })} />
              <Input placeholder="页面路径（可选）" value={step.pagePath ?? ''} onChange={(value) => updateStep(step.id, { pagePath: value })} />
              <Input placeholder="事件名（可选）" value={step.eventName ?? ''} onChange={(value) => updateStep(step.id, { eventName: value })} />
              <Button icon={<Trash2 size={14} />} type="danger" theme="borderless" disabled={steps.length <= 2} onClick={() => removeStep(step.id)} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button icon={<Plus size={14} />} onClick={addStep}>添加步骤</Button>
          <Button type="primary" icon={<Target size={14} />} loading={loading} disabled={steps.length < 2} onClick={() => void analyze()}>分析</Button>
        </div>
      </Card>
      <Card title="漏斗结果" bodyStyle={{ padding: 16 }}>
        {!result ? emptyOrSpin(loading, '请配置步骤后点击分析') : (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Tag color="blue">总用户 {numberText(result.totalUsers)}</Tag>
              <Tag color="green">整体转化 {percentText(result.overallConversionRate)}</Tag>
            </div>
            <BarChart {...funnelBarSpec} options={chartOptions} height={300} />
            {result.steps.map((step, index) => (
              <div key={`${step.label}-${index}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <Typography.Text strong>{step.label}</Typography.Text>
                  <Typography.Text>{numberText(step.users)} 人 · 总转化 {percentText(step.conversionRate)} · 上步转化 {percentText(step.stepConversionRate)} · 流失 {numberText(step.dropoff)}</Typography.Text>
                </div>
                <div style={{ height: 20, borderRadius: 999, background: 'var(--semi-color-fill-0)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, Math.min(100, step.conversionRate))}%`, height: '100%', borderRadius: 999, background: chartColor(index, palette.primary) }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function RetentionTab() {
  const [days, setDays] = useState(14);
  const retentionQuery = useAnalyticsRetention(days);
  const data = retentionQuery.data ?? null;
  const loading = retentionQuery.isFetching;

  const periodMax = data ? Math.max(1, ...data.cohorts.flatMap((c) => c.values.filter((v): v is number => v != null))) : 100;

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="用户留存"
        description="按首访日期形成 cohort，单元格颜色越深表示留存率越高"
        extra={<Select value={days} optionList={RETENTION_DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <Card bodyStyle={{ padding: 16, overflowX: 'auto' }}>
        {loading && !data ? emptyOrSpin(true) : !data?.cohorts.length ? <Empty description="暂无留存数据" /> : (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px 8px 10px', fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: 500, width: '1%', whiteSpace: 'nowrap' }}>同期群</th>
                <th style={{ textAlign: 'right', padding: '8px 14px 8px 10px', fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: 500, width: '1%', whiteSpace: 'nowrap' }}>人数</th>
                {data.periods.map((period) => <th key={period} style={{ textAlign: 'center', padding: '8px 6px', fontSize: 12, color: 'var(--semi-color-text-2)', fontWeight: 500 }}>Day{period}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((cohort) => (
                <tr key={cohort.cohortDate}>
                  <td style={{ padding: '8px 12px 8px 10px', fontWeight: 600, whiteSpace: 'nowrap', width: '1%' }}>{cohort.cohortDate}</td>
                  <td style={{ padding: '8px 14px 8px 10px', textAlign: 'right', color: 'var(--semi-color-text-1)', whiteSpace: 'nowrap', width: '1%' }}>{numberText(cohort.cohortSize)}</td>
                  {data.periods.map((period, index) => {
                    const value = cohort.values[index];
                    const ratio = value == null ? 0 : Math.min(1, value / periodMax);
                    const opacity = value == null ? 0 : 0.12 + ratio * 0.73;
                    return (
                      <td
                        key={period}
                        style={{
                          textAlign: 'center',
                          padding: '8px 6px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontVariantNumeric: 'tabular-nums',
                          background: value == null ? 'transparent' : `color-mix(in srgb, var(--semi-color-primary) ${Math.round(opacity * 100)}%, transparent)`,
                          color: value == null ? 'var(--semi-color-text-3)' : ratio > 0.55 ? '#ffffff' : 'var(--semi-color-text-0)',
                        }}
                      >
                        {value == null ? '·' : `${value.toFixed(1)}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function PathTab() {
  const palette = useChartPalette();
  const [days, setDays] = useState(7);
  const pathQuery = useAnalyticsPath(days);
  const data = pathQuery.data ?? null;
  const loading = pathQuery.isFetching;

  const nodeLabelMap = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node.label])), [data]);
  const links = useMemo(() => [...(data?.links ?? [])].sort((a, b) => b.value - a.value), [data]);
  const maxValue = Math.max(1, ...links.map((link) => link.value));

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="页面跳转路径"
        description="按跳转次数排序的路径流"
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <Card bodyStyle={{ padding: 16 }}>
        {!links.length ? emptyOrSpin(loading, '暂无路径数据') : (
          <div style={{ display: 'grid', gap: 14 }}>
            {links.map((link, index) => (
              <div key={`${link.source}-${link.target}-${index}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <Typography.Text strong ellipsis={{ showTooltip: true }}>
                    {nodeLabelMap.get(link.source) ?? link.source} → {nodeLabelMap.get(link.target) ?? link.target}
                  </Typography.Text>
                  <Typography.Text>{numberText(link.value)} 次</Typography.Text>
                </div>
                <div style={{ height: 12, borderRadius: 999, background: 'var(--semi-color-fill-0)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(3, (link.value / maxValue) * 100)}%`, height: '100%', borderRadius: 999, background: chartColor(index, palette.primary) }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

type UserStatsRow = UserStats['items'][number] & { id: string; rank: number };

function UsersTab() {
  const [days, setDays] = useState(7);
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [timelineUserId, setTimelineUserId] = useState<number | null>(null);
  const userStatsQuery = useAnalyticsUserStats(days);
  const timelineQuery = useAnalyticsUserTimeline(timelineUserId, timelineVisible);
  const data = userStatsQuery.data ?? null;
  const loading = userStatsQuery.isFetching;
  const timeline = timelineQuery.data ?? null;
  const timelineLoading = timelineQuery.isFetching;

  const rows = useMemo<UserStatsRow[]>(() => (data?.items ?? []).map((item, index) => ({
    ...item,
    id: item.userId == null ? `anonymous-${index}` : String(item.userId),
    rank: index + 1,
  })), [data]);
  const maxEvents = Math.max(1, ...rows.map((item) => item.totalEvents));

  const openTimeline = (record: UserStatsRow) => {
    if (record.userId == null) return;
    setTimelineUserId(record.userId);
    setTimelineVisible(true);
  };

  const columns: ColumnProps<UserStatsRow>[] = [
    {
      title: '用户',
      dataIndex: 'username',
      width: 210,
      render: (_value, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar size="small" color={record.userId == null ? 'grey' : 'blue'}>{(record.username || '访').slice(0, 1).toUpperCase()}</Avatar>
          <div>
            <Typography.Text strong>{record.username || (record.userId == null ? '匿名访客' : `用户 #${record.userId}`)}</Typography.Text>
            <div><Typography.Text type="tertiary" size="small">#{record.rank}</Typography.Text></div>
          </div>
        </div>
      ),
    },
    {
      title: '总操作',
      dataIndex: 'totalEvents',
      width: 220,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{numberText(record.totalEvents)}</Typography.Text>
          <Progress percent={(record.totalEvents / maxEvents) * 100} showInfo={false} style={{ marginTop: 6 }} />
        </div>
      ),
    },
    { title: '页面访问', dataIndex: 'pageViews', width: 110 },
    { title: '访问页面数', dataIndex: 'uniquePages', width: 120 },
    { title: '功能使用', dataIndex: 'featureUses', width: 110 },
    { title: '总停留', dataIndex: 'totalDwellMs', width: 130, render: (_value, record) => msToReadable(record.totalDwellMs) },
    { title: '最近活跃', dataIndex: 'lastActiveAt', width: 180, render: (_value, record) => (record.lastActiveAt ? formatDateTime(record.lastActiveAt) : '–'), fixed: 'right' },
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="用户分析"
        description={`覆盖用户 ${numberText(data?.totalUsers ?? 0)}`}
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <ConfigurableTable<UserStatsRow>
        bordered
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowKey="id"
        onRefresh={() => void userStatsQuery.refetch()}
        refreshLoading={loading}
        pagination={false}
        onRow={(record) => ({
          onClick: () => { if (record) openTimeline(record); },
          style: { cursor: record?.userId == null ? 'default' : 'pointer' },
        })}
      />
      <SideSheet
        title="用户行为时间线"
        visible={timelineVisible}
        width={560}
        onCancel={() => setTimelineVisible(false)}
      >
        <Spin spinning={timelineLoading}>
          {!timeline ? <Empty description="暂无时间线" /> : (
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <Typography.Title heading={5} style={{ margin: 0 }}>{timeline.username || `用户 #${timeline.userId}`}</Typography.Title>
                <Typography.Text type="tertiary">
                  共 {numberText(timeline.totalEvents)} 次行为 · {timeline.firstSeenAt ? formatDateTime(timeline.firstSeenAt) : '–'} 至 {timeline.lastSeenAt ? formatDateTime(timeline.lastSeenAt) : '–'}
                </Typography.Text>
              </div>
              {timeline.items.map((item) => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 12, position: 'relative' }}>
                  <Typography.Text type="tertiary" size="small">{formatDateTime(item.createdAt)}</Typography.Text>
                  <div>
                    <Tag color="blue">{item.eventType}</Tag>
                    <Typography.Text strong style={{ marginLeft: 8 }}>{item.eventName || item.elementLabel || item.pageTitle || item.pagePath}</Typography.Text>
                    <div><Typography.Text type="tertiary" size="small">{item.componentArea || '页面'} · {item.pagePath} · {msToReadable(item.durationMs)}</Typography.Text></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}

type DimensionRow = DimensionBreakdown['items'][number] & { id: string };

function DimensionTab() {
  const palette = useChartPalette();
  const [days, setDays] = useState(7);
  const [dimension, setDimension] = useState('browser');
  const dimensionQuery = useAnalyticsDimension(dimension, days);
  const data = dimensionQuery.data ?? null;
  const loading = dimensionQuery.isFetching;

  const rows = useMemo<DimensionRow[]>(() => (data?.items ?? []).map((item) => ({ ...item, id: item.name })), [data]);
  const dimensionPieSpec = useMemo(() => makePieSpec({
    data: rows,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: rows.map((_, index) => chartColor(index, palette.primary)),
    palette,
  }), [palette, rows]);
  const columns: ColumnProps<DimensionRow>[] = [
    { title: '名称', dataIndex: 'name', render: (value) => <Typography.Text ellipsis={{ showTooltip: true }}>{String(value)}</Typography.Text> },
    { title: '数量', dataIndex: 'value', width: 120, render: (value) => numberText(Number(value)) },
    { title: '占比', dataIndex: 'percent', width: 120, render: (value) => percentText(Number(value)) },
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="维度分布"
        description={`总计 ${numberText(data?.total ?? 0)}`}
        extra={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Select value={dimension} optionList={DIMENSION_OPTIONS} onChange={(v) => setDimension(String(v))} style={{ width: 130 }} />
            <Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />
          </div>
        )}
      />
      <div style={chartGridStyle}>
        <Card title="占比" bodyStyle={{ padding: 16 }}>
          {!rows.length ? emptyOrSpin(loading) : (
            <PieChart {...dimensionPieSpec} options={chartOptions} height={300} />
          )}
        </Card>
        <ConfigurableTable<DimensionRow>
          bordered
          columns={columns}
          dataSource={rows}
          loading={loading}
          rowKey="id"
          onRefresh={() => void dimensionQuery.refetch()}
          refreshLoading={loading}
          pagination={false}
        />
      </div>
    </div>
  );
}

function ClickScatter({ data }: Readonly<{ data: HeatmapData }>) {
  const palette = useChartPalette();
  const spec = useMemo(() => {
    const maxValue = Math.max(1, ...data.points.map((point) => point.value));
    const intensity = (datum: ChartDatum) => Math.max(0.12, Math.min(1, datumNumber(datum, 'value') / maxValue));
    const heatColor = (t: number) => {
      if (t >= 0.75) return '#ef4444';
      if (t >= 0.5) return '#f97316';
      if (t >= 0.25) return '#f59e0b';
      return '#fbbf24';
    };
    return makeScatterSpec({
      data: data.points,
      dataId: 'clicks',
      xField: 'x',
      yField: 'y',
      palette,
      padding: { top: 12, right: 16, bottom: 28, left: 36 },
      xAxis: { min: 0, max: 100, label: (value) => `${value}%` },
      yAxis: { min: 0, max: 100, inverse: true, label: (value) => `${value}%` },
      point: {
        size: (datum) => 8 + 34 * intensity(datum),
        fill: (datum) => heatColor(intensity(datum)),
        fillOpacity: 0.5,
        stroke: palette.bg1,
        lineWidth: 1,
      },
      tooltip: {
        title: (datum) => `位置 (${datumNumber(datum, 'x')}%, ${datumNumber(datum, 'y')}%)`,
        items: [{ key: '点击', value: (datum) => `${datumNumber(datum, 'value')} 次` }],
      },
    });
  }, [data, palette]);

  return <ScatterChart {...spec} options={chartOptions} height={360} />;
}

function HeatmapTab() {
  const [days, setDays] = useState(7);
  const [pagePath, setPagePath] = useState('');
  const [componentArea, setComponentArea] = useState('');
  const pagesQuery = useAnalyticsHeatmapPages(days);
  const pages = pagesQuery.data?.pages ?? EMPTY_HEATMAP_PAGES;
  const heatmapQuery = useAnalyticsHeatmap(pagePath, componentArea, days);
  const data = heatmapQuery.data ?? null;
  const pagesLoading = pagesQuery.isFetching;
  const loading = heatmapQuery.isFetching;

  useEffect(() => {
    const nextPage = pages.find((item) => item.pagePath === pagePath) ?? pages[0];
    setPagePath(nextPage?.pagePath ?? '');
    setComponentArea((prev) => (nextPage?.areas.includes(prev) ? prev : nextPage?.areas[0] ?? ''));
  }, [pages, pagePath]);

  const selectedPage = useMemo(() => pages.find((item) => item.pagePath === pagePath), [pagePath, pages]);
  const pageOptions = useMemo(() => pages.map((item) => ({ label: item.pageTitle ? `${item.pageTitle} · ${item.pagePath}` : item.pagePath, value: item.pagePath })), [pages]);
  const areaOptions = useMemo(() => (selectedPage?.areas ?? []).map((area) => ({ label: area, value: area })), [selectedPage]);

  useEffect(() => {
    if (!selectedPage) return;
    if (!selectedPage.areas.includes(componentArea)) setComponentArea(selectedPage.areas[0] ?? '');
  }, [componentArea, selectedPage]);

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="点击分布"
        description="页面区域点击落点分布"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />
            <Select placeholder="选择页面" value={pagePath || undefined} optionList={pageOptions} loading={pagesLoading} onChange={(v) => setPagePath(String(v ?? ''))} style={{ width: 280 }} />
            <Select placeholder="选择区域" value={componentArea || undefined} optionList={areaOptions} onChange={(v) => setComponentArea(String(v ?? ''))} style={{ width: 180 }} />
          </div>
        )}
      />
      <Card bodyStyle={{ padding: 16 }}>
        <Spin spinning={loading}>
          {!data?.points.length ? <Empty description="暂无点击数据" /> : (
            <div>
              <ClickScatter data={data} />
              <Typography.Text type="tertiary" style={{ display: 'block', marginTop: 10 }}>
                {numberText(data.total)} 次点击 · {data.pagePath} · {data.componentArea}
              </Typography.Text>
            </div>
          )}
        </Spin>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" lazyRender>
        <TabPane tab="概览" itemKey="overview"><OverviewTab /></TabPane>
        <TabPane tab="实时" itemKey="realtime"><RealtimeTab /></TabPane>
        <TabPane tab="页面停留" itemKey="dwell"><DwellTab /></TabPane>
        <TabPane tab="功能使用" itemKey="feature"><FeatureTab /></TabPane>
        <TabPane tab="会话" itemKey="sessions"><SessionsTab /></TabPane>
        <TabPane tab="漏斗" itemKey="funnel"><FunnelTab /></TabPane>
        <TabPane tab="留存" itemKey="retention"><RetentionTab /></TabPane>
        <TabPane tab="路径" itemKey="path"><PathTab /></TabPane>
        <TabPane tab="用户分析" itemKey="users"><UsersTab /></TabPane>
        <TabPane tab="维度分布" itemKey="dimension"><DimensionTab /></TabPane>
        <TabPane tab="点击分布" itemKey="heatmap"><HeatmapTab /></TabPane>
      </Tabs>
    </div>
  );
}
