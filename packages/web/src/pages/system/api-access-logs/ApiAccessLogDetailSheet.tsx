import { Button, Descriptions, Empty, SideSheet, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { API_ACCESS_AUTH_LABELS, API_ACCESS_PRINCIPAL_LABELS } from '@zenith/shared/platform';
import JsonBlock from '@/components/JsonBlock';
import { RefreshButton } from '@/components/toolbar-controls';
import { useApiAccessLogDetail } from '@/hooks/queries/api-access-logs';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text, Title } = Typography;

export function ApiAccessLogDetailSheet({ id, onClose }: Readonly<{ id: number | undefined; onClose: () => void }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const query = useApiAccessLogDetail(id, id !== undefined);
  // A closed sheet or a changed id must never show the previous request's payload.
  const log = id !== undefined && query.data?.id === id ? query.data : undefined;
  const success = log?.responseCode != null && log.responseCode >= 200 && log.responseCode < 400;
  return (
    <SideSheet title={log ? `API 访问日志 #${log.id}` : 'API 访问日志详情'} visible={id !== undefined} onCancel={onClose} width={820} closeOnEsc>
      {id !== undefined && (query.isLoading ? <Spin spinning><Text>正在加载访问日志…</Text></Spin> : query.isError ? (
        <Empty title="日志详情加载失败" description={query.error.message}>
          <RefreshButton onClick={() => void query.refetch()} loading={query.isFetching} />
        </Empty>
      ) : log ? (
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <Space spacing={8} wrap>
            <Tag color={log.responseCode == null ? 'grey' : success ? 'green' : 'red'}>{log.responseCode ?? '未知状态'}</Tag>
            <Tag color="blue">{log.method}</Tag>
            <Text code style={{ wordBreak: 'break-all' }}>{log.path}</Text>
          </Space>
          <Descriptions size="small" column={1} data={[
            { key: '访问主体', value: log.username ?? API_ACCESS_PRINCIPAL_LABELS[log.principalType] },
            { key: '管理员 ID', value: log.userId ?? EMPTY_PLACEHOLDER },
            { key: '会员 ID', value: log.memberId ?? EMPTY_PLACEHOLDER },
            { key: '所属租户', value: log.tenantId ?? '平台 / 无租户' },
            { key: '实际操作人', value: log.impersonatorId == null ? '本人操作' : `${log.impersonatorName ?? '管理员'}（#${log.impersonatorId}，模拟登录）` },
            { key: '主体类型', value: API_ACCESS_PRINCIPAL_LABELS[log.principalType] },
            { key: '认证方式', value: API_ACCESS_AUTH_LABELS[log.authType] },
            { key: '开放应用 Client ID', value: log.clientId ?? EMPTY_PLACEHOLDER },
            { key: '模块', value: log.module ?? EMPTY_PLACEHOLDER },
            { key: '操作', value: log.operationName ?? EMPTY_PLACEHOLDER },
            { key: '操作标识', value: log.operationKey ?? EMPTY_PLACEHOLDER },
            { key: '操作类型', value: log.operationType ?? EMPTY_PLACEHOLDER },
            { key: '路由模板', value: log.routePath ?? EMPTY_PLACEHOLDER },
            { key: '请求 ID', value: log.requestId ? <Text copyable={{ content: log.requestId }} style={{ wordBreak: 'break-all' }}>{log.requestId}</Text> : EMPTY_PLACEHOLDER },
            { key: '耗时', value: log.durationMs == null ? EMPTY_PLACEHOLDER : `${log.durationMs} ms` },
            { key: 'IP 地址', value: log.ip ?? EMPTY_PLACEHOLDER },
            { key: '地点', value: log.location ?? EMPTY_PLACEHOLDER },
            { key: '浏览器', value: log.browser ?? EMPTY_PLACEHOLDER },
            { key: '操作系统', value: log.os ?? EMPTY_PLACEHOLDER },
            { key: 'User-Agent', value: log.userAgent ?? EMPTY_PLACEHOLDER },
            { key: '服务名', value: log.serviceName ?? EMPTY_PLACEHOLDER },
            { key: '进程角色', value: log.processRole ?? EMPTY_PLACEHOLDER },
            { key: '主机 / PID', value: `${log.hostname ?? EMPTY_PLACEHOLDER} / ${log.pid ?? EMPTY_PLACEHOLDER}` },
            { key: '请求时间', value: formatDateTime(log.createdAt) },
            ...(log.errorName || log.errorMessage ? [{ key: '错误', value: `${log.errorName ?? ''}: ${log.errorMessage ?? ''}` }] : []),
          ]} />
          {log.requestId && (
            <Space spacing={4} wrap>
              {hasPermission('system:trace:view') && <Button size="small" theme="borderless" onClick={() => navigate(`/system/trace?traceId=${encodeURIComponent(log.requestId!)}`)}>查看链路</Button>}
              {hasPermission('system:exception-log:list') && <Button size="small" theme="borderless" onClick={() => navigate(`/system/exception-logs?tab=events&traceId=${encodeURIComponent(log.requestId!)}`)}>查看关联异常</Button>}
            </Space>
          )}
          <div style={{ width: '100%' }}>
            <Title heading={6}>查询参数（已脱敏）</Title>
            {log.queryParams && Object.keys(log.queryParams).length ? <JsonBlock value={log.queryParams} /> : <Text type="tertiary">无查询参数</Text>}
          </div>
          <div style={{ width: '100%' }}>
            <Title heading={6}>请求体（已脱敏）</Title>
            {log.requestBody != null ? <JsonBlock value={log.requestBody} maxHeight={320} /> : <Text type="tertiary">无可展示请求体</Text>}
          </div>
        </Space>
      ) : <Empty title="日志不存在或已清理" />)}
    </SideSheet>
  );
}
