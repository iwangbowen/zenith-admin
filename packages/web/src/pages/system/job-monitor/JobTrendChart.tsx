import { useState } from 'react';
import { Banner, Button, Typography } from '@douyinfe/semi-ui';
import { JOB_MONITOR_TREND_RANGE_OPTIONS, type JobMonitorTrendRange } from '@zenith/shared/platform';
import { LineChart, chartOptions, compactCount, makeLineSpec, useChartPalette } from '@/components/charts';
import { RefreshButton } from '@/components/toolbar-controls';
import { useJobMonitorTrend } from '@/hooks/queries/job-monitor';

const { Text } = Typography;

const EMPTY_POINTS: NonNullable<ReturnType<typeof useJobMonitorTrend>['data']>['points'] = [];

/** 查询尚未返回点位时，也给图表一个 x 轴分类，避免整块图表塌缩成纯文本。 */
const EMPTY_POINT: (typeof EMPTY_POINTS)[number] = {
  time: '',
  backlog: null,
  stuck: null,
  dead: null,
  failed1h: null,
};

/** 趋势点字段，与契约点位列同名 */
type TrendField = 'backlog' | 'stuck' | 'dead' | 'failed1h';

/** 单格图里的一条曲线 */
interface TrendLine {
  field: TrendField;
  name: string;
  color: string;
}

type ChartPalette = ReturnType<typeof useChartPalette>;

/** 横轴标签：7 天范围带日期，其余只到分钟 */
const axisLabel = (range: JobMonitorTrendRange) => (value: string) =>
  range === '7d' ? value.slice(5, 16) : value.slice(11, 16);

/**
 * 按格子组装折线配置。
 *
 * 公共 builder 的默认数值归一会把 null 变成 0；作业历史里缺失的样本必须保留为断点，
 * 否则「采集失败 / 尚无历史事实」会被画成「指标跌到 0」。
 */
function buildSpec(
  points: typeof EMPTY_POINTS,
  lines: TrendLine[],
  palette: ChartPalette,
  range: JobMonitorTrendRange,
) {
  const base = makeLineSpec({
    data: points,
    xField: 'time',
    series: lines.map((line) => ({ field: line.field, name: line.name, color: line.color })),
    palette,
    smooth: false,
    axis: { xLabel: axisLabel(range) },
    tooltip: { value: (value, _name, datum) => (datum?.__value == null ? '未采集' : compactCount(value)) },
  });
  return {
    ...base,
    data: [{
      id: 'series',
      values: points.flatMap((point) => lines.map((line) => ({ ...point, __x: point.time, __type: line.name, __value: point[line.field] }))),
    }],
    invalidType: 'break' as const,
  };
}

/**
 * 作业趋势：扁平排版（不用卡片），范围切换器与曲线同屏。
 *
 * 点位来自每分钟随系统指标采集的历史分桶，支持 1h / 6h / 24h / 7d；
 * 采集失败或尚未产生历史事实的样本为 null，图中保留断点，不插值成 0。
 * 四个指标按量级拆成三格（积压、卡死与死信、近 1h 失败），避免大数量级把小指标压平。
 */
export default function JobTrendChart() {
  const [range, setRange] = useState<JobMonitorTrendRange>('24h');
  const query = useJobMonitorTrend(range);
  const points = query.data?.points ?? EMPTY_POINTS;
  const palette = useChartPalette();

  const cells: Array<{ title: string; lines: TrendLine[]; note: string }> = [
    {
      title: '积压',
      lines: [{ field: 'backlog', name: '积压', color: palette.primary }],
      note: '已到期未领取的作业数，取每分钟采样的瞬时值',
    },
    {
      title: '卡死与死信',
      lines: [
        { field: 'stuck', name: '卡死', color: palette.danger },
        { field: 'dead', name: '死信', color: palette.warning },
      ],
      note: '超阈值未推进与投递失败的存量，取每分钟采样的瞬时值',
    },
    {
      title: '近 1h 失败',
      lines: [{ field: 'failed1h', name: '失败', color: palette.risk }],
      note: '滚动一小时的失败执行数，取每分钟采样的瞬时值',
    },
  ];

  return (
    <div className="job-monitor-trend">
      <div className="job-monitor-trend__header">
        <div className="job-monitor-trend__heading">
          <Text strong>作业趋势</Text>
          <Text type="tertiary" size="small">每分钟采集，图表每 60 秒刷新；采集失败或尚无历史事实的点位显示为断点。</Text>
        </div>
        <div className="job-monitor-trend__controls">
          <div className="job-monitor-trend__range" aria-label="趋势范围">
            {JOB_MONITOR_TREND_RANGE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="small"
                theme={range === option.value ? 'solid' : 'light'}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <RefreshButton onClick={() => { void query.refetch(); }} loading={query.isFetching} />
        </div>
      </div>
      {query.isError && <Banner type="warning" closeIcon={null} description={`趋势加载失败：${query.error?.message ?? '未知错误'}`} />}
      <div className="job-monitor-trend__grid">
        {cells.map((cell) => {
          const hasCellFacts = points.some((point) => cell.lines.some((line) => point[line.field] !== null));
          const chartPoints = points.length > 0 ? points : [EMPTY_POINT];
          return (
            <div className="job-monitor-trend__cell" key={cell.title}>
              <Text strong size="small">{cell.title}</Text>
              <div className="job-monitor-trend__chart" data-empty={!hasCellFacts || undefined}>
                <LineChart {...buildSpec(chartPoints, cell.lines, palette, range)} options={chartOptions} height={170} />
                {!hasCellFacts && (
                  <div
                    className="job-monitor-trend__empty"
                    role="status"
                    aria-label={query.isPending ? '趋势数据加载中…' : '暂无可用的作业趋势样本'}
                  >
                    {query.isPending ? '趋势数据加载中…' : '暂无可用的作业趋势样本'}
                  </div>
                )}
              </div>
              <Text type="tertiary" size="small">{cell.note}</Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}
