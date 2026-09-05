/** 功能使用：按页面 → UI 区域 → 元素聚合的功能热点 treemap + 全局排名分页表 */
import { useEffect, useMemo } from 'react';
import { Card, Select, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { DataBar } from '@/components/data-viz/DataBar';
import { TreemapChart, chartOptions, makeTreemapSpec, useChartPalette, type TreemapNode } from '@/components/charts';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { useAnalyticsFeatureStats } from '@/hooks/queries/analytics';
import type { FeatureStats } from '@zenith/shared/analytics';
import { useBehaviorDays } from './behavior-days-context';
import { CHART_TOP_N, DAYS_OPTIONS, elementDisplayName, numberText, sectionStyle } from './analytics-format';
import { ChartPlaceholder, SectionHeader } from './analytics-shared';

type FeatureStatsRow = FeatureStats['list'][number] & { id: string; rank: number };

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
            name: elementDisplayName(item.elementLabel, item.elementKey),
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

export default function AnalyticsFeatureTab() {
  const palette = useChartPalette();
  const [days, setDays] = useBehaviorDays();
  const { page, pageSize, resetPage, buildPagination } = usePagination();
  const chartQuery = useAnalyticsFeatureStats(days, 1, CHART_TOP_N);
  const featureStatsQuery = useAnalyticsFeatureStats(days, page, pageSize);
  const data = featureStatsQuery.data ?? null;
  const loading = featureStatsQuery.isFetching;

  useEffect(() => { resetPage(); }, [days, resetPage]);

  // 排名是全局序号，不能用当前页下标，否则第 2 页又从 #1 开始
  const rows = useMemo<FeatureStatsRow[]>(() => (data?.list ?? []).map((item, index) => ({
    ...item,
    id: `${item.pagePath}:${item.elementKey}:${index}`,
    rank: (page - 1) * pageSize + index + 1,
  })), [data, page, pageSize]);
  const chartRows = useMemo<FeatureStatsRow[]>(() => (chartQuery.data?.list ?? []).map((item, index) => ({
    ...item,
    id: `${item.pagePath}:${item.elementKey}:${index}`,
    rank: index + 1,
  })), [chartQuery.data]);
  const maxCount = useMemo(() => Math.max(1, ...rows.map((item) => item.count)), [rows]);
  const treemapData = useMemo(() => buildFeatureTreemap(chartRows), [chartRows]);
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
          <Typography.Text strong>{elementDisplayName(record.elementLabel, record.elementKey)}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small">{record.elementKey}</Typography.Text></div>
        </div>
      ),
    },
    { title: 'UI区域', dataIndex: 'componentArea', width: 140, render: (_value, record) => (record.componentArea ? <Tag color="blue">{record.componentArea}</Tag> : <Tag color="grey">未标记</Tag>) },
    { title: '所在页面', dataIndex: 'pagePath', width: 260, render: (value) => <Typography.Text ellipsis={{ showTooltip: true }}>{String(value)}</Typography.Text> },
    {
      title: '使用次数',
      align: 'right',
      dataIndex: 'count',
      width: 240,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{numberText(record.count)}</Typography.Text>
          <DataBar value={record.count} max={maxCount} style={{ marginTop: 6 }} />
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
      <Card title={`功能热点 TOP ${CHART_TOP_N}`} bodyStyle={{ padding: 16 }}>
        {!chartRows.length ? <ChartPlaceholder loading={chartQuery.isFetching} description="暂无功能使用数据" /> : (
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
        pagination={buildPagination(data?.total ?? 0)}
      />
    </div>
  );
}
