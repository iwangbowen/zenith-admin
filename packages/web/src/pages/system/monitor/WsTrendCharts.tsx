import { useMemo } from 'react';
import { Typography } from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import { LineChart, chartOptions, compactCount, makeLineSpec, useChartPalette } from '@/components/charts';
import { ChartCard } from '@/components/charts/ChartCard';
import { useMonitorWsTrend } from '@/hooks/queries/monitor';

const { Text } = Typography;

/** 趋势卡片内的曲线：`field` 与实际绘图数据字段同名（含派生出的速率字段） */
interface TrendLine {
  field: string;
  name: string;
  color: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * 采样窗口不足两点时不画图：单点连不成线，画出来只是一个孤立的点，
 * 反而让人误以为流量掉到 0。
 */
const MIN_POINTS = 2;

/**
 * WebSocket 连接趋势（连接态 / 吞吐 / 连接变化三张卡片）。
 *
 * 数据来自 api 进程的采样 tick（10 秒/点、保留 1 小时、不落库），
 * 因此服务重启后重新累积：卡片底部的口径说明如实写明，不假装是持久化历史。
 * 口径（瞬时值 vs 周期增量）见 shared 契约 `MonitorWsTrendPoint`，页面不重复解释每个字段。
 */
export default function WsTrendCharts({ refetchInterval }: Readonly<{ refetchInterval: number | false }>) {
  const query = useMonitorWsTrend(refetchInterval);
  const palette = useChartPalette();
  const intervalSec = query.data?.intervalSec ?? 10;
  const points = useMemo(
    () => (query.data?.points ?? []).map((point) => ({
      ...point,
      time: dayjs(point.t).format('HH:mm:ss'),
      sentPerSec: round1(point.sent / intervalSec),
      recvPerSec: round1(point.recv / intervalSec),
    })),
    [query.data, intervalSec],
  );

  const cards: { title: string; lines: TrendLine[]; unit?: string; note: string }[] = [
    {
      title: '连接与用户',
      lines: [
        { field: 'connections', name: '连接数', color: palette.primary },
        { field: 'users', name: '在线用户', color: palette.success },
        { field: 'idle', name: '空闲连接', color: palette.warning },
      ],
      note: '瞬时值；空闲 = 最后活动超过 120 秒',
    },
    {
      title: '消息速率（条/秒）',
      lines: [
        { field: 'sentPerSec', name: '发送', color: palette.primary },
        { field: 'recvPerSec', name: '接收', color: palette.success },
      ],
      unit: '条/秒',
      note: `由每 ${intervalSec} 秒的收发增量换算`,
    },
    {
      title: `连接变化（每 ${intervalSec} 秒）`,
      lines: [
        { field: 'connects', name: '新建', color: palette.success },
        { field: 'disconnects', name: '断开', color: palette.danger },
        { field: 'failed', name: '采样失败（窗口）', color: palette.warning },
      ],
      note: '新建 / 断开为周期增量；失败取最近 200 条采样窗口，不是增量',
    },
  ];

  if (points.length < MIN_POINTS) {
    return (
      <ChartCard
        title="连接趋势"
        loading={query.isPending}
        empty={query.isPending ? null : `趋势采样中（每 ${intervalSec} 秒一点），约 ${intervalSec * MIN_POINTS} 秒后出现曲线`}
      >
        {null}
      </ChartCard>
    );
  }

  return (
    <div className="ws-monitor-trends">
      {cards.map((card) => {
        const spec = makeLineSpec({
          data: points,
          xField: 'time',
          series: card.lines.map((line) => ({ field: line.field, name: line.name, color: line.color })),
          palette,
          smooth: false,
          axis: card.unit ? { yLabel: (value: number) => `${value}` } : undefined,
          tooltip: { value: (value) => compactCount(Number(value)) },
        });
        return (
          <ChartCard key={card.title} title={card.title} height={180}>
            <LineChart {...spec} options={chartOptions} height={180} />
            <Text type="tertiary" size="small">{card.note}</Text>
          </ChartCard>
        );
      })}
    </div>
  );
}
