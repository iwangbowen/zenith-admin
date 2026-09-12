import { useMemo } from 'react';
import { Card, Spin, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CommonChart, chartOptions, makeMixedBarLineSpec, useChartPalette, StatCard, StatGrid } from '@/components/charts';
import { Bot, CircleCheck, Coins, Gauge, MessageCircle, Users, Wallet } from 'lucide-react';
import { useListSearch } from '@/hooks/useListSearch';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import { formatDateRangeValuesForApi, shortDate } from '@/utils/date';
import { aiUsageKeys, useAiUsageStats } from '@/hooks/queries/ai-usage';
import type { AiUsageByModel, AiUsageByUser } from '@/hooks/queries/ai-usage';
import { DateRangeFilter } from '@/components/search-filters';
import { formatDurationMs } from '@/utils/format';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

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

/** 分 → 元显示 */
function formatCostYuan(fen: number | null | undefined) {
  if (fen == null) return EMPTY_PLACEHOLDER;
  return `¥${(fen / 100).toFixed(2)}`;
}

export default function AiUsagePage() {
  // 区间必选：清空时回到默认区间；重置重新取「默认区间」
  const { bind, submittedParams, handleSearch, handleReset } = useListSearch<{ range: [Date, Date] }>({
    defaults: () => ({ range: getDefaultRange() }),
    listKey: aiUsageKeys.statsRoot,
  });
  const palette = useChartPalette();
  const [startDate, endDate] = formatDateRangeValuesForApi(submittedParams.range);
  const statsQuery = useAiUsageStats({ startDate, endDate });
  const stats = statsQuery.data ?? null;

  const modelData = useMemo(
    () => [...(stats?.byModel ?? [])].sort((a, b) => b.totalTokens - a.totalTokens),
    [stats?.byModel],
  );

  const userData = useMemo(
    () => [...(stats?.byUser ?? [])].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 10),
    [stats?.byUser],
  );

  const modelColumns: ColumnProps<AiUsageByModel>[] = [
    { title: '模型', dataIndex: 'model', width: 180 },
    { title: '供应商', dataIndex: 'provider', width: 140, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    { title: '回复数', dataIndex: 'messages', width: 90, align: 'right', render: (value: number) => formatNumber(value) },
    { title: '输入Token', dataIndex: 'tokensInput', width: 120, align: 'right', render: (value: number) => formatNumber(value) },
    { title: '输出Token', dataIndex: 'tokensOutput', width: 120, align: 'right', render: (value: number) => formatNumber(value) },
    { title: '总Token', dataIndex: 'totalTokens', width: 120, align: 'right', render: (value: number) => formatNumber(value) },
    { title: '首字延迟', dataIndex: 'avgTtftMs', width: 100, align: 'right', render: (value: number | null) => formatDurationMs(value) },
    { title: '预估成本', dataIndex: 'costFen', width: 110, render: (value: number | null) => formatCostYuan(value) },
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
    { title: '对话数', dataIndex: 'conversations', width: 120, align: 'right', render: (value: number) => formatNumber(value) },
    { title: '回复数', dataIndex: 'messages', width: 120, align: 'right', render: (value: number) => formatNumber(value) },
    { title: '总Token', dataIndex: 'totalTokens', width: 140, align: 'right', render: (value: number) => formatNumber(value) },
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

  return (
    <div className="page-container zx-flat-panels">
      <ListSearchToolbar
        filters={<DateRangeFilter type="dateRange" {...bind('range', (value: [Date, Date] | null) => value ?? getDefaultRange())} />}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="用量筛选"
      />

      <Spin spinning={statsQuery.isFetching}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StatGrid>
              <StatCard title="对话总数" value={formatNumber(stats?.overview.totalConversations ?? 0)} icon={<MessageCircle size={20} />} accent="var(--semi-color-primary)" />

              <StatCard title="回复消息数" value={formatNumber(stats?.overview.totalMessages ?? 0)} icon={<Bot size={20} />} accent="var(--semi-color-success)" />

              <StatCard
                title="Token 总数"
                value={formatNumber(stats?.overview.totalTokens ?? 0)}
                icon={<Coins size={20} />}
                accent="var(--semi-color-warning)"
                sub={`输入 ${formatNumber(stats?.overview.tokensInput)} / 输出 ${formatNumber(stats?.overview.tokensOutput)}`}
              />

              <StatCard title="活跃用户数" value={formatNumber(stats?.overview.activeUsers ?? 0)} icon={<Users size={20} />} accent="var(--semi-color-data-2)" />

              <StatCard
                title="预估成本"
                value={formatCostYuan(stats?.overview.totalCostFen ?? 0)}
                icon={<Wallet size={20} />}
                accent="var(--semi-color-data-3)"
                sub="未配置单价的模型不计入"
              />

              <StatCard
                title="平均首字延迟"
                value={formatDurationMs(stats?.overview.avgTtftMs)}
                icon={<Gauge size={20} />}
                accent="var(--semi-color-data-4)"
              />

              <StatCard
                title="请求成功率"
                value={stats?.overview.successRate == null ? EMPTY_PLACEHOLDER : `${stats.overview.successRate}%`}
                icon={<CircleCheck size={20} />}
                accent="var(--semi-color-success)"
              />
            
          </StatGrid>

          <Card title={<Text strong>每日趋势</Text>} bodyStyle={{ padding: '12px 16px 8px' }}>
            <CommonChart {...trendSpec} options={chartOptions} height={280} />
          </Card>

          <div className="chart-grid">
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
          </div>
        </div>
      </Spin>
    </div>
  );
}
