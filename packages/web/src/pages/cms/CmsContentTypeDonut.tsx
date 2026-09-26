import { useMemo } from 'react';
import { ChartCard, PieChart, chartOptions, makePieSpec, useChartPalette } from '@/components/charts';
import { CMS_CONTENT_TYPE_LABELS, type CmsContentType } from '@zenith/shared/cms';

interface CmsContentTypeDonutProps {
  readonly data?: readonly { contentType: CmsContentType; count: number }[];
  readonly loading?: boolean;
}

/**
 * 数据看板的「内容形态分布」环图（图文 / 图集 / 音视频 / 链接）。
 * 独立成懒加载 chunk（vchart 体积，见 CmsPublishVisitTrendChart 注释）。
 */
export default function CmsContentTypeDonut({ data = [], loading }: CmsContentTypeDonutProps) {
  const palette = useChartPalette();

  const pieData = useMemo(
    () => data
      .filter((d) => d.count > 0)
      .map((d) => ({ type: CMS_CONTENT_TYPE_LABELS[d.contentType] ?? d.contentType, count: d.count })),
    [data],
  );
  const spec = useMemo(() => makePieSpec({
    data: pieData,
    categoryField: 'type',
    valueField: 'count',
    palette,
    valueFormatter: (v) => `${v} 篇`,
  }), [pieData, palette]);

  return (
    <ChartCard
      title="内容形态分布"
      loading={loading}
      empty={pieData.length > 0 ? null : '暂无内容'}
    >
      <PieChart {...spec} options={chartOptions} height={260} />
    </ChartCard>
  );
}
