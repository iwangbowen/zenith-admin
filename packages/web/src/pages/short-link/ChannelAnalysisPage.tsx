import { useMemo, useState } from 'react';
import { Card, Radio, RadioGroup, Select, Spin, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Link2, MousePointerClick, Target, Users } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { RefreshButton } from '@/components/toolbar-controls';
import {
  AreaChart, BarChart, EmptyChart, StatCard, StatGrid,
  chartOptions, isEmptyValues, makeAreaSpec, makeBarSpec, useChartPalette,
} from '@/components/charts';
import { useAnalyticsEventMeta } from '@/hooks/queries/analytics';
import { useChannelAnalysis } from '@/hooks/queries/short-links';
import {
  CHANNEL_ANALYSIS_DIMENSION_OPTIONS,
  type ChannelAnalysisDimension, type ChannelAnalysisRow,
} from '@zenith/shared/short-link';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { shortDate } from '@/utils/date';

const { Text } = Typography;

/** 渠道推广分析：短链 UTM 维度的点击 / 访客 / 转化归因（纯读看板） */
export default function ChannelAnalysisPage() {
  const [dimension, setDimension] = useState<ChannelAnalysisDimension>('source');
  const [days, setDays] = useState(30);
  const [convEvent, setConvEvent] = useState<string | undefined>();
  const palette = useChartPalette();

  const analysisQuery = useChannelAnalysis({ dimension, days, convEvent });
  const eventMetaQuery = useAnalyticsEventMeta({ page: 1, pageSize: 100 });
  const data = analysisQuery.data;
  const hasConv = convEvent !== undefined && convEvent !== '';

  const eventOptions = (eventMetaQuery.data?.list ?? []).map((m) => ({
    value: m.eventName,
    label: m.displayName ? `${m.displayName}（${m.eventName}）` : m.eventName,
  }));

  const trendSpec = useMemo(() => makeAreaSpec({
    data: data?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'pv', name: '点击', color: palette.primary },
      { field: 'uv', name: '访客', color: palette.active },
    ],
    palette,
    fillOpacity: 0.16,
    axis: { xLabel: shortDate },
    tooltip: { title: (value) => `日期：${value}` },
  }), [data?.trend, palette]);

  const dimSpec = useMemo(() => makeBarSpec({
    data: (data?.rows ?? []).slice(0, 10),
    xField: 'name',
    series: [{ field: 'clicks', name: '点击', color: palette.primary }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 110,
  }), [data?.rows, palette]);

  const columns: ColumnProps<ChannelAnalysisRow>[] = [
    { title: '渠道值', dataIndex: 'name', width: 200 },
    { title: '点击（PV）', dataIndex: 'clicks', width: 120, align: 'right' },
    { title: '独立访客（UV）', dataIndex: 'uv', width: 130, align: 'right' },
    {
      title: '转化数', dataIndex: 'conversions', width: 110, align: 'right',
      render: (v: number | null) => (v === null ? EMPTY_PLACEHOLDER : v),
    },
    {
      title: '转化率', dataIndex: 'convRate', width: 110, align: 'right',
      render: (v: number | null) => (v === null ? EMPTY_PLACEHOLDER : `${(v * 100).toFixed(2)}%`),
    },
  ];

  return (
    <div className="page-container zx-flat-panels">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <RadioGroup type="button" value={dimension} onChange={(e) => setDimension(e.target.value as ChannelAnalysisDimension)}>
            {CHANNEL_ANALYSIS_DIMENSION_OPTIONS.map((o) => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}
          </RadioGroup>
          <RadioGroup type="button" value={days} onChange={(e) => setDays(e.target.value as number)}>
            <Radio value={7}>近 7 天</Radio>
            <Radio value={30}>近 30 天</Radio>
            <Radio value={90}>近 90 天</Radio>
          </RadioGroup>
          <Select
            placeholder="转化事件（选填）"
            value={convEvent}
            optionList={eventOptions}
            onChange={(v) => setConvEvent(v as string | undefined)}
            loading={eventMetaQuery.isFetching}
            filter
            showClear
            style={{ width: 260 }}
          />
        </div>
        <RefreshButton onClick={() => void analysisQuery.refetch()} loading={analysisQuery.isFetching} />
      </div>

      <Spin spinning={analysisQuery.isPending}>
        <StatGrid>
          <StatCard title="短链点击（PV）" value={data?.totals.clicks ?? 0} icon={<MousePointerClick size={16} />} />
          <StatCard title="独立访客（UV）" value={data?.totals.uv ?? 0} icon={<Users size={16} />} />
          <StatCard title="产生点击的短链" value={data?.totals.links ?? 0} icon={<Link2 size={16} />} />
          <StatCard
            title="转化数"
            value={hasConv ? (data?.totals.conversions ?? 0) : EMPTY_PLACEHOLDER}
            sub={hasConv ? undefined : '选择转化事件后统计'}
            icon={<Target size={16} />}
          />
        </StatGrid>

        <div className="chart-grid" style={{ marginTop: 16 }}>
          <Card title="点击趋势">
            {isEmptyValues((data?.trend ?? []).map((p) => ({ value: p.pv + p.uv }))) ? <EmptyChart height={240} /> : (
              <AreaChart {...trendSpec} options={chartOptions} height={240} />
            )}
          </Card>
          <Card title="渠道点击 Top 10">
            {(data?.rows.length ?? 0) === 0 ? <EmptyChart height={240} /> : (
              <BarChart {...dimSpec} options={chartOptions} height={240} />
            )}
          </Card>
        </div>

        <Card title="渠道明细" style={{ marginTop: 16 }}>
          <ConfigurableTable
            bordered
            columns={columns}
            dataSource={data?.rows ?? []}
            loading={analysisQuery.isFetching}
            rowKey="name"
            size="small"
            empty="窗口内暂无带 UTM 参数的短链点击"
            onRefresh={() => void analysisQuery.refetch()}
            refreshLoading={analysisQuery.isFetching}
          />
          <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
            口径说明：点击/访客来自短链跳转（不含爬虫）；转化按所选事件的 UTM 参数归因到渠道，短链跳转时自动携带 UTM。
          </Text>
        </Card>
      </Spin>
    </div>
  );
}
