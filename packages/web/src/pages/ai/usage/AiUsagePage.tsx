import { useMemo, useState } from 'react';
import { Button, Card, DatePicker, Row, Col, Spin, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CommonChart, chartOptions, makeMixedBarLineSpec, useChartPalette } from '@/components/charts';
import { Bot, Coins, MessageCircle, Search, RotateCcw, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateForApi } from '@/utils/date';
import { aiUsageKeys, useAiUsageStats } from '@/hooks/queries/ai-usage';
import type { AiUsageByModel, AiUsageByUser } from '@/hooks/queries/ai-usage';

const { Text } = Typography;

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
  const queryClient = useQueryClient();
  const [draftRange, setDraftRange] = useState<[Date, Date]>(getDefaultRange);
  const [submittedRange, setSubmittedRange] = useState<[Date, Date]>(draftRange);
  const palette = useChartPalette();
  const statsQuery = useAiUsageStats({
    startDate: formatDateForApi(submittedRange[0]),
    endDate: formatDateForApi(submittedRange[1]),
  });
  const stats = statsQuery.data ?? null;

  function handleSearch() {
    setSubmittedRange(draftRange);
    void queryClient.invalidateQueries({ queryKey: aiUsageKeys.statsRoot });
  }

  function handleReset() {
    const nextRange = getDefaultRange();
    setDraftRange(nextRange);
    setSubmittedRange(nextRange);
    void queryClient.invalidateQueries({ queryKey: aiUsageKeys.statsRoot });
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

  const trendSpec = makeMixedBarLineSpec({
    data: trendChartData,
    dataId: 'aiTrend',
    xField: 'shortDate',
    palette,
    bar: { id: 'messages', field: 'messages', name: '消息数', color: '#4A90E2' },
    line: { id: 'tokens', field: 'totalTokens', name: '总Token', color: '#FA8C16' },
    axis: {
      leftLabel: formatNumber,
      rightLabel: formatNumber,
    },
    tooltip: {
      titleField: 'date',
      title: (value) => `日期：${value}`,
      barValue: formatNumber,
      lineValue: formatNumber,
    },
  });

  const renderDateRangeFilter = () => (
    <DatePicker
      type="dateRange"
      placeholder={['开始日期', '结束日期']}
      value={draftRange}
      onChange={(value) => {
        if (Array.isArray(value) && value.length >= 2 && value[0] instanceof Date && value[1] instanceof Date) {
          setDraftRange([value[0], value[1]]);
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

      <Spin spinning={statsQuery.isFetching}>
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
            <CommonChart {...trendSpec} options={chartOptions} height={280} />
          </Card>

          <Row gutter={[16, 16]} type="flex">
            <Col xs={24} xl={12}>
              <Card title={<Text strong>按模型用量</Text>} bodyStyle={{ padding: 12 }}>
                <ConfigurableTable
                  bordered
                  columns={modelColumns}
                  dataSource={modelData}
                  loading={statsQuery.isFetching}
                  rowKey="model"
                  size="small"
                  pagination={false}
                  empty="暂无模型用量"
                  onRefresh={() => void statsQuery.refetch()}
                  refreshLoading={statsQuery.isFetching}
                />
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title={<Text strong>用量 Top 10 用户</Text>} bodyStyle={{ padding: 12 }}>
                <ConfigurableTable
                  bordered
                  columns={userColumns}
                  dataSource={userData}
                  loading={statsQuery.isFetching}
                  rowKey="userId"
                  size="small"
                  pagination={false}
                  empty="暂无用户用量"
                  onRefresh={() => void statsQuery.refetch()}
                  refreshLoading={statsQuery.isFetching}
                />
              </Card>
            </Col>
          </Row>
        </div>
      </Spin>
    </div>
  );
}
