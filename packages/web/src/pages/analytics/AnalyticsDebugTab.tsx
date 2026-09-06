/**
 * 行为中心：事件调试 —— 事件明细分页查询，行内展开查看属性 payload。
 */
import { useState } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { useQueryClient } from '@tanstack/react-query';
import { useAnalyticsDebugEvents } from '@/hooks/queries/analytics';
import type { AnalyticsDebugEvent, AnalyticsQualityIssueType } from '@zenith/shared/analytics';
import { ANALYTICS_ENVIRONMENT_LABELS, ANALYTICS_EVENT_SOURCE_LABELS, ANALYTICS_QUALITY_ISSUE_TYPE_LABELS, USER_BEHAVIOR_EVENT_TYPE_LABELS } from '@zenith/shared/analytics';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { dateTimeColumn } from '@/utils/table-columns';
import { JsonBlock } from '@/components/JsonBlock';
import { ANALYTICS_ISSUE_TAG_COLOR } from './analytics-tag-colors';

function nullableText(value: string | number | null | undefined) {
  return value == null || value === '' ? '–' : String(value);
}

/** 枚举原值 → 中文标签，未收录的自定义值原样展示 */
function labelOf(labels: Record<string, string>, value: string | null | undefined): string {
  if (value == null || value === '') return '–';
  return labels[value] ?? value;
}

export default function AnalyticsDebugTab({ active }: Readonly<{ active: boolean }>) {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [eventNameDraft, setEventNameDraft] = useState('');
  const [eventName, setEventName] = useState('');

  const debugQuery = useAnalyticsDebugEvents({ page, pageSize, eventName: eventName || undefined }, active);
  const events = debugQuery.data?.list ?? [];
  const total = debugQuery.data?.total ?? 0;

  const handleSearch = () => {
    setPage(1);
    setEventName(eventNameDraft);
    // 事件名未变时 query key 不变，不显式失效就看不到新上报的事件
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'data', 'debug-events'] });
  };
  const handleReset = () => {
    setEventNameDraft('');
    setEventName('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'data', 'debug-events'] });
  };

  const columns: ColumnProps<AnalyticsDebugEvent>[] = [
    dateTimeColumn('时间', 'createdAt'),
    { title: '事件名', dataIndex: 'eventName', width: 160, render: (value: string | null) => nullableText(value) },
    { title: '类型', dataIndex: 'eventType', width: 110, render: (value: string) => labelOf(USER_BEHAVIOR_EVENT_TYPE_LABELS, value) },
    { title: '来源', dataIndex: 'source', width: 110, render: (value: string) => labelOf(ANALYTICS_EVENT_SOURCE_LABELS, value) },
    { title: '应用', dataIndex: 'appId', width: 90 },
    { title: '环境', dataIndex: 'environment', width: 130, render: (value: string) => labelOf(ANALYTICS_ENVIRONMENT_LABELS, value) },
    { title: 'Distinct ID', dataIndex: 'distinctId', width: 150, render: (value: string | null) => nullableText(value) },
    { title: '会员 ID', dataIndex: 'memberId', width: 90, render: (value: number | null) => nullableText(value) },
    {
      title: '页面',
      dataIndex: 'pagePath',
      width: 200,
      render: (value: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{value}</Typography.Text>,
    },
    {
      title: '质量问题',
      dataIndex: 'issueTypes',
      width: 200,
      render: (value: AnalyticsQualityIssueType[]) => (
        value.length
          ? <>{value.map((t) => <Tag key={t} color={ANALYTICS_ISSUE_TAG_COLOR[t]} size="small" style={{ marginRight: 4 }}>{ANALYTICS_QUALITY_ISSUE_TYPE_LABELS[t]}</Tag>)}</>
          : <Typography.Text type="tertiary" size="small">–</Typography.Text>
      ),
    },
  ];

  /** 行内展开：只补充行上没有的信息（事件 ID / 用户 / 属性 payload） */
  const renderExpanded = (record?: AnalyticsDebugEvent) => (record ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <span><Typography.Text strong>事件 ID：</Typography.Text>{nullableText(record.eventId)}</span>
        <span><Typography.Text strong>用户 / 会员：</Typography.Text>{nullableText(record.userId)} / {nullableText(record.memberId)}</span>
        <span><Typography.Text strong>页面：</Typography.Text>{record.pagePath}</span>
      </div>
      <div>
        <Typography.Text strong>属性：</Typography.Text>
        <JsonBlock value={record.properties ?? {}} style={{ marginTop: 8 }} />
      </div>
    </div>
  ) : null);

  return (
    <div>
      <SearchToolbar>
        <KeywordInput placeholder="事件名" value={eventNameDraft} onChange={setEventNameDraft} onSearch={handleSearch} width={180} />
        <SearchButton onClick={handleSearch} />
        <ResetButton onClick={handleReset} />
      </SearchToolbar>
      <ConfigurableTable
        bordered
        rowKey="id"
        loading={debugQuery.isFetching && events.length === 0}
        columns={columns}
        dataSource={events}
        onRefresh={() => void debugQuery.refetch()}
        refreshLoading={debugQuery.isFetching}
        pagination={buildPagination(total)}
        empty="暂无最近事件"
        expandedRowRender={renderExpanded}
        hideExpandedColumn={false}
        expandRowByClick
      />
    </div>
  );
}
