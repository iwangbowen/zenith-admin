import { useMemo } from 'react';
import { BarChart, ChartCard, chartOptions, makeBarSpec, useChartPalette } from '@/components/charts';

interface ChannelDistributionDatum {
  readonly channelId: number;
  readonly channelName: string;
  readonly count: number;
}

interface CmsChannelDistributionChartProps {
  readonly data?: readonly ChannelDistributionDatum[];
  readonly loading?: boolean;
  /** 点击柱子：按该栏目穿透到内容管理列表 */
  readonly onSelectChannel?: (channelId: number) => void;
}

/**
 * 数据看板的「栏目内容分布 TOP10」：横向条形图，hover 显示数量与占比，点击穿透。
 * 独立成懒加载 chunk（vchart 体积，见 CmsPublishVisitTrendChart 注释）。
 */
export default function CmsChannelDistributionChart({ data = [], loading, onSelectChannel }: CmsChannelDistributionChartProps) {
  const palette = useChartPalette();

  const total = useMemo(() => data.reduce((sum, d) => sum + d.count, 0), [data]);
  const spec = useMemo(() => makeBarSpec({
    data,
    xField: 'channelName',
    series: [{ field: 'count', name: '内容数' }],
    palette,
    horizontal: true,
    categoryAxisWidth: 120,
    showLabel: true,
    barMinHeight: 4,
    tooltip: {
      value: (value) => (total > 0 ? `${value} 篇 · ${((value / total) * 100).toFixed(1)}%` : `${value} 篇`),
    },
  }), [data, palette, total]);

  return (
    <ChartCard
      title="栏目内容分布 TOP10"
      loading={loading}
      empty={data.length > 0 ? null : '暂无内容'}
    >
      <BarChart
        {...spec}
        options={chartOptions}
        height={300}
        onClick={onSelectChannel ? (p: unknown) => {
          const datum = (p as { datum?: { channelId?: unknown } })?.datum;
          if (typeof datum?.channelId === 'number') onSelectChannel(datum.channelId);
        } : undefined}
      />
    </ChartCard>
  );
}
