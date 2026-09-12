/**
 * 行为中心：事件调试 —— 事件明细分页查询，行内展开查看属性 payload。
 */
import { useMemo } from 'react';
import { compactParams } from '@/lib/query';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { useListSearch } from '@/hooks/useListSearch';
import { useAnalyticsDebugEvents } from '@/hooks/queries/analytics';
import type { AnalyticsDebugEvent, AnalyticsQualityIssueType } from '@zenith/shared/analytics';
import { ANALYTICS_ENVIRONMENT_LABELS, ANALYTICS_EVENT_SOURCE_LABELS, ANALYTICS_QUALITY_ISSUE_TYPE_LABELS, USER_BEHAVIOR_EVENT_TYPE_LABELS } from '@zenith/shared/analytics';
import { KeywordInput } from '@/components/search-filters';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { JsonBlock } from '@/components/JsonBlock';
import { ANALYTICS_ISSUE_TAG_COLOR } from './analytics-tag-colors';
import { nullableText } from './analytics-format';
import { ListSearchToolbar } from '@/components/list-page';

/** 枚举原值 → 中文标签，未收录的自定义值原样展示 */
function labelOf(labels: Record<string, string>, value: string | null | undefined): string {
  if (value == null || value === '') return '–';
  return labels[value] ?? value;
}

export default function AnalyticsDebugTab({ active }: Readonly<{ active: boolean }>) {
  const {
    page, pageSize, buildPagination,
    bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<{ eventName: string }>({
    defaults: { eventName: '' },
    listKey: ['analytics', 'data', 'debug-events'],
  });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({ eventName: submittedParams.eventName }), [submittedParams]);
  const debugQuery = useAnalyticsDebugEvents({ page, pageSize, ...filterQuery }, active);
  const events = debugQuery.data?.list ?? [];
  const total = debugQuery.data?.total ?? 0;

  const columns: ColumnProps<AnalyticsDebugEvent>[] = [
    dateTimeColumn('时间', 'createdAt'),
    { title: '事件名', dataIndex: 'eventName', width: 160, render: (value: string | null) => nullableText(value) },
    { title: '类型', dataIndex: 'eventType', width: 110, render: (value: string) => labelOf(USER_BEHAVIOR_EVENT_TYPE_LABELS, value) },
    { title: '来源', dataIndex: 'source', width: 110, render: (value: string) => labelOf(ANALYTICS_EVENT_SOURCE_LABELS, value) },
    { title: '应用', dataIndex: 'appId', width: 90 },
    { title: '环境', dataIndex: 'environment', width: 130, render: (value: string) => labelOf(ANALYTICS_ENVIRONMENT_LABELS, value) },
    { title: 'Distinct ID', dataIndex: 'distinctId', width: 150, render: (value: string | null) => nullableText(value) },
    { title: '会员 ID', dataIndex: 'memberId', width: 90, render: (value: number | null) => nullableText(value) },
    { title: '页面', dataIndex: 'pagePath', width: 200, render: renderEllipsis },
    {
      title: '质量问题',
      dataIndex: 'issueTypes',
      width: 200,
      render: (value: AnalyticsQualityIssueType[]) => (
        value.length
          ? <>{value.map((t) => <Tag key={t} color={ANALYTICS_ISSUE_TAG_COLOR[t]} size="small" style={{ marginRight: 4 }}>{ANALYTICS_QUALITY_ISSUE_TYPE_LABELS[t]}</Tag>)}</>
          : <Typography.Text type="tertiary" size="small">{EMPTY_PLACEHOLDER}</Typography.Text>
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
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="事件名" {...bindKeyword('eventName')} width={180} />}
        onSearch={handleSearch}
        onReset={handleReset}
      />
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
