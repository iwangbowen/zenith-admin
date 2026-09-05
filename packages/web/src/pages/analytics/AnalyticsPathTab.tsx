/** 页面跳转路径：会话内相邻跳转的桑基图 + 本地分页的跳转明细（回流链路单独标出） */
import { useEffect, useMemo, useState } from 'react';
import { Card, Input, Select, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity, BarChart3, RefreshCcw, Search } from 'lucide-react';
import { DataBar } from '@/components/data-viz/DataBar';
import { SankeyChart, chartOptions, makeSankeySpec, datumNumber, datumText, useChartPalette, StatCard, StatGrid } from '@/components/charts';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { renderEllipsis } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useAnalyticsPath } from '@/hooks/queries/analytics';
import type { PathLink } from '@zenith/shared/analytics';
import { ANALYTICS_PATH_EXIT_PAGE } from '@zenith/shared/analytics';
import { SearchButton } from '@/components/toolbar-controls';
import { useBehaviorDays } from './behavior-days-context';
import { DAYS_OPTIONS, chartColor, getRouteSegments, numberText, sectionStyle } from './analytics-format';
import { ChartPlaceholder, SectionHeader } from './analytics-shared';

const PATH_EXIT_COLOR = '#94a3b8';

function pathNodeText(label: string): string {
  if (label === ANALYTICS_PATH_EXIT_PAGE) return '退出';
  return label === '/' ? '首页' : label;
}

function pathNodeShortText(label: string): string {
  if (label === ANALYTICS_PATH_EXIT_PAGE) return '退出';
  const segments = getRouteSegments(label);
  return segments[segments.length - 1];
}

/** 页面 → 稳定色号：同一页面出现在不同步序上必须同色，否则看不出它在路径中反复出现 */
function buildPageColorIndex(labels: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const label of labels) {
    if (label === ANALYTICS_PATH_EXIT_PAGE || map.has(label)) continue;
    map.set(label, map.size);
  }
  return map;
}

const PATH_LINK_LIMIT_OPTIONS = [
  { label: 'Top 20 链路', value: 20 },
  { label: 'Top 30 链路', value: 30 },
  { label: 'Top 50 链路', value: 50 },
  { label: 'Top 100 链路', value: 100 },
];

type PathLinkRow = PathLink & { id: string; sourceLabel: string; targetLabel: string };

export default function AnalyticsPathTab() {
  const palette = useChartPalette();
  const [days, setDays] = useBehaviorDays();
  const [linkLimit, setLinkLimit] = useState(30);
  const [startPageInput, setStartPageInput] = useState('');
  const [startPage, setStartPage] = useState('');
  const { page, pageSize, resetPage, buildPagination } = usePagination();
  const pathQuery = useAnalyticsPath(days, startPage || undefined, linkLimit);
  const data = pathQuery.data ?? null;
  const loading = pathQuery.isFetching;

  useEffect(() => { resetPage(); }, [days, linkLimit, startPage, resetPage]);

  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const links = useMemo(() => data?.links ?? [], [data]);
  // 桑基布局无法表达回边，只喂非回边；被排除的部分在图下方与明细表如实标出
  const acyclicLinks = useMemo(() => links.filter((link) => !link.cyclic), [links]);
  const nodeLabelMap = useMemo(() => new Map(nodes.map((node) => [node.id, node.label])), [nodes]);
  const pageColorIndex = useMemo(() => buildPageColorIndex(nodes.map((node) => node.label)), [nodes]);

  const sankeySpec = useMemo(() => makeSankeySpec({
    nodes: nodes.map((node) => ({ ...node })),
    links: acyclicLinks.map((link) => ({ ...link })),
    palette,
    nodeColor: (node) => (node.label === ANALYTICS_PATH_EXIT_PAGE
      ? PATH_EXIT_COLOR
      : chartColor(pageColorIndex.get(String(node.label)) ?? 0, palette.primary)),
    nodeLabel: (node) => pathNodeShortText(String(node.label)),
    valueFormatter: numberText,
    tooltip: {
      nodeTitle: (datum) => pathNodeText(datumText(datum, 'label')),
      nodeItems: [
        { key: '流量', value: (datum) => `${numberText(datumNumber(datum, 'value'))} 次` },
      ],
      linkTitle: (datum) => {
        const source = pathNodeText(nodeLabelMap.get(datumText(datum, 'source')) ?? '');
        const target = pathNodeText(nodeLabelMap.get(datumText(datum, 'target')) ?? '');
        return `${source} → ${target}`;
      },
      linkItems: [
        { key: '跳转', value: (datum) => `${numberText(datumNumber(datum, 'value'))} 次` },
      ],
    },
  }), [acyclicLinks, nodeLabelMap, nodes, pageColorIndex, palette]);

  const rows = useMemo<PathLinkRow[]>(() => [...links]
    .sort((a, b) => b.value - a.value)
    .map((link, index) => ({
      ...link,
      id: `${link.source}-${link.target}-${index}`,
      sourceLabel: pathNodeText(nodeLabelMap.get(link.source) ?? link.source),
      targetLabel: pathNodeText(nodeLabelMap.get(link.target) ?? link.target),
    })), [links, nodeLabelMap]);
  const maxValue = useMemo(() => Math.max(1, ...rows.map((row) => row.value)), [rows]);
  // 图与表同源（都来自这一次查询的 links），表格在本地切页即可，不需要再发一次请求
  const pagedRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);

  const columns: ColumnProps<PathLinkRow>[] = [
    { title: '来源页面', dataIndex: 'sourceLabel', render: (value) => renderEllipsis(String(value)) },
    {
      title: '去向页面',
      dataIndex: 'targetLabel',
      render: (_value, record) => (record.targetLabel === '退出'
        ? <Tag color="grey">退出</Tag>
        : renderEllipsis(record.targetLabel)),
    },
    {
      title: '跳转次数',
      align: 'right',
      dataIndex: 'value',
      width: 220,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{numberText(record.value)}</Typography.Text>
          <DataBar value={record.value} max={maxValue} style={{ marginTop: 6 }} />
        </div>
      ),
    },
    {
      title: '图中展示',
      dataIndex: 'cyclic',
      width: 130,
      render: (_value, record) => (record.cyclic
        ? <Tag color="orange">回流·未入图</Tag>
        : <Tag color="green">已入图</Tag>),
    },
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="页面跳转路径"
        description="会话内全部相邻跳转"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input
              prefix={<Search size={14} />}
              placeholder="起点页面（可选），如 /users"
              value={startPageInput}
              showClear
              onChange={setStartPageInput}
              onClear={() => setStartPage('')}
              onKeyDown={(e) => { if (e.key === 'Enter') setStartPage(startPageInput.trim()); }}
              style={{ width: 220 }}
            />
            <SearchButton onClick={() => setStartPage(startPageInput.trim())} />
            <Select value={linkLimit} optionList={PATH_LINK_LIMIT_OPTIONS} onChange={(v) => setLinkLimit(Number(v))} style={{ width: 150 }} />
            <Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />
          </div>
        )}
      />
      <StatGrid minItemWidth={190}>
        <StatCard title="跳转总次数" value={numberText(data?.totalTransitions ?? 0)} icon={<Activity size={19} />} accent={palette.primary} />
        <StatCard title="展示链路" value={numberText(links.length)} icon={<BarChart3 size={19} />} accent="#8b5cf6" />
        <StatCard title="回流未入图" value={numberText(data?.cyclicValue ?? 0)} icon={<RefreshCcw size={19} />} accent="#f59e0b" />
      </StatGrid>
      <Card title="路径流" bodyStyle={{ padding: 16 }}>
        {!acyclicLinks.length ? <ChartPlaceholder loading={loading} description="暂无路径数据" /> : (
          <div>
            <SankeyChart {...sankeySpec} options={chartOptions} height={420} />
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 10 }}>
              节点是页面，灰色为退出（会话结束）；按跳转量取前 {linkLimit} 条链路
              {links.length > acyclicLinks.length
                ? `；其中 ${links.length - acyclicLinks.length} 条回流链路（页面互跳）无法在桑基图中表达，已在下方明细表标出`
                : ''}
              {startPage ? `；仅显示从 ${startPage} 可达的部分` : ''}
            </Typography.Text>
          </div>
        )}
      </Card>
      <Card title="跳转明细" bodyStyle={{ padding: 16 }}>
        {!rows.length ? <ChartPlaceholder loading={loading} description="暂无路径数据" /> : (
          <ConfigurableTable<PathLinkRow>
            bordered
            columns={columns}
            dataSource={pagedRows}
            loading={loading}
            rowKey="id"
            onRefresh={() => void pathQuery.refetch()}
            refreshLoading={loading}
            pagination={buildPagination(rows.length)}
          />
        )}
      </Card>
    </div>
  );
}
