import { useMemo, useState } from 'react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Tag } from '@douyinfe/semi-ui';
import {
  apiAccessLogContract, API_ACCESS_CREDENTIAL_LABELS, API_ACCESS_CREDENTIAL_OPTIONS,
  API_ACCESS_ACCESSOR_TYPE_LABELS, API_ACCESS_ACCESSOR_TYPE_OPTIONS, OPERATION_LOG_RESULT_OPTIONS,
  type ApiAccessLogListItem,
} from '@zenith/shared/platform';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { ListSearchToolbar } from '@/components/list-page';
import { FilterSelect, KeywordInput, NumberFilter } from '@/components/search-filters';
import { useListPage } from '@/hooks/useListPage';
import { useApiAccessLogList } from '@/hooks/queries/api-access-logs';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { ApiAccessLogDetailSheet } from './ApiAccessLogDetailSheet';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((value) => ({ value, label: value }));

export default function ApiAccessLogsPage() {
  const [detailId, setDetailId] = useState<number>();
  const page = useListPage({
    contract: apiAccessLogContract,
    useList: useApiAccessLogList,
    pageSize: 20,
    table: { empty: '暂无 API 访问记录' },
  });
  const columns = useMemo<ColumnProps<ApiAccessLogListItem>[]>(() => [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '访问人 / 调用方', dataIndex: 'accessorName', width: 180, render: (v: string | null, row) => renderEllipsis(v ?? API_ACCESS_ACCESSOR_TYPE_LABELS[row.accessorType]) },
    { title: '访问人 / 调用方 ID', dataIndex: 'accessorId', width: 180, render: (v: string | null) => renderEllipsis(v) },
    { title: '访问端类型', dataIndex: 'accessorType', width: 120, render: (v: ApiAccessLogListItem['accessorType']) => API_ACCESS_ACCESSOR_TYPE_LABELS[v] },
    { title: '凭证方式', dataIndex: 'credentialType', width: 140, render: (v: ApiAccessLogListItem['credentialType']) => API_ACCESS_CREDENTIAL_LABELS[v] },
    { title: '方法', dataIndex: 'method', width: 90, render: (v: string) => <Tag size="small" color="blue">{v}</Tag> },
    { title: 'HTTP 状态', dataIndex: 'responseCode', width: 110, render: (v: number | null) => <Tag size="small" color={v == null ? 'grey' : v >= 200 && v < 400 ? 'green' : 'red'}>{v ?? '未知'}</Tag> },
    { title: '请求路径', dataIndex: 'path', minWidth: 280, render: (v: string) => renderEllipsis(v) },
    { title: '模块', dataIndex: 'module', width: 150, render: (v: string | null) => renderEllipsis(v) },
    { title: '操作', dataIndex: 'operationName', width: 210, render: (v: string | null) => renderEllipsis(v) },
    { title: '耗时', dataIndex: 'durationMs', width: 100, align: 'right', render: (v: number | null) => v == null ? '—' : `${v} ms` },
    { title: 'IP 地址', dataIndex: 'ip', width: 145, render: (v: string | null) => v ?? '—' },
    copyableNoColumn<ApiAccessLogListItem>('请求 ID', 'requestId', { width: 300 }),
    dateTimeColumn('请求时间', 'createdAt'),
    createOperationColumn<ApiAccessLogListItem>({ width: 90, desktopInlineKeys: ['detail'], actions: (row) => [{ key: 'detail', label: '详情', onClick: () => setDetailId(row.id) }] }),
  ], []);

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['accessorName', 'accessorId', 'userId', 'memberId', 'deviceId', 'accessorType', 'credentialType', 'status', 'responseCode', 'clientId', 'method', 'path', 'routePath', 'module', 'operationKey', 'requestId', 'serviceName', 'ip', 'content', ['startTime', 'endTime'], 'minDurationMs', 'maxDurationMs']}
        overrides={{
          userId: (p) => <NumberFilter placeholder="管理端用户 ID" min={1} {...p.bind('userId')} />,
          memberId: (p) => <NumberFilter placeholder="会员 ID" min={1} {...p.bind('memberId')} />,
          deviceId: (p) => <NumberFilter placeholder="设备 ID" min={1} {...p.bind('deviceId')} />,
          accessorId: (p) => <KeywordInput placeholder="访问人 / 调用方 ID" {...p.bindKeyword('accessorId')} />,
          accessorType: (p) => <FilterSelect width={150} placeholder="全部访问端类型" items={API_ACCESS_ACCESSOR_TYPE_OPTIONS} {...p.bind('accessorType')} />,
          credentialType: (p) => <FilterSelect width={160} placeholder="全部凭证方式" items={API_ACCESS_CREDENTIAL_OPTIONS} {...p.bind('credentialType')} />,
          clientId: (p) => <KeywordInput placeholder="开放应用 Client ID" {...p.bindKeyword('clientId')} />,
          method: (p) => <FilterSelect width={140} placeholder="全部请求方法" items={METHOD_OPTIONS} {...p.bind('method')} />,
          path: (p) => <KeywordInput placeholder="请求路径" {...p.bindKeyword('path')} />,
          routePath: (p) => <KeywordInput placeholder="路由模板" {...p.bindKeyword('routePath')} />,
          module: (p) => <KeywordInput placeholder="模块" {...p.bindKeyword('module')} />,
          operationKey: (p) => <KeywordInput placeholder="操作标识" {...p.bindKeyword('operationKey')} />,
          requestId: (p) => <KeywordInput placeholder="请求 ID（前缀匹配）" {...p.bindKeyword('requestId')} />,
          serviceName: (p) => <KeywordInput placeholder="服务名" {...p.bindKeyword('serviceName')} />,
          ip: (p) => <KeywordInput placeholder="IP 地址" {...p.bindKeyword('ip')} />,
          status: (p) => <FilterSelect width={140} placeholder="全部请求结果" items={OPERATION_LOG_RESULT_OPTIONS} {...p.bind('status')} />,
          responseCode: (p) => <NumberFilter placeholder="HTTP 状态码" min={100} max={599} {...p.bind('responseCode')} />,
          content: (p) => <KeywordInput placeholder="脱敏请求参数包含" {...p.bindKeyword('content')} />,
          minDurationMs: (p) => <NumberFilter placeholder="耗时 ≥ (ms)" min={0} {...p.bind('minDurationMs')} />,
          maxDurationMs: (p) => <NumberFilter placeholder="耗时 ≤ (ms)" min={0} {...p.bind('maxDurationMs')} />,
        }}
        actions={<ExportButton entity="system.api-access-logs" query={page.filterQuery} permission="system:api-access-log:export" executionMode="auto" />}
        filterTitle="API 访问日志筛选"
      />
      <ConfigurableTable<ApiAccessLogListItem> columns={columns} {...page.tableProps} />
      <ApiAccessLogDetailSheet id={detailId} onClose={() => setDetailId(undefined)} />
    </div>
  );
}
