import { useMemo, useState } from 'react';
import { Banner, Select, Space, Typography } from '@douyinfe/semi-ui';
import { enumValueOf } from '@zenith/shared/core';
import { JOB_MONITOR_TREND_RANGES, JOB_MONITOR_TREND_RANGE_OPTIONS } from '@zenith/shared/platform';
import { LineChart, chartOptions, compactCount, makeLineSpec, useChartPalette } from '@/components/charts';
import { ChartCard } from '@/components/charts/ChartCard';
import { RefreshButton } from '@/components/toolbar-controls';
import { useJobMonitorTrend, type JobMonitorTrendRange } from '@/hooks/queries/job-monitor';

const EMPTY_POINTS: NonNullable<ReturnType<typeof useJobMonitorTrend>['data']>['points'] = [];

export default function JobTrendChart() {
  const [range, setRange] = useState<JobMonitorTrendRange>('24h');
  const query = useJobMonitorTrend(range);
  const points = query.data?.points ?? EMPTY_POINTS;
  const palette = useChartPalette();
  const spec = useMemo(() => {
    const series = [
      { field: 'backlog' as const, name: '积压', color: palette.primary },
      { field: 'stuck' as const, name: '卡死', color: palette.danger },
      { field: 'dead' as const, name: '死信', color: palette.warning },
      { field: 'failed1h' as const, name: '近 1h 失败', color: palette.risk },
    ];
    const base = makeLineSpec({
      data: points, xField: 'time', series, palette, smooth: false,
      axis: { xLabel: (value) => range === '7d' ? value.slice(5, 16) : value.slice(11, 16) },
      tooltip: { value: (value, _name, datum) => datum?.__value == null ? '未采集' : compactCount(value) },
    });
    // 公共 builder 的默认数值归一会将 null 变为 0；作业历史的缺失点需要保留为断点。
    return {
      ...base,
      data: [{ id: 'series', values: points.flatMap((point) => series.map((item) => ({ ...point, __x: point.time, __type: item.name, __value: point[item.field] }))) }],
      invalidType: 'break' as const,
    };
  }, [points, palette, range]);
  const hasFacts = points.some((point) => point.backlog !== null || point.stuck !== null || point.dead !== null || point.failed1h !== null);

  return (
    <>
      {query.isError && <Banner type="warning" closeIcon={null} description={`趋势加载失败：${query.error?.message ?? '未知错误'}`} />}
      <ChartCard title="作业趋势" height={280} loading={query.isPending} empty={!hasFacts ? '暂无可用的作业趋势样本' : null} extra={(
      <Space wrap>
        <Select aria-label="趋势时间范围" value={range} optionList={JOB_MONITOR_TREND_RANGE_OPTIONS} onChange={(value) => setRange(enumValueOf(JOB_MONITOR_TREND_RANGES, value) ?? '24h')} />
        <RefreshButton onClick={() => { void query.refetch(); }} loading={query.isFetching} />
      </Space>
    )}>
      <LineChart {...spec} options={chartOptions} height={280} />
      <Typography.Text type="tertiary" size="small">每分钟采集，图表每 60 秒刷新；采集失败或尚无历史事实的点位显示为断点。</Typography.Text>
      </ChartCard>
    </>
  );
}
