import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Row, Col, Spin, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bot, Coins, MessageCircle, Search, RotateCcw, Users } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateForApi } from '@/utils/date';
import { request } from '@/utils/request';

const { Text } = Typography;

interface AiUsageOverview {
  totalConversations: number;
  totalMessages: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  activeUsers: number;
}

interface AiUsageByModel {
  model: string;
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
}

interface AiUsageByUser {
  userId: number;
  username: string;
  nickname: string;
  conversations: number;
  messages: number;
  totalTokens: number;
}

interface AiUsageTrend {
  date: string;
  messages: number;
  totalTokens: number;
}

interface AiUsageStats {
  overview: AiUsageOverview;
  byModel: AiUsageByModel[];
  byUser: AiUsageByUser[];
  trend: AiUsageTrend[];
}

function getDefaultRange(): [Date, Date] {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return [start, end];
}

function formatNumber(value: number | null | undefined) {
  const text = String(Math.trunc(value ?? 0));
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function shortDate(date: string) {
  return date.slice(5);
}

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  secondary?: string;
}

function StatCard({ title, value, icon, color, secondary }: StatCardProps) {
  return (
    <Card bodyStyle={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: `${color}18`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: 'var(--semi-color-text-0)' }}>
            {formatNumber(value)}
          </div>
          <Text type="tertiary" size="small">{title}</Text>
          {secondary && <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 2 }}>{secondary}</Text>}
        </div>
      </div>
    </Card>
  );
}

export default function AiUsagePage() {
  const [dateRange, setDateRange] = useState<[Date, Date]>(getDefaultRange);
  const [stats, setStats] = useState<AiUsageStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async (range = dateRange) => {
    const [startDate, endDate] = range;
    const query = new URLSearchParams({
      startDate: formatDateForApi(startDate),
      endDate: formatDateForApi(endDate),
    }).toString();
    setLoading(true);
    try {
      const res = await request.get<AiUsageStats>(`/api/ai/usage/stats?${query}`);
      if (res.code === 0) setStats(res.data);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    void fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() {
    void fetchStats(dateRange);
  }

  function handleReset() {
    const nextRange = getDefaultRange();
    setDateRange(nextRange);
    void fetchStats(nextRange);
  }

  const modelData = useMemo(
    () => [...(stats?.byModel ?? [])].sort((a, b) => b.totalTokens - a.totalTokens),
    [stats?.byModel],
  );

  const userData = useMemo(
    () => [...(stats?.byUser ?? [])].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 10),
    [stats?.byUser],
  );

  const modelColumns: ColumnProps<AiUsageByModel>[] = [
    { title: '模型', dataIndex: 'model', width: 220 },
    { title: '消息数', dataIndex: 'messages', width: 120, render: (value: number) => formatNumber(value) },
    { title: '输入Token', dataIndex: 'tokensInput', width: 140, render: (value: number) => formatNumber(value) },
    { title: '输出Token', dataIndex: 'tokensOutput', width: 140, render: (value: number) => formatNumber(value) },
    { title: '总Token', dataIndex: 'totalTokens', width: 140, render: (value: number) => formatNumber(value) },
  ];

  const userColumns: ColumnProps<AiUsageByUser>[] = [
    {
      title: '用户',
      dataIndex: 'nickname',
      width: 220,
      render: (_: unknown, record) => (
        <div>
          <Text>{record.nickname || record.username}</Text>
          <Text type="tertiary" size="small" style={{ display: 'block' }}>{record.username}</Text>
        </div>
      ),
    },
    { title: '对话数', dataIndex: 'conversations', width: 120, render: (value: number) => formatNumber(value) },
    { title: '消息数', dataIndex: 'messages', width: 120, render: (value: number) => formatNumber(value) },
    { title: '总Token', dataIndex: 'totalTokens', width: 140, render: (value: number) => formatNumber(value) },
  ];

  const trendChartData = (stats?.trend ?? []).map((item) => ({ ...item, shortDate: shortDate(item.date) }));

  const renderDateRangeFilter = () => (
    <DatePicker
      type="dateRange"
      placeholder={['开始日期', '结束日期']}
      value={dateRange}
      onChange={(value) => {
        if (Array.isArray(value) && value.length >= 2 && value[0] instanceof Date && value[1] instanceof Date) {
          setDateRange([value[0], value[1]]);
        }
      }}
      style={{ width: 300 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
      查询
    </Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
      重置
    </Button>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderDateRangeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={renderSearchButton()}
        mobileFilters={renderDateRangeFilter()}
        filterTitle="用量筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <Spin spinning={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Row gutter={[16, 16]} type="flex">
            <Col xs={24} sm={12} xl={6}>
              <StatCard title="对话总数" value={stats?.overview.totalConversations ?? 0} icon={<MessageCircle size={20} />} color="#4A90E2" />
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <StatCard title="消息总数" value={stats?.overview.totalMessages ?? 0} icon={<Bot size={20} />} color="#52C41A" />
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <StatCard
                title="Token 总数"
                value={stats?.overview.totalTokens ?? 0}
                icon={<Coins size={20} />}
                color="#FA8C16"
                secondary={`输入 ${formatNumber(stats?.overview.tokensInput)} / 输出 ${formatNumber(stats?.overview.tokensOutput)}`}
              />
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <StatCard title="活跃用户数" value={stats?.overview.activeUsers ?? 0} icon={<Users size={20} />} color="#722ED1" />
            </Col>
          </Row>

          <Card title={<Text strong>每日趋势</Text>} bodyStyle={{ padding: '12px 16px 8px' }}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trendChartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--semi-color-border)" />
                <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(_, payload) => `日期：${payload?.[0]?.payload?.date ?? ''}`}
                  formatter={(value, name) => [formatNumber(Number(value)), name === 'messages' ? '消息数' : '总Token']}
                />
                <Legend formatter={(value) => (value === 'messages' ? '消息数' : '总Token')} wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="messages" fill="#4A90E2" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="totalTokens" fill="#FA8C16" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Row gutter={[16, 16]} type="flex">
            <Col xs={24} xl={12}>
              <Card title={<Text strong>按模型用量</Text>} bodyStyle={{ padding: 12 }}>
                <ConfigurableTable
                  bordered
                  columns={modelColumns}
                  dataSource={modelData}
                  loading={loading}
                  rowKey="model"
                  size="small"
                  pagination={false}
                  empty="暂无模型用量"
                  onRefresh={() => void fetchStats()}
                  refreshLoading={loading}
                />
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title={<Text strong>用量 Top 10 用户</Text>} bodyStyle={{ padding: 12 }}>
                <ConfigurableTable
                  bordered
                  columns={userColumns}
                  dataSource={userData}
                  loading={loading}
                  rowKey="userId"
                  size="small"
                  pagination={false}
                  empty="暂无用户用量"
                  onRefresh={() => void fetchStats()}
                  refreshLoading={loading}
                />
              </Card>
            </Col>
          </Row>
        </div>
      </Spin>
    </div>
  );
}
