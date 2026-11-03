import { useMemo, useState } from 'react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Button, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  apiAccessLogContract, API_ACCESS_AUTH_LABELS, API_ACCESS_AUTH_OPTIONS,
  API_ACCESS_PRINCIPAL_LABELS, API_ACCESS_PRINCIPAL_OPTIONS, OPERATION_LOG_RESULT_OPTIONS,
  type ApiAccessLogListItem,
} from '@zenith/shared/platform';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { ListSearchToolbar } from '@/components/list-page';
import { FilterSelect, KeywordInput, NumberFilter } from '@/components/search-filters';
import { useListPage } from '@/hooks/useListPage';
import { useApiAccessLogList } from '@/hooks/queries/api-access-logs';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTimeForApi } from '@/utils/date';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { ApiAccessLogDetailSheet } from './ApiAccessLogDetailSheet';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((value) => ({ value, label: value }));

function defaultRange() {
  return { startTime: formatDateTimeForApi(dayjs().subtract(6, 'day').startOf('day').toDate()), endTime: formatDateTimeForApi(dayjs().endOf('day').toDate()) };
}

export default function ApiAccessLogsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [detailId, setDetailId] = useState<number>();
  const page = useListPage({
    contract: apiAccessLogContract,
    useList: useApiAccessLogList,
    defaults: defaultRange,
    pageSize: 20,
    table: { empty: '暂无 API 访问记录' },
  });
  const columns = useMemo<ColumnProps<ApiAccessLogListItem>[]>(() => [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '访问主体', dataIndex: 'username', width: 160, render: (v: string | null, row) => renderEllipsis(v ?? API_ACCESS_PRINCIPAL_LABELS[row.principalType]) },
    { title: '主体类型', dataIndex: 'principalType', width: 100, render: (v: ApiAccessLogListItem['principalType']) => API_ACCESS_PRINCIPAL_LABELS[v] },
    { title: '认证方式', dataIndex: 'authType', width: 120, render: (v: ApiAccessLogListItem['authType']) => API_ACCESS_AUTH_LABELS[v] },
    { title: '方法', dataIndex: 'method', width: 90, render: (v: string) => <Tag size="small" color="blue">{v}</Tag> },
    { title: '请求路径', dataIndex: 'path', minWidth: 280, render: (v: string) => renderEllipsis(v) },
    { title: '模块', dataIndex: 'module', width: 150, render: (v: string | null) => renderEllipsis(v) },
    { title: '操作', dataIndex: 'operationName', width: 210, render: (v: string | null) => renderEllipsis(v) },
    { title: 'HTTP 状态', dataIndex: 'responseCode', width: 110, render: (v: number | null) => <Tag size="small" color={v == null ? 'grey' : v >= 200 && v < 400 ? 'green' : 'red'}>{v ?? '未知'}</Tag> },
    { title: '耗时', dataIndex: 'durationMs', width: 100, align: 'right', render: (v: number | null) => v == null ? '—' : `${v} ms` },
    { title: 'IP 地址', dataIndex: 'ip', width: 145, render: (v: string | null) => v ?? '—' },
    copyableNoColumn<ApiAccessLogListItem>('请求 ID', 'requestId', { width: 300 }),
    dateTimeColumn('请求时间', 'createdAt'),
    createOperationColumn<ApiAccessLogListItem>({ width: 90, desktopInlineKeys: ['detail'], actions: (row) => [{ key: 'detail', label: '详情', onClick: () => setDetailId(row.id) }] }),
  ], []);

  return (
    <div className="page-container">
      <Space spacing={8} wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="tertiary" size="small">默认查询近 7 天，超期访问记录由数据保留策略自动清理。</Typography.Text>
        {hasPermission('system:retention:view') && <Button size="small" theme="borderless" onClick={() => navigate('/system/retention')}>数据保留策略</Button>}
      </Space>
      <ListSearchToolbar
        page={page}
        filters={['username', 'userId', 'memberId', 'principalType', 'authType', 'clientId', 'method', 'path', 'routePath', 'module', 'operationKey', 'requestId', 'serviceName', 'ip', 'status', 'responseCode', 'content', ['startTime', 'endTime'], 'minDurationMs', 'maxDurationMs']}
        overrides={{
          userId: (p) => <NumberFilter placeholder="管理员 ID" min={1} {...p.bind('userId')} />,
          memberId: (p) => <NumberFilter placeholder="会员 ID" min={1} {...p.bind('memberId')} />,
          principalType: (p) => <FilterSelect placeholder="全部主体类型" items={API_ACCESS_PRINCIPAL_OPTIONS} {...p.bind('principalType')} />,
          authType: (p) => <FilterSelect placeholder="全部认证方式" items={API_ACCESS_AUTH_OPTIONS} {...p.bind('authType')} />,
          clientId: (p) => <KeywordInput placeholder="开放应用 Client ID" {...p.bindKeyword('clientId')} />,
          method: (p) => <FilterSelect placeholder="全部请求方法" items={METHOD_OPTIONS} {...p.bind('method')} />,
          path: (p) => <KeywordInput placeholder="请求路径" {...p.bindKeyword('path')} />,
          routePath: (p) => <KeywordInput placeholder="路由模板" {...p.bindKeyword('routePath')} />,
          module: (p) => <KeywordInput placeholder="模块" {...p.bindKeyword('module')} />,
          operationKey: (p) => <KeywordInput placeholder="操作标识" {...p.bindKeyword('operationKey')} />,
          requestId: (p) => <KeywordInput placeholder="请求 ID（前缀匹配）" {...p.bindKeyword('requestId')} />,
          serviceName: (p) => <KeywordInput placeholder="服务名" {...p.bindKeyword('serviceName')} />,
          ip: (p) => <KeywordInput placeholder="IP 地址" {...p.bindKeyword('ip')} />,
          status: (p) => <FilterSelect placeholder="全部请求结果" items={OPERATION_LOG_RESULT_OPTIONS} {...p.bind('status')} />,
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
