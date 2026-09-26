import { useMemo } from 'react';
import { BarChart, ChartCard, chartOptions, makeBarSpec, useChartPalette } from '@/components/charts';

interface CmsPublishTrendChartProps {
  /** 近 14 天发布趋势（含发布数为 0 的日期）；未取到时按空态处理 */
  readonly data?: readonly { date: string; count: number }[];
  readonly loading?: boolean;
}

/** 稳定的空数据引用：避免 `?? []` 每次渲染换新数组，白白重算 spec */
const NO_TREND: readonly { date: string; count: number }[] = [];

/**
 * 数据看板的「发布趋势（近 14 天）」柱状图。
 *
 * 独立成懒加载 chunk：'@/components/charts' 模块求值即接入 VChart 主题，
 * 会拖入 ~2MB 的 @visactor 依赖树（见 charts-barrel-imports.test.ts）。拆出后
 * 看板主体（状态卡 / 热门内容 / 栏目分布）先渲染，图表随本 chunk 就绪后补齐；
 * 数据看板无数据时 ChartCard 直接出空态，连本 chunk 都不加载。
 */
export default function CmsPublishTrendChart({ data = NO_TREND, loading }: CmsPublishTrendChartProps) {
  const palette = useChartPalette();

  const spec = useMemo(() => makeBarSpec({
    data,
    xField: 'date',
    series: [{ field: 'count', name: '发布数' }],
    palette,
    showLabel: true,
    axis: { xLabel: (value) => value.slice(5) },
    tooltip: { value: (value) => `${value} 篇` },
  }), [data, palette]);

  const hasData = data.some((trend) => trend.count > 0);

  return (
    <ChartCard
      title="发布趋势（近 14 天）"
      loading={loading}
      empty={hasData ? null : '近 14 天暂无发布'}
    >
      <BarChart {...spec} options={chartOptions} height={220} />
    </ChartCard>
  );
}
