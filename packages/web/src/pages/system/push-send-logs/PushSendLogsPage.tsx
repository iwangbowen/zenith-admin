/**
 * App 推送发送记录页(只读日志:事件派发与测试发送的成败留痕)。
 * 顶部统计:窗口汇总卡 + 按日趋势(送达/点击来自供应商回执)。
 */
import { useMemo, useState } from 'react';
import { Card, Select, Skeleton, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CheckCircle2, MousePointerClick, Send, XCircle } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import {
  PUSH_DELIVERY_STATUS_LABELS,
  PUSH_PROVIDER_LABELS,
  SEND_SOURCE_LABELS,
  SEND_STATUSES,
  type PushDeliveryStatus,
  type PushProvider,
  type PushSendLog,
  type SendSource,
  type SendStatus,
} from '@zenith/shared/messaging';
import {
  LineChart,
  StatCard,
  StatGrid,
  chartOptions,
  makeLineSpec,
  useChartPalette,
} from '@/components/charts';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { DateRangeFilter, KeywordInput, StatusSelect } from '@/components/search-filters';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { EMPTY_PLACEHOLDER, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { useListSearch } from '@/hooks/useListSearch';
import { pushSendLogKeys, usePushSendLogList, usePushSendLogStats } from '@/hooks/queries/push';
import { SEND_LOG_STATUS_OPTIONS } from '../send-log-constants';

const { Text } = Typography;

const STATUS_COLORS: Record<SendStatus, 'orange' | 'green' | 'red'> = {
  pending: 'orange',
  success: 'green',
  failed: 'red',
};

const DELIVERY_COLORS: Record<PushDeliveryStatus, 'green' | 'blue'> = {
  delivered: 'green',
  clicked: 'blue',
};

interface SearchParams {
  keyword: string;
  status?: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, timeRange: null };

const STATS_DAYS_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 14, label: '近 14 天' },
  { value: 30, label: '近 30 天' },
];

function shortDate(dateStr: string) {
  return dateStr.length >= 5 ? dateStr.slice(5) : dateStr;
}

function PushStatsSection() {
  const palette = useChartPalette();
  const [days, setDays] = useState(14);
  const statsQuery = usePushSendLogStats(days);
  const stats = statsQuery.data ?? null;
  const loading = statsQuery.isFetching;

  const trendSpec = useMemo(() => makeLineSpec({
    data: stats?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'success', name: '成功', color: '#52C41A' },
      { field: 'failed', name: '失败', color: '#F5222D' },
      { field: 'delivered', name: '送达', color: '#4A90E2' },
      { field: 'clicked', name: '点击', color: '#722ED1' },
    ],
    palette,
    axis: { xLabel: shortDate },
  }), [stats, palette]);

  const statItems = [
    { key: 'total', label: '总发送', icon: <Send size={19} />, color: '#4A90E2', value: stats?.totals.total },
    { key: 'success', label: '成功', icon: <CheckCircle2 size={19} />, color: '#52C41A', value: stats?.totals.success },
    { key: 'failed', label: '失败', icon: <XCircle size={19} />, color: '#F5222D', value: stats?.totals.failed },
    { key: 'delivered', label: '已送达', icon: <CheckCircle2 size={19} />, color: '#13C2C2', value: stats?.totals.delivered },
    { key: 'clicked', label: '已点击', icon: <MousePointerClick size={19} />, color: '#722ED1', value: stats?.totals.clicked },
  ];

  return (
    <>
      <StatGrid minItemWidth={150}>
        {statItems.map((item) => (
          <StatCard
            key={item.key}
            title={item.label}
            value={item.value ?? EMPTY_PLACEHOLDER}
            icon={item.icon}
            accent={item.color}
          />
        ))}
      </StatGrid>
      <Card
        title={<Text strong style={{ fontSize: 14 }}>推送趋势</Text>}
        headerExtraContent={(
          <Select value={days} onChange={(v) => setDays(v as number)} optionList={STATS_DAYS_OPTIONS} size="small" style={{ width: 110 }} />
        )}
        bodyStyle={{ padding: '12px 16px 8px' }}
        style={{ margin: '12px 0' }}
      >
        {loading && !stats ? (
          <Skeleton active loading placeholder={<Skeleton.Image style={{ height: 200, width: '100%' }} />} style={{ width: '100%' }} />
        ) : (
          <LineChart {...trendSpec} options={chartOptions} height={200} />
        )}
      </Card>
    </>
  );
}

export default function PushSendLogsPage() {
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: pushSendLogKeys.lists });

  const listQuery = usePushSendLogList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(SEND_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns: ColumnProps<PushSendLog>[] = [
    { title: '应用', dataIndex: 'appName', width: 120, render: renderEllipsis },
    { title: '标题', dataIndex: 'title', width: 200, render: renderEllipsis },
    { title: '内容', dataIndex: 'content', minWidth: 260, render: renderEllipsis },
    {
      title: '事件', dataIndex: 'eventKey', width: 180,
      render: (v: string | null) => (v ? <Text code>{v}</Text> : EMPTY_PLACEHOLDER),
    },
    {
      title: '收件人', dataIndex: 'subjectName', width: 120,
      render: (_: unknown, record: PushSendLog) => record.subjectName
        ?? (record.subjectType ? `${record.subjectType}#${record.subjectId}` : EMPTY_PLACEHOLDER),
    },
    { title: '设备数', dataIndex: 'deviceCount', width: 80 },
    {
      title: '供应商', dataIndex: 'provider', width: 100,
      render: (v: PushProvider) => PUSH_PROVIDER_LABELS[v],
    },
    {
      title: '来源', dataIndex: 'source', width: 80,
      render: (v: SendSource) => SEND_SOURCE_LABELS[v],
    },
    {
      title: '送达状态', dataIndex: 'deliveryStatus', width: 100,
      render: (v: PushDeliveryStatus | null, record: PushSendLog) => {
        if (!v) return EMPTY_PLACEHOLDER;
        const detail = [
          record.deliveredAt ? `送达 ${record.deliveredAt}` : null,
          record.clickedAt ? `点击 ${record.clickedAt}` : null,
        ].filter(Boolean).join(' / ');
        return (
          <Tooltip content={detail || undefined}>
            <Tag color={DELIVERY_COLORS[v]} size="small">{PUSH_DELIVERY_STATUS_LABELS[v]}</Tag>
          </Tooltip>
        );
      },
    },
    { title: '错误信息', dataIndex: 'errorMsg', width: 220, render: renderEllipsis },
    dateTimeColumn('发送时间', 'sentAt'),
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: SendStatus) => <Tag color={STATUS_COLORS[v]} size="small">{SEND_LOG_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v}</Tag>,
    },
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索标题 / 内容 / 事件..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={SEND_LOG_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderTimeRangeFilter = () => (
    <DateRangeFilter
      value={draftParams.timeRange}
      onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v }))}
    />
  );

  return (
    <div className="page-container zx-flat-panels">
      <PushStatsSection />
      <SearchToolbar
        primary={<>
          {renderKeywordSearch()}
          {renderStatusFilter()}
          {renderTimeRangeFilter()}
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
        </>}
        mobilePrimary={<>
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
        </>}
        mobileFilters={<>
          {renderStatusFilter()}
          {renderTimeRangeFilter()}
        </>}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无推送记录"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />
    </div>
  );
}
