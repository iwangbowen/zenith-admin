import type { ReactNode } from 'react';
import { Button, Descriptions, Empty, SideSheet, Space, Spin, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { API_ACCESS_CREDENTIAL_LABELS, API_ACCESS_ACCESSOR_TYPE_LABELS } from '@zenith/shared/platform';
import JsonBlock from '@/components/JsonBlock';
import { RefreshButton } from '@/components/toolbar-controls';
import { useApiAccessLogDetail } from '@/hooks/queries/api-access-logs';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text, Title } = Typography;

interface InfoItem {
  key: string;
  value: ReactNode;
  span?: number;
}

function InfoSection({ title, data }: Readonly<{ title: string; data: InfoItem[] }>) {
  return (
    <section style={{ width: '100%' }}>
      <Title heading={6} style={{ margin: '0 0 8px' }}>{title}</Title>
      <Descriptions
        size="small"
        align="plain"
        layout="horizontal"
        column={2}
        style={{ width: '100%', overflowWrap: 'anywhere' }}
        data={data}
      />
    </section>
  );
}

function copyableText(value: string | null, code = false) {
  if (!value) return EMPTY_PLACEHOLDER;
  return <Text code={code} copyable={{ content: value }} style={{ wordBreak: 'break-all' }}>{value}</Text>;
}

export function ApiAccessLogDetailSheet({ id, onClose }: Readonly<{ id: number | undefined; onClose: () => void }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const query = useApiAccessLogDetail(id, id !== undefined);
  // A closed sheet or a changed id must never show the previous request's payload.
  const log = id !== undefined && query.data?.id === id ? query.data : undefined;
  const success = log?.responseCode != null && log.responseCode >= 200 && log.responseCode < 400;

  const identityInfo = log ? [
    { key: '访问人 / 调用方', value: log.accessorName ?? API_ACCESS_ACCESSOR_TYPE_LABELS[log.accessorType] },
    { key: '访问人 / 调用方 ID', value: copyableText(log.accessorId, true) },
    { key: '访问端类型', value: API_ACCESS_ACCESSOR_TYPE_LABELS[log.accessorType] },
    { key: '凭证方式', value: API_ACCESS_CREDENTIAL_LABELS[log.credentialType] },
    ...(log.userId != null ? [{ key: '管理端用户 ID', value: log.userId }] : []),
    ...(log.memberId != null ? [{ key: '会员用户 ID', value: log.memberId }] : []),
    ...(log.deviceId != null ? [{ key: '设备 ID', value: log.deviceId }] : []),
    ...(log.clientId ? [{ key: '开放应用 Client ID', value: copyableText(log.clientId, true) }] : []),
    { key: '所属租户', value: log.tenantId ?? '平台 / 无租户' },
    ...(log.impersonatorId != null ? [{ key: '实际操作人', value: `${log.impersonatorName ?? '管理员'}（#${log.impersonatorId}，模拟登录）` }] : []),
  ] satisfies InfoItem[] : [];

  const requestInfo = log ? [
    { key: '模块', value: log.module ?? EMPTY_PLACEHOLDER },
    { key: '操作', value: log.operationName ?? EMPTY_PLACEHOLDER },
    { key: '操作标识', value: log.operationKey ? <Text code>{log.operationKey}</Text> : EMPTY_PLACEHOLDER },
    { key: '操作类型', value: log.operationType ?? EMPTY_PLACEHOLDER },
    { key: '路由模板', value: log.routePath ? <Text code style={{ wordBreak: 'break-all' }}>{log.routePath}</Text> : EMPTY_PLACEHOLDER },
    { key: '请求 ID', value: copyableText(log.requestId) },
    { key: 'HTTP 状态', value: log.responseCode ?? EMPTY_PLACEHOLDER },
    { key: '耗时', value: log.durationMs == null ? EMPTY_PLACEHOLDER : `${log.durationMs} ms` },
    { key: '请求时间', value: formatDateTime(log.createdAt) },
    ...(log.errorName || log.errorMessage ? [{ key: '错误', value: `${log.errorName ?? ''}${log.errorMessage ? `：${log.errorMessage}` : ''}`, span: 2 }] : []),
  ] satisfies InfoItem[] : [];

  const runtimeInfo = log ? [
    { key: 'IP 地址', value: log.ip ?? EMPTY_PLACEHOLDER },
    { key: '地点', value: log.location ?? EMPTY_PLACEHOLDER },
    { key: '浏览器', value: log.browser ?? EMPTY_PLACEHOLDER },
    { key: '操作系统', value: log.os ?? EMPTY_PLACEHOLDER },
    { key: '服务名', value: log.serviceName ?? EMPTY_PLACEHOLDER },
    { key: '进程角色', value: log.processRole ?? EMPTY_PLACEHOLDER },
    { key: '主机 / PID', value: `${log.hostname ?? EMPTY_PLACEHOLDER} / ${log.pid ?? EMPTY_PLACEHOLDER}` },
    { key: 'User-Agent', value: log.userAgent ?? EMPTY_PLACEHOLDER, span: 2 },
  ] satisfies InfoItem[] : [];

  return (
    <SideSheet title={log ? `API 访问日志 #${log.id}` : 'API 访问日志详情'} visible={id !== undefined} onCancel={onClose} width={820} closeOnEsc>
      {id !== undefined && (query.isLoading ? <Spin spinning><Text>正在加载访问日志…</Text></Spin> : query.isError ? (
        <Empty title="日志详情加载失败" description={query.error.message}>
          <RefreshButton onClick={() => void query.refetch()} loading={query.isFetching} />
        </Empty>
      ) : log ? (
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <Space spacing={8} wrap style={{ width: '100%' }}>
            <Tag color={log.responseCode == null ? 'grey' : success ? 'green' : 'red'}>{log.responseCode ?? '未知状态'}</Tag>
            <Tag color="blue">{log.method}</Tag>
            <Text code ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{log.path}</Text>
          </Space>
          <Tabs type="line" collapsible="auto" lazyRender style={{ width: '100%' }}>
            <TabPane tab="基础信息" itemKey="basic">
              <Space vertical align="start" spacing={20} style={{ width: '100%', paddingTop: 12 }}>
                <InfoSection title="访问方" data={identityInfo} />
                <InfoSection title="请求" data={requestInfo} />
                <InfoSection title="运行环境" data={runtimeInfo} />
                {log.requestId && (
                  <Space spacing={4} wrap>
                    {hasPermission('system:trace:view') && <Button size="small" theme="borderless" onClick={() => navigate(`/system/trace?traceId=${encodeURIComponent(log.requestId!)}`)}>查看链路</Button>}
                    {hasPermission('system:exception-log:list') && <Button size="small" theme="borderless" onClick={() => navigate(`/system/exception-logs?tab=events&traceId=${encodeURIComponent(log.requestId!)}`)}>查看关联异常</Button>}
                  </Space>
                )}
              </Space>
            </TabPane>
            <TabPane tab="请求快照" itemKey="snapshot">
              <Space vertical align="start" spacing={20} style={{ width: '100%', paddingTop: 12 }}>
                <div style={{ width: '100%' }}>
                  <Title heading={6} style={{ margin: '0 0 8px' }}>查询参数（已脱敏）</Title>
                  {log.queryParams && Object.keys(log.queryParams).length ? <JsonBlock value={log.queryParams} /> : <Text type="tertiary">无查询参数</Text>}
                </div>
                <div style={{ width: '100%' }}>
                  <Title heading={6} style={{ margin: '0 0 8px' }}>请求体（已脱敏）</Title>
                  {log.requestBody != null ? <JsonBlock value={log.requestBody} maxHeight={320} /> : <Text type="tertiary">无可展示请求体</Text>}
                </div>
              </Space>
            </TabPane>
          </Tabs>
        </Space>
      ) : <Empty title="日志不存在或已清理" />)}
    </SideSheet>
  );
}
