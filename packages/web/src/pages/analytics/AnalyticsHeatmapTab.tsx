/** 点击分布：页面 / 区域落点散点（大小 = 点击次数、颜色 = 人均重复）+ 热点元素榜 + 挫败点击榜 */
import { useEffect, useMemo, useState } from 'react';
import { Card, Empty, Select, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity, BarChart3, Flame, Users } from 'lucide-react';
import { DataBar } from '@/components/data-viz/DataBar';
import { ScatterChart, chartOptions, makeScatterSpec, datumNumber, datumText, datumBoolean, useChartPalette, StatCard, StatGrid, type ChartDatum } from '@/components/charts';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { dateTimeColumn } from '@/utils/table-columns';
import { useAnalyticsHeatmap, useAnalyticsHeatmapPages } from '@/hooks/queries/analytics';
import type { AnalyticsEventSource, HeatmapData, HeatmapElementItem, HeatmapPageListItem, HeatmapRageClickItem } from '@zenith/shared/analytics';
import { ANALYTICS_DEVICE_TYPE_OPTIONS, ANALYTICS_EVENT_SOURCE_OPTIONS } from '@zenith/shared/analytics';
import { FilterSelect } from '@/components/search-filters';
import { useBehaviorDays } from './behavior-days-context';
import { DAYS_OPTIONS, elementDisplayName, numberText, sectionStyle, type DeviceFilter } from './analytics-format';
import { ChartPlaceholder, SectionHeader } from './analytics-shared';

const EMPTY_HEATMAP_PAGES: HeatmapPageListItem[] = [];

// 人均重复点击 → 颜色：1 次/人是正常点击，越高说明少数人在同一处反复点，通常是交互失效信号
const REPEAT_RATE_SCALE = [
  { min: 4, color: '#dc2626', label: '≥4 次/人' },
  { min: 2.5, color: '#f97316', label: '2.5–4 次/人' },
  { min: 1.5, color: '#f59e0b', label: '1.5–2.5 次/人' },
  { min: 0, color: '#22c55e', label: '<1.5 次/人' },
];

function repeatRateColor(rate: number): string {
  return (REPEAT_RATE_SCALE.find((item) => rate >= item.min) ?? REPEAT_RATE_SCALE[REPEAT_RATE_SCALE.length - 1]).color;
}

function ClickScatter({ data }: Readonly<{ data: HeatmapData }>) {
  const palette = useChartPalette();
  const spec = useMemo(() => {
    const maxValue = Math.max(1, ...data.points.map((point) => point.value));
    // 大小编码点击次数，颜色编码人均重复点击 —— 两个通道各自承载一个指标，不再冗余
    const sizeRatio = (datum: ChartDatum) => Math.max(0.12, Math.min(1, datumNumber(datum, 'value') / maxValue));
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
        size: (datum) => 8 + 34 * sizeRatio(datum),
        fill: (datum) => repeatRateColor(datumNumber(datum, 'repeatRate')),
        fillOpacity: 0.5,
        // 挫败点击命中的落点加深色描边，与下方 rage 榜单联动
        stroke: (datum) => (datumBoolean(datum, 'rage') ? '#7f1d1d' : palette.bg1),
        lineWidth: (datum) => (datumBoolean(datum, 'rage') ? 2.5 : 1),
      },
      tooltip: {
        title: (datum) => datumText(datum, 'topLabel') || `位置 (${datumNumber(datum, 'x')}%, ${datumNumber(datum, 'y')}%)`,
        items: [
          { key: '点击次数', value: (datum) => `${datumNumber(datum, 'value')} 次` },
          { key: '点击人数', value: (datum) => `${datumNumber(datum, 'uniqueUsers')} 人` },
          { key: '人均重复', value: (datum) => `${datumNumber(datum, 'repeatRate')} 次/人` },
          { key: 'UI区域', value: (datum) => datumText(datum, 'topArea') || '未标记' },
          { key: '位置', value: (datum) => `${datumNumber(datum, 'x')}%, ${datumNumber(datum, 'y')}%` },
          { key: '挫败点击', value: (datum) => (datumBoolean(datum, 'rage') ? '是（该元素存在连点）' : '否') },
        ],
      },
    });
  }, [data, palette]);

  return <ScatterChart {...spec} options={chartOptions} height={360} />;
}

function ScatterLegend() {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
      <Typography.Text type="tertiary" size="small">点大小 = 点击次数；颜色 = 人均重复点击</Typography.Text>
      {REPEAT_RATE_SCALE.map((item) => (
        <Space key={item.label} spacing={6}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, opacity: 0.75 }} />
          <Typography.Text type="tertiary" size="small">{item.label}</Typography.Text>
        </Space>
      ))}
      <Space spacing={6}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'transparent', border: '2.5px solid #7f1d1d' }} />
        <Typography.Text type="tertiary" size="small">存在挫败点击</Typography.Text>
      </Space>
    </div>
  );
}

type HeatmapElementRow = HeatmapElementItem & { id: string; rank: number };
type RageClickRow = HeatmapRageClickItem & { id: string };

export default function AnalyticsHeatmapTab() {
  const [days, setDays] = useBehaviorDays();
  const [pagePath, setPagePath] = useState('');
  const [componentArea, setComponentArea] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceFilter | undefined>();
  const [source, setSource] = useState<AnalyticsEventSource | undefined>();
  const pagesQuery = useAnalyticsHeatmapPages(days);
  const pages = pagesQuery.data?.pages ?? EMPTY_HEATMAP_PAGES;
  const heatmapQuery = useAnalyticsHeatmap(pagePath, componentArea, days, deviceType, source);
  const data = heatmapQuery.data ?? null;
  const pagesLoading = pagesQuery.isFetching;
  const loading = heatmapQuery.isFetching;

  useEffect(() => {
    const nextPage = pages.find((item) => item.pagePath === pagePath) ?? pages[0];
    setPagePath(nextPage?.pagePath ?? '');
    setComponentArea((prev) => (prev && nextPage?.areas.includes(prev) ? prev : ''));
  }, [pages, pagePath]);

  const selectedPage = useMemo(() => pages.find((item) => item.pagePath === pagePath), [pagePath, pages]);
  const pageOptions = useMemo(() => pages.map((item) => ({ label: item.pageTitle ? `${item.pageTitle} · ${item.pagePath}` : item.pagePath, value: item.pagePath })), [pages]);
  const areaOptions = useMemo(() => [
    { label: '全页（自动采集）', value: '' },
    ...(selectedPage?.areas ?? []).map((area) => ({ label: area, value: area })),
  ], [selectedPage]);

  useEffect(() => {
    if (!selectedPage) return;
    if (componentArea && !selectedPage.areas.includes(componentArea)) setComponentArea('');
  }, [componentArea, selectedPage]);

  const elementRows = useMemo<HeatmapElementRow[]>(
    () => (data?.topElements ?? []).map((item, index) => ({ ...item, id: item.elementKey, rank: index + 1 })),
    [data],
  );
  const maxElementCount = useMemo(() => Math.max(1, ...elementRows.map((item) => item.count)), [elementRows]);
  const rageRows = useMemo<RageClickRow[]>(
    () => (data?.rageClicks ?? []).map((item, index) => ({ ...item, id: `${item.elementKey ?? 'unknown'}:${index}` })),
    [data],
  );

  const cards = data ? [
    { title: '点击次数', value: numberText(data.total), icon: <Flame size={19} />, accent: '#ef4444' },
    { title: '点击访客', value: numberText(data.uniqueUsers), icon: <Users size={19} />, accent: '#22c55e' },
    { title: '点击会话', value: numberText(data.uniqueSessions), icon: <Activity size={19} />, accent: '#8b5cf6' },
    { title: '人均点击', value: data.avgClicksPerUser.toFixed(1), icon: <BarChart3 size={19} />, accent: '#06b6d4' },
  ] : [];

  const elementColumns: ColumnProps<HeatmapElementRow>[] = [
    { title: '排名', dataIndex: 'rank', width: 80, render: (value) => <Tag color={Number(value) <= 3 ? 'orange' : 'grey'}>#{String(value)}</Tag> },
    {
      title: '元素',
      dataIndex: 'elementKey',
      width: 240,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{elementDisplayName(record.elementLabel, record.elementKey)}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small">{record.elementKey}</Typography.Text></div>
        </div>
      ),
    },
    { title: 'UI区域', dataIndex: 'componentArea', width: 130, render: (_value, record) => (record.componentArea ? <Tag color="blue">{record.componentArea}</Tag> : <Tag color="grey">未标记</Tag>) },
    { title: '平均落点', dataIndex: 'avgX', width: 120, render: (_value, record) => <Typography.Text type="tertiary">{record.avgX == null || record.avgY == null ? '–' : `${record.avgX}% , ${record.avgY}%`}</Typography.Text> },
    { title: '点击人数', dataIndex: 'uniqueUsers', width: 110, align: 'right', render: (value) => numberText(Number(value)) },
    {
      title: '点击次数',
      align: 'right',
      dataIndex: 'count',
      width: 200,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{numberText(record.count)}</Typography.Text>
          <DataBar value={record.count} max={maxElementCount} style={{ marginTop: 6 }} />
        </div>
      ),
    },
  ];

  const rageColumns: ColumnProps<RageClickRow>[] = [
    {
      title: '元素',
      dataIndex: 'elementKey',
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{record.elementLabel || record.elementKey || '未识别元素'}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small">{record.elementKey}</Typography.Text></div>
        </div>
      ),
    },
    { title: '发生次数', dataIndex: 'count', width: 110, align: 'right', render: (value) => <Tag color="red">{numberText(Number(value))}</Tag> },
    { title: '影响人数', dataIndex: 'uniqueUsers', width: 110, align: 'right', render: (value) => numberText(Number(value)) },
    dateTimeColumn('最近发生', 'lastAt'),
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="点击分布"
        description="页面区域点击落点分布"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />
            <Select placeholder="选择页面" value={pagePath || undefined} optionList={pageOptions} loading={pagesLoading} onChange={(v) => setPagePath(String(v ?? ''))} style={{ width: 280 }} />
            <Select placeholder="选择区域" value={componentArea} optionList={areaOptions} onChange={(v) => setComponentArea(String(v ?? ''))} style={{ width: 180 }} />
            <FilterSelect
              placeholder="全部设备"
              items={ANALYTICS_DEVICE_TYPE_OPTIONS}
              value={deviceType}
              onChange={setDeviceType}
              width={140}
            />
            <FilterSelect placeholder="全部来源" items={ANALYTICS_EVENT_SOURCE_OPTIONS} value={source} onChange={setSource} width={150} />
          </div>
        )}
      />
      <Typography.Text type="tertiary" size="small">
        落点坐标是视口百分比，桌面端与移动端的分布不可直接比较，建议按设备分开查看
      </Typography.Text>
      <StatGrid minItemWidth={190}>{cards.map((card) => <StatCard key={String(card.title)} {...card} />)}</StatGrid>
      <Card title="落点分布" bodyStyle={{ padding: 16 }}>
        <Spin spinning={loading}>
          {!data?.points.length ? <Empty description="暂无点击数据" /> : (
            <div>
              <ClickScatter data={data} />
              <ScatterLegend />
              <Typography.Text type="tertiary" style={{ display: 'block', marginTop: 10 }}>
                {numberText(data.total)} 次点击 · {data.pagePath} · {data.componentArea || '全页'}
              </Typography.Text>
            </div>
          )}
        </Spin>
      </Card>
      <Card title="热点元素 TOP 10" bodyStyle={{ padding: 16 }}>
        {!elementRows.length ? <ChartPlaceholder loading={loading} description="暂无带元素标识的点击" /> : (
          <ConfigurableTable<HeatmapElementRow>
            bordered
            columns={elementColumns}
            dataSource={elementRows}
            loading={loading}
            rowKey="id"
            onRefresh={() => void heatmapQuery.refetch()}
            refreshLoading={loading}
            pagination={false}
          />
        )}
      </Card>
      <Card title="挫败点击（连点无响应）" bodyStyle={{ padding: 16 }}>
        {!rageRows.length ? <ChartPlaceholder loading={loading} description="该页面暂无挫败点击" /> : (
          <ConfigurableTable<RageClickRow>
            bordered
            columns={rageColumns}
            dataSource={rageRows}
            loading={loading}
            rowKey="id"
            onRefresh={() => void heatmapQuery.refetch()}
            refreshLoading={loading}
            pagination={false}
          />
        )}
      </Card>
    </div>
  );
}
