/** 实时看板：在线人数 / 事件脉冲 / 热门在线页面 / 最新事件，WebSocket 推送即时刷新 */
import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Tag, Typography } from '@douyinfe/semi-ui';
import { Eye, RefreshCcw, Users, Zap } from 'lucide-react';
import { AreaChart, chartOptions, makeAreaSpec, useChartPalette, StatCard, StatGrid } from '@/components/charts';
import { formatDateTime } from '@/utils/date';
import { useWebSocket } from '@/hooks/useWebSocket';
import { analyticsKeys, useAnalyticsRealtime } from '@/hooks/queries/analytics';
import { numberText, sectionStyle } from './analytics-format';
import { ChartPlaceholder, SectionHeader } from './analytics-shared';

export default function AnalyticsRealtimeTab() {
  const palette = useChartPalette();
  const queryClient = useQueryClient();
  const realtimeQuery = useAnalyticsRealtime();
  const data = realtimeQuery.data ?? null;
  const loading = realtimeQuery.isFetching;

  // 服务端有新事件入库时推送信号，即时刷新（10s 轮询保留兜底）
  useWebSocket(useCallback((msg) => {
    if (msg.type === 'analytics:ingest') void queryClient.invalidateQueries({ queryKey: analyticsKeys.realtime });
  }, [queryClient]));

  const realtimeAreaSpec = useMemo(() => makeAreaSpec({
    data: data?.perMinute ?? [],
    xField: 'minute',
    series: [{ field: 'events', name: '事件数', color: palette.primary }],
    palette,
  }), [data?.perMinute, palette]);

  return (
    <div style={sectionStyle}>
      <SectionHeader title="实时看板" description="事件推送即时刷新 · 每 10 秒轮询兜底" extra={<Button icon={<RefreshCcw size={14} />} onClick={() => void realtimeQuery.refetch()} loading={loading}>刷新</Button>} />
      <StatGrid minItemWidth={190}>
        <StatCard title="实时在线" value={numberText(data?.activeUsers ?? 0)} icon={<Users size={19} />} accent="#22c55e" />
        <StatCard title="近30分钟浏览" value={numberText(data?.pageViewsLast30Min ?? 0)} icon={<Eye size={19} />} accent={palette.primary} />
        <StatCard title="近1分钟事件" value={numberText(data?.eventsLastMinute ?? 0)} icon={<Zap size={19} />} accent="#f59e0b" />
      </StatGrid>
      <div className="chart-grid chart-grid--aside">
        <Card title="事件脉冲" bodyStyle={{ padding: 16 }}>
          {!data?.perMinute.length ? <ChartPlaceholder loading={loading} /> : (
            <AreaChart {...realtimeAreaSpec} options={chartOptions} height={300} />
          )}
        </Card>
        <Card title="热门在线页面" bodyStyle={{ padding: 16 }}>
          {!data?.topPages.length ? <ChartPlaceholder loading={loading} description="暂无在线页面" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.topPages.map((page) => (
                <div key={page.pagePath} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis={{ showTooltip: true }}>{page.pageTitle || page.pagePath}</Typography.Text>
                    <div><Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{page.pagePath}</Typography.Text></div>
                  </div>
                  <Tag color="blue">{page.active} 人</Tag>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card title="最新事件" bodyStyle={{ padding: 16 }}>
        {!data?.recentEvents.length ? <ChartPlaceholder loading={loading} description="暂无事件" /> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {data.recentEvents.map((event, index) => (
              <div key={`${event.createdAt}-${index}`} style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr) 140px 170px', gap: 12, alignItems: 'center' }}>
                <Tag color="green">{event.eventType}</Tag>
                <Typography.Text ellipsis={{ showTooltip: true }}>{event.eventName || event.pagePath}</Typography.Text>
                <Typography.Text type="tertiary">{event.username || '匿名访客'}</Typography.Text>
                <Typography.Text type="tertiary">{formatDateTime(event.createdAt)}</Typography.Text>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
