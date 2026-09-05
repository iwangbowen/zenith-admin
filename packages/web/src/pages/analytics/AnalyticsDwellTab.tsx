/** 页面停留：访问深度与停留分布（treemap 热区 TOP N + 分页明细表） */
import { useEffect, useMemo } from 'react';
import { Card, Select, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { BarChart3, Clock, Eye } from 'lucide-react';
import { DataBar } from '@/components/data-viz/DataBar';
import { TreemapChart, chartOptions, makeTreemapSpec, datumNumber, useChartPalette, StatCard, StatGrid, type TreemapNode } from '@/components/charts';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { useAnalyticsPageStats } from '@/hooks/queries/analytics';
import type { PageStats } from '@zenith/shared/analytics';
import { useBehaviorDays } from './behavior-days-context';
import { CHART_TOP_N, DAYS_OPTIONS, getRouteSegments, msToReadable, numberText, sectionStyle } from './analytics-format';
import { ChartPlaceholder, SectionHeader } from './analytics-shared';

type PageStatsRow = PageStats['list'][number] & { id: string };
type MutableTreemapNode = {
  name: string;
  value?: number;
  children?: MutableTreemapNode[];
  [key: string]: unknown;
};

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

export default function AnalyticsDwellTab() {
  const palette = useChartPalette();
  const [days, setDays] = useBehaviorDays();
  const { page, pageSize, resetPage, buildPagination } = usePagination();
  // 图表固定订阅第 1 页：它是 TOP N 概览，不能跟着表格翻页；
  // 表格停在第 1 页且页长相同时，TanStack 会把两个查询去重成一个请求
  const chartQuery = useAnalyticsPageStats(days, 1, CHART_TOP_N);
  const pageStatsQuery = useAnalyticsPageStats(days, page, pageSize);
  const data = pageStatsQuery.data ?? null;
  const loading = pageStatsQuery.isFetching;

  useEffect(() => { resetPage(); }, [days, resetPage]);

  const rows = useMemo<PageStatsRow[]>(() => (data?.list ?? []).map((item) => ({ ...item, id: item.pagePath })), [data]);
  const chartRows = useMemo<PageStatsRow[]>(
    () => (chartQuery.data?.list ?? []).map((item) => ({ ...item, id: item.pagePath })),
    [chartQuery.data],
  );
  const maxAvg = useMemo(() => Math.max(1, ...rows.map((item) => item.avgMs ?? 0)), [rows]);
  const avgDwell = data?.avgDwellMs ?? null;
  const dwellTreemapData = useMemo(() => buildDwellTreemap(chartRows), [chartRows]);
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
    { title: '访问次数', dataIndex: 'visits', width: 120, align: 'right', render: (value) => numberText(Number(value)) },
    {
      title: '平均停留',
      align: 'right',
      dataIndex: 'avgMs',
      width: 220,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{msToReadable(record.avgMs)}</Typography.Text>
          <DataBar value={record.avgMs ?? 0} max={maxAvg} style={{ marginTop: 6 }} />
        </div>
      ),
    },
    { title: '中位数', dataIndex: 'medianMs', width: 120, align: 'right', render: (_value, record) => msToReadable(record.medianMs) },
    { title: 'P90', dataIndex: 'p90Ms', width: 120, align: 'right', render: (_value, record) => msToReadable(record.p90Ms) },
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="页面停留"
        description="页面访问深度与停留分布"
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <StatGrid minItemWidth={190}>
        <StatCard title="总访问" value={numberText(data?.totalVisits ?? 0)} icon={<Eye size={19} />} accent={palette.primary} />
        <StatCard title="统计页面" value={numberText(data?.total ?? 0)} icon={<BarChart3 size={19} />} accent="#8b5cf6" />
        <StatCard title="平均停留" value={msToReadable(avgDwell)} icon={<Clock size={19} />} accent="#06b6d4" />
      </StatGrid>
      <Card title={`页面停留热区 TOP ${CHART_TOP_N}`} bodyStyle={{ padding: 16 }}>
        {!chartRows.length ? <ChartPlaceholder loading={chartQuery.isFetching} description="暂无页面停留数据" /> : (
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
        pagination={buildPagination(data?.total ?? 0)}
      />
    </div>
  );
}
