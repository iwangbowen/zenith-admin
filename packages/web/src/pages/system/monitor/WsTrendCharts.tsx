import { useMemo, useState } from 'react';
import { Button, Typography } from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import { LineChart, chartOptions, compactCount, makeLineSpec, useChartPalette } from '@/components/charts';
import { useMonitorWsTrend, useMonitorWsTrendHistory } from '@/hooks/queries/monitor';
import type { MonitorHistoryRange } from '@zenith/shared/platform';

const { Text } = Typography;

/** 趋势卡片内的曲线：`field` 与实际绘图数据字段同名（含派生出的速率字段） */
interface TrendLine {
  field: string;
  name: string;
  color: string;
}

/**
 * 趋势范围：`live` 是进程内存里的近实时曲线（10 秒/点、1 小时），
 * 其余是 `ws_metric_samples` 落库后的历史分桶曲线。
 */
type TrendScope = 'live' | Extract<MonitorHistoryRange, '1h' | '24h' | '7d'>;

const SCOPES: Array<{ value: TrendScope; label: string }> = [
  { value: 'live', label: '实时' },
  { value: '1h', label: '1 小时' },
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * 采样窗口不足两点时不画图：单点连不成线，画出来只是一个孤立的点，
 * 反而让人误以为流量掉到 0。
 */
const MIN_POINTS = 2;

/** 分桶秒数的中文口径（纵轴说明与曲线标题共用，避免两处各写一套换算） */
function formatBucket(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${seconds / 60} 分钟`;
  return `${seconds / 3600} 小时`;
}

/** 横轴时间格式：实时到秒，1 小时 / 24 小时到分钟，7 天带上日期 */
function timeFormat(scope: TrendScope): string {
  if (scope === 'live') return 'HH:mm:ss';
  return scope === '7d' ? 'MM-DD HH:mm' : 'HH:mm';
}

/**
 * WebSocket 连接趋势（连接态 / 吞吐 / 连接变化三张图）。
 *
 * 「实时」取 api 进程采样 tick 的环形缓冲（10 秒/点、1 小时、不持久化，服务重启后重新累积）；
 * 其余范围取每分钟落库的分桶历史（可跨重启回看）。两种口径的聚合方式不同
 * （历史瞬时列取桶内末值、增量列取桶内之和），因此各图底部的口径说明随范围切换，
 * 速率一律按当前范围的窗口宽度换算，不混用 intervalSec。
 */
export default function WsTrendCharts({ refetchInterval }: Readonly<{ refetchInterval: number | false }>) {
  const [scope, setScope] = useState<TrendScope>('live');
  const live = scope === 'live';
  const liveQuery = useMonitorWsTrend(live ? refetchInterval : false);
  const historyQuery = useMonitorWsTrendHistory(
    scope === 'live' ? '1h' : scope,
    !live,
  );
  const palette = useChartPalette();
  const query = live ? liveQuery : historyQuery;
  const intervalSec = liveQuery.data?.intervalSec ?? 10;
  /** 换算速率用的窗口宽度：实时是采样间隔，历史是分桶宽度 */
  const windowSec = live ? intervalSec : (historyQuery.data?.bucketSec ?? intervalSec);
  const fmt = timeFormat(scope);

  const points = useMemo(() => {
    if (live) {
      return (liveQuery.data?.points ?? []).map((point) => ({
        time: dayjs(point.t).format(fmt),
        connections: point.connections,
        users: point.users,
        idle: point.idle,
        connects: point.connects,
        disconnects: point.disconnects,
        failed: point.failed,
        sentPerSec: round1(point.sent / intervalSec),
        recvPerSec: round1(point.recv / intervalSec),
      }));
    }
    return (historyQuery.data?.points ?? []).map((point) => ({
      time: dayjs(point.t).format(fmt),
      connections: point.connections,
      users: point.users,
      idle: point.idle,
      connects: point.connects,
      disconnects: point.disconnects,
      failed: point.failed,
      sentPerSec: round1(point.sent / windowSec),
      recvPerSec: round1(point.recv / windowSec),
    }));
  }, [live, liveQuery.data, historyQuery.data, intervalSec, windowSec, fmt]);

  const windowLabel = formatBucket(windowSec);
  const cards: { title: string; lines: TrendLine[]; unit?: string; note: string }[] = [
    {
      title: '连接与用户',
      lines: [
        { field: 'connections', name: '连接数', color: palette.primary },
        { field: 'users', name: '在线用户', color: palette.success },
        { field: 'idle', name: '空闲连接', color: palette.warning },
      ],
      note: live ? '瞬时值；空闲 = 最后活动超过 120 秒' : `每个点取该桶末值（${windowLabel}/桶）；空闲 = 最后活动超过 120 秒`,
    },
    {
      title: '消息速率（条/秒）',
      lines: [
        { field: 'sentPerSec', name: '发送', color: palette.primary },
        { field: 'recvPerSec', name: '接收', color: palette.success },
      ],
      unit: '条/秒',
      note: live ? `由每 ${windowLabel}的收发增量换算` : `按 ${windowLabel}桶内的收发增量换算`,
    },
    {
      title: '连接变化',
      lines: [
        { field: 'connects', name: '新建', color: palette.success },
        { field: 'disconnects', name: '断开', color: palette.danger },
        { field: 'failed', name: '采样失败', color: palette.warning },
      ],
      note: live
        ? `新建 / 断开为每 ${windowLabel}的增量；失败取最近 200 条采样窗口，不是增量`
        : `新建 / 断开为该桶内的合计（${windowLabel}/桶）；失败取桶内采样窗口峰值，不是增量`,
    },
  ];

  const rangePicker = (
    <div className="ws-monitor-trends__range" aria-label="趋势范围">
      {SCOPES.map((item) => (
        <Button
          key={item.value}
          size="small"
          theme={scope === item.value ? 'solid' : 'light'}
          onClick={() => setScope(item.value)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );

  // 采样窗口不足 / 历史为空：保留范围切换器，只把图表区换成一行说明，避免整块区域高度跳动
  if (points.length < MIN_POINTS) {
    const empty = query.isPending
      ? '趋势数据加载中…'
      : live
        ? `趋势采样中（每 ${windowLabel}一点），约 ${windowSec * MIN_POINTS} 秒后出现曲线`
        : `该范围内没有落库的采样点（每分钟记录一次，可直接等待下一分钟或改看实时）`;
    return (
      <div className="ws-monitor-trends">
        <div className="ws-monitor-trends__header">
          <Text type="tertiary" size="small">连接趋势</Text>
          {rangePicker}
        </div>
        <Text type="tertiary" size="small">{empty}</Text>
      </div>
    );
  }

  return (
    <div className="ws-monitor-trends">
      <div className="ws-monitor-trends__header">
        <Text type="tertiary" size="small">
          连接趋势 · {live ? `每 ${windowLabel}采样，保留 1 小时` : `${windowLabel}/点，来自每分钟落库的采样`}
        </Text>
        {rangePicker}
      </div>
      <div className="ws-monitor-trends__grid">
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
            <div className="ws-monitor-trend" key={card.title}>
              <Text strong size="small">{card.title}</Text>
              <LineChart {...spec} options={chartOptions} height={170} />
              <Text type="tertiary" size="small">{card.note}</Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}
