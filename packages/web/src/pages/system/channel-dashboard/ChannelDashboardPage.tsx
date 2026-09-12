import { useMemo } from 'react';
import { Button, Card, Empty, Progress, Skeleton, Table, Typography } from '@douyinfe/semi-ui';
import {
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
  chartOptions,
  makeAreaSpec,
  makeBarSpec,
  makeLineSpec,
  makePieSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { Radio, Users, MessageSquare, Send, Inbox, Clock, RotateCcw, Reply, BarChart3 } from 'lucide-react';
import {
  CHANNEL_CONVERSATION_STATUS_LABELS,
  CHANNEL_AUTO_REPLY_MATCH_LABELS,
  CHANNEL_MESSAGE_TYPE_LABELS,
} from '@zenith/shared/messaging';
import type {
  ChannelDashboard,
  ChannelDashboardTopReply,
  ChannelDashboardChannelRank,
  ChannelMessageType,
  ChannelAutoReplyMatchType,
} from '@zenith/shared/messaging';
import './ChannelDashboardPage.css';
import { useChannelDashboard } from '@/hooks/queries/channel-dashboard';
import { shortDate } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text, Title } = Typography;

const STATUS_COLORS: Record<keyof ChannelDashboard['statusDist'], string> = {
  open: '#FA8C16',
  processing: '#4A90E2',
  resolved: '#52C41A',
};

const MESSAGE_TYPE_COLORS: Record<ChannelMessageType, string> = {
  text: '#4A90E2',
  image: '#52C41A',
  news: '#FA8C16',
  card: '#722ED1',
};

const MATCH_TYPE_COLORS: Record<ChannelAutoReplyMatchType, string> = {
  subscribe: '#52C41A',
  keyword: '#4A90E2',
  default: '#8B9AA7',
};

interface StatItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  value: string | number;
}

export default function ChannelDashboardPage() {
  const palette = useChartPalette();
  const dashboardQuery = useChannelDashboard();
  const data = dashboardQuery.data ?? null;
  const loading = dashboardQuery.isFetching;

  const overview = data?.overview;
  const statItems: StatItem[] = [
    { key: 'businessChannelCount', label: '运营号数', icon: <Radio size={20} />, color: '#4A90E2', value: overview?.businessChannelCount ?? EMPTY_PLACEHOLDER },
    { key: 'subscriptionCount', label: '订阅总数', icon: <Users size={20} />, color: '#13C2C2', value: overview?.subscriptionCount ?? EMPTY_PLACEHOLDER },
    { key: 'messageCount', label: '消息总数', icon: <MessageSquare size={20} />, color: '#722ED1', value: overview?.messageCount ?? EMPTY_PLACEHOLDER },
    { key: 'todayPushCount', label: '今日推送', icon: <Send size={20} />, color: '#52C41A', value: overview?.todayPushCount ?? EMPTY_PLACEHOLDER },
    { key: 'openConversationCount', label: '待处理会话', icon: <Inbox size={20} />, color: '#FA8C16', value: overview?.openConversationCount ?? EMPTY_PLACEHOLDER },
    {
      key: 'avgResponseMinutes',
      label: '平均响应',
      icon: <Clock size={20} />,
      color: '#EB2F96',
      value: overview ? (overview.avgResponseMinutes == null ? EMPTY_PLACEHOLDER : `${overview.avgResponseMinutes} 分钟`) : EMPTY_PLACEHOLDER,
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

  const subscriptionTrendSpec = useMemo(() => makeAreaSpec({
    data: data?.subscriptionTrend ?? [],
    xField: 'date',
    series: [{ field: 'count', name: '新增订阅', color: '#13C2C2' }],
    palette,
    axis: { xLabel: shortDate },
    tooltip: { title: (x) => `日期：${x}`, value: (v) => `${v} 人` },
  }), [data, palette]);

  const hourlySpec = useMemo(() => makeBarSpec({
    data: data?.hourlyDist ?? [],
    xField: 'hour',
    series: [{ field: 'count', name: '消息数', color: '#722ED1' }],
    palette,
    axis: { xLabel: (v) => `${String(v).padStart(2, '0')}h` },
    tooltip: {
      title: (x) => `${String(x).padStart(2, '0')}:00 – ${String(x).padStart(2, '0')}:59`,
      value: (v) => `${v} 条`,
    },
  }), [data, palette]);

  const messageTypeData = useMemo(() => (data?.messageTypeDist ?? []).map((d) => ({
    ...d,
    name: CHANNEL_MESSAGE_TYPE_LABELS[d.type],
    fill: MESSAGE_TYPE_COLORS[d.type],
  })), [data]);
  const messageTypeSpec = useMemo(() => makePieSpec({
    data: messageTypeData,
    categoryField: 'name',
    valueField: 'count',
    donut: true,
    colors: messageTypeData.map((d) => d.fill),
    palette,
    label: 'none',
    valueUnit: '条',
  }), [messageTypeData, palette]);

  const ratingDist = data?.ratingDist;
  const ratingData = useMemo(() => (ratingDist?.dist ?? []).map((d) => ({ ...d, name: `${d.rating} 星` })), [ratingDist]);
  const ratingTotal = ratingData.reduce((sum, d) => sum + d.count, 0);
  const ratingSpec = useMemo(() => makeBarSpec({
    data: ratingData,
    xField: 'name',
    series: [{ field: 'count', name: '会话数', color: '#FA8C16' }],
    palette,
    showLabel: true,
    tooltip: { value: (v) => `${v} 个会话` },
  }), [ratingData, palette]);

  const matchDistData = useMemo(() => (data?.autoReplyMatchDist ?? []).map((d) => ({
    ...d,
    name: CHANNEL_AUTO_REPLY_MATCH_LABELS[d.matchType],
    fill: MATCH_TYPE_COLORS[d.matchType],
  })), [data]);
  const matchDistSpec = useMemo(() => makePieSpec({
    data: matchDistData,
    categoryField: 'name',
    valueField: 'count',
    donut: true,
    colors: matchDistData.map((d) => d.fill),
    palette,
    label: 'percent',
    valueUnit: '次',
  }), [matchDistData, palette]);

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
    <div className="page-container channel-dashboard-page zx-flat-panels">
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
      <StatGrid minItemWidth={170}>
        {statItems.map((item) => (
          loading ? (
            <div key={item.key}>
              <Skeleton active loading placeholder={
                <div>
                  <Skeleton.Title style={{ width: 64, height: 26, marginBottom: 10 }} />
                  <Skeleton.Paragraph rows={1} style={{ width: 80, marginBottom: 0 }} />
                </div>
              } />
            </div>
          ) : (
            <StatCard
              key={item.key}
              title={item.label}
              value={item.value}
              icon={item.icon}
              accent={item.color}
            />
          )
        ))}
      </StatGrid>

      {/* ===== 图表区 ===== */}
      <div className="chart-grid chart-grid--3 channel-dashboard-charts-row">
        {/* 消息趋势 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>消息趋势（近 7 天）</Text>}
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : (
            <LineChart {...trendSpec} options={chartOptions} height={220} />
          )}
        </Card>

        {/* 会话状态分布 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>会话状态分布</Text>}
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

      {/* ===== 增长与活跃 ===== */}
      <div className="chart-grid chart-grid--3">
        {/* 订阅增长趋势 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>订阅增长趋势（近 30 天）</Text>}
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : (
            <AreaChart {...subscriptionTrendSpec} options={chartOptions} height={220} />
          )}
        </Card>

        {/* 按小时消息分布 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>按小时消息分布（近 7 天）</Text>}
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : (
            <BarChart {...hourlySpec} options={chartOptions} height={220} />
          )}
        </Card>

        {/* 消息类型分布 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>消息类型分布</Text>}
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : messageTypeData.length === 0 ? (
            <div className="channel-dashboard-chart-placeholder"><Empty description="暂无已发送消息" /></div>
          ) : (
            <PieChart {...messageTypeSpec} options={chartOptions} height={220} />
          )}
        </Card>
      </div>

      {/* ===== 服务质量 ===== */}
      <div className="chart-grid">
        {/* 会话评分分布 */}
        <Card
          title={
            <div className="channel-dashboard-card-title">
              <Text strong style={{ fontSize: 14 }}>会话评分分布</Text>
              {!loading && ratingDist?.avgRating != null && (
                <Text type="tertiary" size="small">平均 {ratingDist.avgRating} 分</Text>
              )}
            </div>
          }
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : ratingTotal === 0 ? (
            <div className="channel-dashboard-chart-placeholder"><Empty description="暂无评分数据" /></div>
          ) : (
            <BarChart {...ratingSpec} options={chartOptions} height={220} />
          )}
        </Card>

        {/* 自动回复命中类型占比 */}
        <Card
          title={<Text strong style={{ fontSize: 14 }}>自动回复命中类型占比</Text>}
          bodyStyle={{ padding: '12px 16px 8px' }}
        >
          {loading ? chartSkeleton : matchDistData.length === 0 ? (
            <div className="channel-dashboard-chart-placeholder"><Empty description="暂无命中记录" /></div>
          ) : (
            <PieChart {...matchDistSpec} options={chartOptions} height={220} />
          )}
        </Card>
      </div>

      {/* ===== 列表区 ===== */}
      <div className="chart-grid">
        {/* 热门自动回复 */}
        <Card
          title={
            <div className="channel-dashboard-header__title">
              <Reply size={14} />
              <Text strong style={{ fontSize: 14 }}>热门自动回复</Text>
            </div>
          }
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
