import { useMemo, useState } from 'react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ErrorEvent, ErrorLevel, ServerErrorType } from '@zenith/shared/analytics';
import { ERROR_LEVEL_OPTIONS, SERVER_ERROR_TYPE_OPTIONS } from '@zenith/shared/analytics';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { ErrorLevelTag, ErrorTypeTag } from '@/components/error-tracking';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { exceptionLogKeys, useExceptionEvents } from '@/hooks/queries/exception-logs';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { useListSearch } from '@/hooks/useListSearch';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { EMPTY_PLACEHOLDER, copyableNoColumn, dateTimeColumn, renderCodeEllipsis, renderEllipsis } from '@/utils/table-columns';
import { ExceptionEventDetailSheet } from './ExceptionEventDetailSheet';

interface EventFilters {
  traceId: string;
  route: string;
  jobType: string;
  hostname: string;
  errorType?: ServerErrorType;
  level?: ErrorLevel;
  range: [Date, Date] | null;
}

const DEFAULT_FILTERS: EventFilters = { traceId: '', route: '', jobType: '', hostname: '', errorType: undefined, level: undefined, range: null };

export function ExceptionEventsTab({ active }: Readonly<{ active: boolean }>) {
  const search = useListSearch<EventFilters>({ defaults: DEFAULT_FILTERS, listKey: exceptionLogKeys.eventsLists, pageSize: 20 });
  const { bind, bindKeyword, submittedParams, page, pageSize, buildPagination, handleSearch, handleReset, applySearch } = search;
  // ?traceId= 深链：前端错误监控 / 链路追踪跳过来时按链路 ID 定位（消费即焚）
  useListDeepLink(['traceId'], ({ traceId }) => applySearch({ ...DEFAULT_FILTERS, traceId }));
  const filterQuery = useFilterQuery({
    traceId: submittedParams.traceId.trim(),
    route: submittedParams.route.trim(),
    jobType: submittedParams.jobType.trim(),
    hostname: submittedParams.hostname.trim(),
    errorType: submittedParams.errorType,
    level: submittedParams.level,
    ...formatDateTimeRangeForApi(submittedParams.range),
  });
  const eventsQuery = useExceptionEvents({ page, pageSize, ...filterQuery }, active);
  const [detail, setDetail] = useState<ErrorEvent | null>(null);

  const columns = useMemo<ColumnProps<ErrorEvent>[]>(() => [
    dateTimeColumn('时间', 'createdAt'),
    { title: '类型', dataIndex: 'errorType', width: 130, render: (_v, record) => <ErrorTypeTag type={record.errorType} /> },
    { title: '级别', dataIndex: 'level', width: 80, render: (_v, record) => <ErrorLevelTag level={record.level} /> },
    {
      title: '异常信息',
      dataIndex: 'message',
      minWidth: 320,
      // 用工厂而不是写死 maxWidth：写死的上限比单元格宽得多，列被压窄时省略会按上限而非单元格截断，文字压过列边界
      render: (_v, record) => renderEllipsis(record.errorName ? `${record.errorName}: ${record.message}` : record.message),
    },
    {
      title: '路由 / 作业',
      dataIndex: 'route',
      width: 260,
      render: (_v, record) => {
        const text = record.route ? `${record.httpMethod ?? ''} ${record.route}`.trim() : record.jobType ? `${record.jobType}${record.jobId ? ` #${record.jobId}` : ''}` : null;
        return renderCodeEllipsis(text);
      },
    },
    { title: 'HTTP', dataIndex: 'httpStatus', width: 90, align: 'right', render: (v: number | null) => v ?? EMPTY_PLACEHOLDER },
    copyableNoColumn<ErrorEvent>('链路 ID', 'traceId', { width: 320 }),
    { title: '主机', dataIndex: 'hostname', width: 200, render: (v: string | null, record) => renderEllipsis(v ? `${v}${record.processRole ? ` · ${record.processRole}` : ''}` : null) },
    { title: '用户', dataIndex: 'username', width: 120, render: (v: string | null, record) => renderEllipsis(v ?? (record.userId ? `#${record.userId}` : null)) },
    createOperationColumn<ErrorEvent>({
      width: 100,
      desktopInlineKeys: ['detail'],
      actions: (record) => [{ key: 'detail', label: '详情', onClick: () => setDetail(record) }],
    }),
  ], []);

  return (
    <>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="链路 ID（前缀匹配）" {...bindKeyword('traceId')} width={260} />}
        filters={(
          <>
            <KeywordInput placeholder="路由模板" {...bindKeyword('route')} width={180} />
            <KeywordInput placeholder="任务 / 作业 / 事件类型" {...bindKeyword('jobType')} width={180} />
            <KeywordInput placeholder="主机名" {...bindKeyword('hostname')} width={150} />
            <FilterSelect items={SERVER_ERROR_TYPE_OPTIONS} placeholder="全部类型" {...bind('errorType')} />
            <FilterSelect items={ERROR_LEVEL_OPTIONS} placeholder="全部级别" {...bind('level')} />
            <DateRangeFilter {...bind('range')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="事件筛选"
      />
      <ConfigurableTable<ErrorEvent>
        columns={columns}
        {...listTableProps(eventsQuery, { pagination: buildPagination })}
        empty="暂无异常事件"
      />
      <ExceptionEventDetailSheet event={detail} onClose={() => setDetail(null)} />
    </>
  );
}
