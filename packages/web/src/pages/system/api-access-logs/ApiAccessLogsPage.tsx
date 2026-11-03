import { useMemo, useState } from 'react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ApiAccessLog } from '@zenith/shared/platform';
import { OPERATION_LOG_RESULT_OPTIONS } from '@zenith/shared/platform';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { DateRangeFilter, FilterSelect, KeywordInput, NumberFilter, StatusSelect } from '@/components/search-filters';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useListSearch } from '@/hooks/useListSearch';
import { apiAccessLogKeys, useApiAccessLogList } from '@/hooks/queries/api-access-logs';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { ApiAccessLogDetailSheet } from './ApiAccessLogDetailSheet';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((value) => ({ value, label: value }));
interface SearchParams {
  username: string;
  principalType: string;
  authType: string;
  module: string;
  operationKey: string;
  method?: string;
  path: string;
  routePath: string;
  requestId: string;
  status?: 'success' | 'fail';
  content: string;
  timeRange: [Date, Date] | null;
  minDurationMs?: number;
  maxDurationMs?: number;
}
const DEFAULTS: SearchParams = { username: '', principalType: '', authType: '', module: '', operationKey: '', method: undefined, path: '', routePath: '', requestId: '', status: undefined, content: '', timeRange: null, minDurationMs: undefined, maxDurationMs: undefined };

export default function ApiAccessLogsPage() {
  const [detailId, setDetailId] = useState<number>();
  const search = useListSearch<SearchParams>({ defaults: DEFAULTS, listKey: apiAccessLogKeys.lists, pageSize: 20 });
  const { bind, bindKeyword, submittedParams, page, pageSize, buildPagination, handleSearch, handleReset } = search;
  const filterQuery = useFilterQuery({
    username: submittedParams.username,
    principalType: submittedParams.principalType,
    authType: submittedParams.authType,
    module: submittedParams.module,
    operationKey: submittedParams.operationKey,
    method: submittedParams.method,
    path: submittedParams.path,
    routePath: submittedParams.routePath,
    requestId: submittedParams.requestId,
    status: submittedParams.status,
    content: submittedParams.content,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
    minDurationMs: submittedParams.minDurationMs,
    maxDurationMs: submittedParams.maxDurationMs,
  });
  const listQuery = useApiAccessLogList({ page, pageSize, ...filterQuery });
  const columns = useMemo<ColumnProps<ApiAccessLog>[]>(() => [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '主体', dataIndex: 'username', width: 150, render: (v: string | null, row) => renderEllipsis(v ?? row.principalType) },
    { title: '认证', dataIndex: 'authType', width: 110, render: (v: string) => <Tag size="small" color="purple">{v}</Tag> },
    { title: '方法', dataIndex: 'method', width: 82, render: (v: string) => <Tag size="small" color="blue">{v}</Tag> },
    { title: '请求地址', dataIndex: 'path', minWidth: 280, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }}>{v}</Typography.Text> },
    { title: '模块', dataIndex: 'module', width: 150, render: (v: string | null) => renderEllipsis(v) },
    { title: '操作', dataIndex: 'operationName', width: 210, render: (v: string | null) => renderEllipsis(v) },
    { title: '状态', dataIndex: 'responseCode', width: 82, render: (v: number | null) => <Tag size="small" color={v != null && v < 400 ? 'green' : 'red'}>{v ?? '-'}</Tag> },
    { title: '耗时', dataIndex: 'durationMs', width: 90, align: 'right', render: (v: number | null) => v == null ? '-' : `${v} ms` },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '-' },
    dateTimeColumn('请求时间', 'createdAt'),
    createOperationColumn<ApiAccessLog>({ width: 90, desktopInlineKeys: ['detail'], actions: (row) => [{ key: 'detail', label: '详情', onClick: () => setDetailId(row.id) }] }),
  ], []);

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="用户名 / 标识" {...bindKeyword('username')} width={160} />}
        filters={<>
          <KeywordInput placeholder="模块" {...bindKeyword('module')} width={150} />
          <KeywordInput placeholder="操作标识" {...bindKeyword('operationKey')} width={150} />
          <FilterSelect placeholder="全部方法" items={METHOD_OPTIONS} {...bind('method')} width={120} />
          <KeywordInput placeholder="请求地址" {...bindKeyword('path')} width={190} />
          <KeywordInput placeholder="路由模板" {...bindKeyword('routePath')} width={170} />
          <KeywordInput placeholder="请求 ID" {...bindKeyword('requestId')} width={170} />
          <StatusSelect items={OPERATION_LOG_RESULT_OPTIONS} {...bind('status')} />
          <KeywordInput placeholder="请求参数包含" {...bindKeyword('content')} width={170} />
          <DateRangeFilter {...bind('timeRange')} />
          <NumberFilter placeholder="耗时 ≥ (ms)" min={0} {...bind('minDurationMs')} />
          <NumberFilter placeholder="耗时 ≤ (ms)" min={0} {...bind('maxDurationMs')} />
        </>}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={<ExportButton entity="system.api-access-logs" query={filterQuery} executionMode="auto" />}
        filterTitle="API 访问日志筛选"
      />
      <ConfigurableTable<ApiAccessLog> columns={columns} {...listTableProps(listQuery, { pagination: buildPagination })} empty="暂无 API 访问记录" />
      <ApiAccessLogDetailSheet id={detailId} onClose={() => setDetailId(undefined)} />
    </div>
  );
}

