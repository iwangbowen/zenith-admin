import { useMemo } from 'react';
import { Card } from '@douyinfe/semi-ui';
import { formatBytes } from '@zenith/shared/core';
import type { DriveAdminStats } from '@zenith/shared/drive';
import { EmptyChart, LineChart, PieChart, chartOptions, makeLineSpec, makePieSpec, useChartPalette } from '@/components/charts';

/** 治理页图表区：独立 chunk，避免 VChart 进入网盘主包 */
export default function DriveAdminCharts({ stats }: { readonly stats: DriveAdminStats }) {
  const palette = useChartPalette();
  const trendSpec = useMemo(() => makeLineSpec({
    data: stats.dailyTrend,
    xField: 'date',
    series: [{ field: 'uploads', name: '上传' }, { field: 'downloads', name: '下载' }],
    palette,
    point: true,
    axis: { xLabel: (d: string) => d.slice(5) },
    tooltip: { title: (x) => `日期：${x}` },
  }), [stats.dailyTrend, palette]);
  const typeSpec = useMemo(() => makePieSpec({
    data: stats.typeDistribution.map((t) => ({ category: t.category, bytes: t.bytes })),
    categoryField: 'category',
    valueField: 'bytes',
    palette,
    valueFormatter: (v) => formatBytes(v),
    indicator: { title: formatBytes(stats.totalBytes), subtitle: '总占用' },
    indicatorTitleFontSize: 18,
    legend: true,
    label: 'none',
  }), [stats.typeDistribution, stats.totalBytes, palette]);

  return (
    <div className="chart-grid">
      <Card title="14 天上传 / 下载趋势">
        {stats.dailyTrend.length === 0 ? <EmptyChart height={220} /> : <LineChart {...trendSpec} options={chartOptions} height={220} />}
      </Card>
      <Card title="文件类型占用分布">
        {stats.typeDistribution.length === 0 ? <EmptyChart height={220} /> : <PieChart {...typeSpec} options={chartOptions} height={220} />}
      </Card>
    </div>
  );
}
