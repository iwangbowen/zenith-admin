import { useMemo } from 'react';
import { BarChart, ChartCard, CommonChart, chartOptions, makeBarSpec, makeMixedBarLineSpec, useChartPalette } from '@/components/charts';

interface CmsPublishVisitTrendChartProps {
  /** 近 14 天发布趋势（含发布数为 0 的日期）；未取到时按空态处理 */
  readonly publishTrend?: readonly { date: string; count: number }[];
  /** 访问量趋势（PV， behavioral 日志口径）；无权限或未取到时只画发布数 */
  readonly visitsTrend?: readonly { date: string; pv: number }[];
  readonly loading?: boolean;
}

/** 稳定的空数据引用：避免 `?? []` 每次渲染换新数组，白白重算 spec */
const NO_PUBLISH: readonly { date: string; count: number }[] = [];
const NO_VISITS: readonly { date: string; pv: number }[] = [];

/**
 * 数据看板的「发布与访问趋势（近 14 天）」：柱 = 发布数（左轴），线 = 访问量 PV（右轴）。
 *
 * 独立成懒加载 chunk：'@/components/charts' 模块求值即接入 VChart 主题，
 * 会拖入 ~2MB 的 @visactor 依赖树（见 charts-barrel-imports.test.ts）。拆出后
 * 看板主体先渲染，图表随本 chunk 就绪后补齐；无数据时 ChartCard 直接出空态。
 */
export default function CmsPublishVisitTrendChart({ publishTrend = NO_PUBLISH, visitsTrend = NO_VISITS, loading }: CmsPublishVisitTrendChartProps) {
  const palette = useChartPalette();

  const joined = useMemo(() => {
    const pvByDate = new Map(visitsTrend.map((t) => [t.date, t.pv]));
    return publishTrend.map((t) => ({ date: t.date, published: t.count, pv: pvByDate.get(t.date) ?? 0 }));
  }, [publishTrend, visitsTrend]);

  const mixedSpec = useMemo(() => makeMixedBarLineSpec({
    data: joined,
    xField: 'date',
    palette,
    bar: { field: 'published', name: '发布数' },
    line: { field: 'pv', name: '访问量', smooth: true, showPoint: true },
    axis: { xLabel: (value) => value.slice(5) },
    tooltip: { barValue: (value) => `${value} 篇`, lineValue: (value) => `${value} 次` },
  }), [joined, palette]);

  const barSpec = useMemo(() => makeBarSpec({
    data: publishTrend,
    xField: 'date',
    series: [{ field: 'count', name: '发布数' }],
    palette,
    showLabel: true,
    axis: { xLabel: (value) => value.slice(5) },
    tooltip: { value: (value) => `${value} 篇` },
  }), [publishTrend, palette]);

  const hasPublish = publishTrend.some((t) => t.count > 0);
  const hasVisits = visitsTrend.length > 0;
  const title = hasVisits ? '发布与访问趋势（近 14 天）' : '发布趋势（近 14 天）';

  return (
    <ChartCard
      title={title}
      loading={loading}
      empty={hasPublish ? null : '近 14 天暂无发布'}
    >
      {hasVisits
        ? <CommonChart {...mixedSpec} options={chartOptions} height={220} />
        : <BarChart {...barSpec} options={chartOptions} height={220} />}
    </ChartCard>
  );
}
