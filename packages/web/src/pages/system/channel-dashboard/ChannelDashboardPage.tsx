import { useMemo } from 'react';
import { Button, Card, Empty, Progress, Skeleton, Table, Typography } from '@douyinfe/semi-ui';
import {
  LineChart,
  PieChart,
  chartOptions,
  makeLineSpec,
  makePieSpec,
  useChartPalette,
} from '@/components/charts';
import { Radio, Users, MessageSquare, Send, Inbox, Clock, RotateCcw, Reply, BarChart3 } from 'lucide-react';
import {
  CHANNEL_CONVERSATION_STATUS_LABELS,
  CHANNEL_AUTO_REPLY_MATCH_LABELS,
  type ChannelDashboard,
  type ChannelDashboardTopReply,
  type ChannelDashboardChannelRank,
} from '@zenith/shared';
import './ChannelDashboardPage.css';
import { useChannelDashboard } from '@/hooks/queries/channel-dashboard';

const { Text, Title } = Typography;

const STATUS_COLORS: Record<keyof ChannelDashboard['statusDist'], string> = {
  open: '#FA8C16',
  processing: '#4A90E2',
  resolved: '#52C41A',
};

interface StatItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  value: string | number;
}

function shortDate(dateStr: string) {
  return dateStr.length >= 5 ? dateStr.slice(5) : dateStr;
}

export default function ChannelDashboardPage() {
  const palette = useChartPalette();
  const dashboardQuery = useChannelDashboard();
  const data = dashboardQuery.data ?? null;
  const loading = dashboardQuery.isFetching;

  const overview = data?.overview;
  const statItems: StatItem[] = [
    { key: 'businessChannelCount', label: '运营号数', icon: <Radio size={20} />, color: '#4A90E2', value: overview?.businessChannelCount ?? '—' },
    { key: 'subscriptionCount', label: '订阅总数', icon: <Users size={20} />, color: '#13C2C2', value: overview?.subscriptionCount ?? '—' },
    { key: 'messageCount', label: '消息总数', icon: <MessageSquare size={20} />, color: '#722ED1', value: overview?.messageCount ?? '—' },
    { key: 'todayPushCount', label: '今日推送', icon: <Send size={20} />, color: '#52C41A', value: overview?.todayPushCount ?? '—' },
    { key: 'openConversationCount', label: '待处理会话', icon: <Inbox size={20} />, color: '#FA8C16', value: overview?.openConversationCount ?? '—' },
    {
      key: 'avgResponseMinutes',
      label: '平均响应',
      icon: <Clock size={20} />,
      color: '#EB2F96',
      value: overview ? (overview.avgResponseMinutes == null ? '—' : `${overview.avgResponseMinutes} 分钟`) : '—',
    },
  ];

  const statusData = useMemo(() => (data
    ? (Object.keys(data.statusDist) as Array<keyof ChannelDashboard['statusDist']>).map((k) => ({
        key: k,
        name: CHANNEL_CONVERSATION_STATUS_LABELS[k],
        value: data.statusDist[k],
        fill: STATUS_COLORS[k],
      }))
    : []), [data]);
  const statusTotal = statusData.reduce((sum, item) => sum + item.value, 0);
  const trendSpec = useMemo(() => makeLineSpec({
    data: data?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'inbound', name: '用户来信', color: '#4A90E2' },
      { field: 'outbound', name: '频道发出', color: '#52C41A' },
    ],
    palette,
    point: true,
    axis: { xLabel: shortDate },
  }), [data, palette]);
  const statusPieSpec = useMemo(() => makePieSpec({
    data: statusData,
    categoryField: 'name',
    valueField: 'value',
    donut: false,
    colors: statusData.map((d) => d.fill),
    palette,
    label: 'percent',
  }), [palette, statusData]);

  const replyColumns = [
    { title: '频道', dataIndex: 'channelName', key: 'channelName', ellipsis: true },
    {
      title: '关键词',
      dataIndex: 'keyword',
      key: 'keyword',
      render: (_: unknown, record: ChannelDashboardTopReply) =>
        record.keyword ?? <Text type="tertiary">{CHANNEL_AUTO_REPLY_MATCH_LABELS[record.matchType]}</Text>,
    },
    {
      title: '命中次数',
      dataIndex: 'hitCount',
      key: 'hitCount',
      width: 110,
      align: 'right' as const,
      render: (v: number) => <Text strong>{v}</Text>,
    },
  ];

  const rankColumns = [
    { title: '运营号', dataIndex: 'channelName', key: 'channelName', ellipsis: true },
    {
      title: '消息数',
      dataIndex: 'messageCount',
      key: 'messageCount',
      width: 110,
      align: 'right' as const,
      render: (v: number) => <Text strong>{v}</Text>,
    },
    {
      title: '订阅数',
      dataIndex: 'subscriberCount',
      key: 'subscriberCount',
      width: 110,
      align: 'right' as const,
    },
  ];

  const chartSkeleton = (
    <div className="channel-dashboard-chart-placeholder">
      <Skeleton active loading placeholder={
        <div style={{ width: '100%', height: 200, padding: '12px 0' }}>
          <Skeleton.Paragraph rows={6} style={{ width: '100%' }} />
        </div>
      } />
    </div>
  );

  return (
    <div className="page-container channel-dashboard-page">
      {/* ===== 顶部标题 + 刷新 ===== */}
      <div className="channel-dashboard-header">
        <div className="channel-dashboard-header__title">
          <BarChart3 size={20} />
          <Title heading={4} style={{ margin: 0 }}>频道数据看板</Title>
        </div>
        <Button
          icon={<RotateCcw size={14} />}
          theme="light"
          onClick={() => void dashboardQuery.refetch()}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      {/* ===== 概览统计卡 ===== */}
      <div className="channel-dashboard-stats-row">
        {statItems.map((item) => (
          <Card key={item.key} className="channel-dashboard-stat-card" bodyStyle={{ padding: '16px 20px' }}>
            {loading ? (
              <Skeleton active loading placeholder={
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <Skeleton.Avatar style={{ width: 44, height: 44, borderRadius: 10 }} />
                  <div style={{ flex: 1 }}>
                    <Skeleton.Title style={{ width: 60, height: 22, marginBottom: 6 }} />
                    <Skeleton.Paragraph rows={1} style={{ width: 80 }} />
                  </div>
                </div>
              } />
            ) : (
              <div className="channel-dashboard-stat">
                <div
                  className="channel-dashboard-stat__icon"
                  style={{ background: `${item.color}18`, color: item.color }}
                >
                  {item.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="channel-dashboard-stat__value">{item.value}</div>
                  <div className="channel-dashboard-stat__label">{item.label}</div>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* ===== 图表区 ===== */}
      <div className="channel-dashboard-charts-row">
        {/* 消息趋势 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>消息趋势（近 7 天）</Text>}
          className="channel-dashboard-card"
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : (
            <LineChart {...trendSpec} options={chartOptions} height={220} />
          )}
        </Card>

        {/* 会话状态分布 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>会话状态分布</Text>}
          className="channel-dashboard-card"
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : statusTotal === 0 ? (
            <div className="channel-dashboard-chart-placeholder"><Empty description="暂无会话数据" /></div>
          ) : (
            <PieChart {...statusPieSpec} options={chartOptions} height={220} />
          )}
        </Card>

        {/* 群发已读率 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>群发已读率</Text>}
          className="channel-dashboard-card"
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : (
            <div className="channel-dashboard-readrate">
              <Progress
                type="circle"
                percent={Math.round(data?.readRate ?? 0)}
                width={140}
                strokeWidth={8}
                format={(p) => <span style={{ fontSize: 24, fontWeight: 600 }}>{p}%</span>}
              />
              <span className="channel-dashboard-readrate__hint">定向消息已读率</span>
            </div>
          )}
        </Card>
      </div>

      {/* ===== 列表区 ===== */}
      <div className="channel-dashboard-lists-row">
        {/* 热门自动回复 */}
        <Card
          title={
            <div className="channel-dashboard-header__title">
              <Reply size={14} />
              <Text strong style={{ fontSize: 14 }}>热门自动回复</Text>
            </div>
          }
          className="channel-dashboard-card"
          bodyStyle={{ padding: '4px 8px 8px' }}
        >
          <Table<ChannelDashboardTopReply>
            columns={replyColumns}
            dataSource={data?.topReplies ?? []}
            rowKey="id"
            size="small"
            pagination={false}
            loading={loading}
            empty={<Empty description="暂无自动回复命中记录" />}
          />
        </Card>

        {/* 运营号消息排行 */}
        <Card
          title={
            <div className="channel-dashboard-header__title">
              <BarChart3 size={14} />
              <Text strong style={{ fontSize: 14 }}>运营号消息排行</Text>
            </div>
          }
          className="channel-dashboard-card"
          bodyStyle={{ padding: '4px 8px 8px' }}
        >
          <Table<ChannelDashboardChannelRank>
            columns={rankColumns}
            dataSource={data?.channelRank ?? []}
            rowKey="channelId"
            size="small"
            pagination={false}
            loading={loading}
            empty={<Empty description="暂无运营号数据" />}
          />
        </Card>
      </div>
    </div>
  );
}
