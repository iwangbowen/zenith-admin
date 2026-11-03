import { Descriptions, Empty, SideSheet, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ApiAccessLog } from '@zenith/shared/platform';
import { useApiAccessLogDetail } from '@/hooks/queries/api-access-logs';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text, Title } = Typography;

function JsonBlock({ title, value }: Readonly<{ title: string; value: unknown }>) {
  if (value == null) return <Empty title={`无${title}`} style={{ padding: 12 }} />;
  return (
    <div style={{ width: '100%' }}>
      <Title heading={6} style={{ marginBottom: 8 }}>{title}</Title>
      <pre style={{ margin: 0, maxHeight: 280, overflow: 'auto', padding: 12, borderRadius: 'var(--semi-border-radius-small)', background: 'var(--semi-color-fill-0)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function ApiAccessLogDetailSheet({ id, onClose }: Readonly<{ id: number | undefined; onClose: () => void }>) {
  const query = useApiAccessLogDetail(id, id !== undefined);
  const log = query.data as ApiAccessLog | undefined;
  const success = log?.responseCode != null && log.responseCode >= 200 && log.responseCode < 400;
  return (
    <SideSheet title={log ? `API 访问日志 #${log.id}` : 'API 访问日志详情'} visible={id !== undefined} onCancel={onClose} width={820} closeOnEsc>
      {query.isLoading ? <Text>加载中…</Text> : log ? (
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <Space spacing={8} wrap>
            <Tag color={success ? 'green' : 'red'}>{log.responseCode ?? '未知状态'}</Tag>
            <Tag color="blue">{log.method}</Tag>
            <Text code>{log.path}</Text>
          </Space>
          <Descriptions size="small" column={2} data={[
            { key: '主体', value: log.username ?? log.principalType },
            { key: '主体类型', value: log.principalType },
            { key: '认证方式', value: log.authType },
            { key: '模块', value: log.module ?? EMPTY_PLACEHOLDER },
            { key: '操作', value: log.operationName ?? log.operationKey ?? EMPTY_PLACEHOLDER },
            { key: '路由模板', value: log.routePath ?? EMPTY_PLACEHOLDER },
            { key: '请求 ID', value: log.requestId ?? EMPTY_PLACEHOLDER },
            { key: '耗时', value: log.durationMs == null ? EMPTY_PLACEHOLDER : `${log.durationMs} ms` },
            { key: 'IP', value: log.ip ?? EMPTY_PLACEHOLDER },
            { key: '地点', value: log.location ?? EMPTY_PLACEHOLDER },
            { key: '浏览器', value: log.browser ?? EMPTY_PLACEHOLDER },
            { key: '操作系统', value: log.os ?? EMPTY_PLACEHOLDER },
            { key: '服务节点', value: `${log.serviceName ?? '-'} / ${log.processRole ?? '-'} / ${log.hostname ?? '-'}` },
            { key: '请求时间', value: formatDateTime(log.createdAt), span: 2 },
            ...(log.errorName ? [{ key: '错误', value: `${log.errorName}: ${log.errorMessage ?? ''}`, span: 2 }] : []),
          ]} />
          <JsonBlock title="查询参数（已脱敏）" value={log.queryParams} />
          <JsonBlock title="请求体（已脱敏）" value={log.requestBody} />
        </Space>
      ) : <Empty title="日志不存在或已清理" />}
    </SideSheet>
  );
}

