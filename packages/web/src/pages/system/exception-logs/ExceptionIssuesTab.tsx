import { useMemo, useState } from 'react';
import { Banner, Button, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useSearchParams } from 'react-router-dom';
import type { AnalyticsEnvironment, ErrorEvent, ErrorGroup, ErrorLevel, ErrorStatus, ServerErrorType } from '@zenith/shared/analytics';
import { ANALYTICS_ENVIRONMENT_OPTIONS, ERROR_LEVEL_OPTIONS, ERROR_STATUS_OPTIONS, SERVER_ERROR_TYPE_OPTIONS } from '@zenith/shared/analytics';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { ErrorLevelTag, ErrorStatusTag, ErrorTypeIcon, ErrorTypeTag, TrendSparkline } from '@/components/error-tracking';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { BatchDeleteButton } from '@/components/toolbar-controls';
import {
  exceptionLogKeys,
  useBatchDeleteExceptionGroups,
  useBatchUpdateExceptionGroups,
  useExceptionGroups,
  useExceptionOverview,
  useExceptionReporterStatus,
  useUpdateExceptionGroup,
} from '@/hooks/queries/exception-logs';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';
import { ExceptionEventDetailSheet } from './ExceptionEventDetailSheet';
import { ExceptionIssueDetailSheet } from './ExceptionIssueDetailSheet';

const { Text } = Typography;

interface IssueFilters {
  keyword: string;
  status?: ErrorStatus;
  errorType?: ServerErrorType;
  level?: ErrorLevel;
  environment?: AnalyticsEnvironment;
  range: [Date, Date] | null;
}

const DEFAULT_FILTERS: IssueFilters = { keyword: '', status: undefined, errorType: undefined, level: undefined, environment: undefined, range: null };
const OVERVIEW_DAYS = 30;

export function ExceptionIssuesTab({ active }: Readonly<{ active: boolean }>) {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:exception-log:manage');
  const [searchParams, setSearchParams] = useSearchParams();

  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const search = useListSearch<IssueFilters>({
    defaults: DEFAULT_FILTERS,
    listKey: exceptionLogKeys.groupsLists,
    extraKeys: [exceptionLogKeys.overview],
    pageSize: 20,
    onSearch: clearSelection,
    onReset: clearSelection,
  });
  const { bind, bindKeyword, submittedParams, page, pageSize, buildPagination, handleSearch, handleReset, applySearch } = search;

  const filterQuery = useFilterQuery({
    status: submittedParams.status,
    errorType: submittedParams.errorType,
    level: submittedParams.level,
    environment: submittedParams.environment,
    keyword: submittedParams.keyword.trim(),
    ...formatDateTimeRangeForApi(submittedParams.range),
  });
  const groupsQuery = useExceptionGroups({ page, pageSize, ...filterQuery }, active);
  const overviewQuery = useExceptionOverview(OVERVIEW_DAYS, active);
  const overview = overviewQuery.data ?? null;
  const reporterQuery = useExceptionReporterStatus(active);
  const reporter = reporterQuery.data ?? null;

  const updateMutation = useUpdateExceptionGroup();
  const batchStatusMutation = useBatchUpdateExceptionGroups();
  const batchDeleteMutation = useBatchDeleteExceptionGroups();

  // ?issue= 深链：通知 / 前端错误页跳转直达分组详情
  const issueParam = searchParams.get('issue');
  const detailGroupId = issueParam && /^\d+$/.test(issueParam) ? Number(issueParam) : undefined;
  useListDeepLink(['keyword'], ({ keyword }) => applySearch({ ...DEFAULT_FILTERS, keyword }));
  const openDetail = (id: number) => setSearchParams((prev) => { prev.set('issue', String(id)); return prev; }, { replace: true });
  const closeDetail = () => setSearchParams((prev) => { prev.delete('issue'); return prev; }, { replace: true });
  const [eventDetail, setEventDetail] = useState<ErrorEvent | null>(null);

  const updateStatus = async (id: number, status: ErrorStatus) => {
    await updateMutation.mutateAsync({ params: { id }, body: { status } });
    Toast.success(status === 'resolved' ? '已标记为已解决' : status === 'ignored' ? '已忽略' : '状态已更新');
  };

  const batchStatus = async (status: ErrorStatus) => {
    if (selectedRowKeys.length === 0) return;
    await batchStatusMutation.mutateAsync({ query: { status }, body: { ids: selectedRowKeys } });
    Toast.success(`已更新 ${selectedRowKeys.length} 条`);
    clearSelection();
  };

  const toggleStatusFilter = (status: ErrorStatus) => {
    applySearch({ ...submittedParams, status: submittedParams.status === status ? undefined : status });
  };

  const columns = useMemo<ColumnProps<ErrorGroup>[]>(() => [
    {
      title: '类型',
      dataIndex: 'errorType',
      width: 150,
      render: (_v, record) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ErrorTypeIcon type={record.errorType} /><ErrorTypeTag type={record.errorType} /></span>,
    },
    { title: '级别', dataIndex: 'level', width: 90, render: (_v, record) => <ErrorLevelTag level={record.level} /> },
    {
      title: '异常信息',
      dataIndex: 'message',
      minWidth: 420,
      render: (_v, record) => (
        <Button theme="borderless" size="small" style={{ padding: 0, maxWidth: '100%' }} onClick={() => openDetail(record.id)}>
          <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 400 }}>{record.message}</Text>
        </Button>
      ),
    },
    { title: '次数', dataIndex: 'count', width: 90, align: 'right', render: (_v, record) => <Tag color={record.count >= 10 ? 'red' : 'grey'}>{record.count}</Tag> },
    { title: '7 日趋势', dataIndex: 'trend', width: 120, render: (_v, record) => <TrendSparkline data={record.trend} /> },
    { title: '影响用户', dataIndex: 'affectedUsers', width: 100, align: 'right' },
    { title: '处理人', dataIndex: 'assigneeName', width: 120, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    dateTimeColumn('首次', 'firstSeenAt'),
    dateTimeColumn('最近', 'lastSeenAt'),
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (_v, record) => <ErrorStatusTag status={record.status} /> },
    createOperationColumn<ErrorGroup>({
      width: 220,
      desktopInlineKeys: ['detail', 'resolve'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => openDetail(record.id) },
        { key: 'resolve', label: '标记已解决', hidden: !canManage || record.status === 'resolved', onClick: () => { void updateStatus(record.id, 'resolved'); } },
        { key: 'ignore', label: '忽略', hidden: !canManage || record.status === 'ignored', onClick: () => { void updateStatus(record.id, 'ignored'); } },
        { key: 'reopen', label: '重新打开', hidden: !canManage || record.status === 'unresolved', onClick: () => { void updateStatus(record.id, 'unresolved'); } },
        deleteAction({
          hidden: !canManage,
          title: '确认删除该异常 Issue？',
          content: `即将删除「${record.message.slice(0, 80)}」及其全部事件，删除后无法恢复。`,
          run: () => batchDeleteMutation.mutateAsync({ body: { ids: [record.id] } }),
          onDeleted: () => { if (detailGroupId === record.id) closeDetail(); },
        }),
      ],
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openDetail / closeDetail / updateStatus 每次渲染重建但只读最新 searchParams，列定义无需随之重算
  ], [batchDeleteMutation, canManage, detailGroupId]);

  const reporterHealthy = reporter ? reporter.enabled && !reporter.paused : true;

  return (
    <>
      {overview && (
        <StatGrid minItemWidth={150}>
          <StatCard title="未处理" value={overview.unresolved} accent="var(--semi-color-danger)" onClick={() => toggleStatusFilter('unresolved')} active={submittedParams.status === 'unresolved'} />
          <StatCard title="今日新增 Issue" value={overview.newToday} />
          <StatCard title="24 小时事件" value={overview.occurrences24h} />
          <StatCard title={`${OVERVIEW_DAYS} 日 Issue`} value={overview.totalGroups} sub={`事件 ${overview.totalOccurrences}`} />
          {reporter && (
            <StatCard
              title="采集器"
              value={reporter.enabled ? (reporter.paused ? '熔断中' : '运行中') : '已关闭'}
              accent={reporterHealthy ? 'var(--semi-color-success)' : 'var(--semi-color-warning)'}
              sub={`待写 ${reporter.pending} · 限流 ${reporter.countOnly} · 丢弃 ${reporter.dropped}`}
            />
          )}
        </StatGrid>
      )}

      {reporter && !reporterHealthy && (
        <Banner
          fullMode={false}
          type="warning"
          bordered
          closeIcon={null}
          description={reporter.enabled ? '采集器连续落库失败已熔断，期间的异常只写进程日志；数据库恢复后自动继续。' : '服务端异常采集已在「系统设置 → 异常日志」中关闭，异常只写进程日志。'}
        />
      )}

      <ListSearchToolbar
        keyword={<KeywordInput placeholder="异常消息" {...bindKeyword('keyword')} width={220} />}
        filters={(
          <>
            <StatusSelect items={ERROR_STATUS_OPTIONS} {...bind('status')} />
            <FilterSelect items={SERVER_ERROR_TYPE_OPTIONS} placeholder="全部类型" {...bind('errorType')} />
            <FilterSelect items={ERROR_LEVEL_OPTIONS} placeholder="全部级别" {...bind('level')} />
            <FilterSelect items={ANALYTICS_ENVIRONMENT_OPTIONS} placeholder="全部环境" {...bind('environment')} />
            <DateRangeFilter {...bind('range')} placeholder={['最近发生 起', '最近发生 止']} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={canManage && selectedRowKeys.length > 0 ? (
          <>
            <Button theme="light" loading={batchStatusMutation.isPending} onClick={() => void batchStatus('resolved')}>标记已解决 ({selectedRowKeys.length})</Button>
            <Button theme="light" loading={batchStatusMutation.isPending} onClick={() => void batchStatus('ignored')}>忽略 ({selectedRowKeys.length})</Button>
            <BatchDeleteButton
              count={selectedRowKeys.length}
              label="删除"
              onClick={() => confirmAndDelete({
                title: '确认删除所选异常 Issue？',
                content: `将删除 ${selectedRowKeys.length} 个分组及其全部事件，删除后无法恢复。`,
                run: () => batchDeleteMutation.mutateAsync({ body: { ids: selectedRowKeys } }),
                onDeleted: clearSelection,
              })}
            />
          </>
        ) : undefined}
        filterTitle="异常筛选"
      />

      <ConfigurableTable<ErrorGroup>
        columns={columns}
        {...listTableProps(groupsQuery, { pagination: buildPagination, rowSelection: canManage ? rowSelection : undefined })}
        empty="暂无服务端异常"
      />

      <ExceptionIssueDetailSheet groupId={detailGroupId} onClose={closeDetail} onOpenEvent={setEventDetail} />
      <ExceptionEventDetailSheet event={eventDetail} onClose={() => setEventDetail(null)} />
    </>
  );
}
