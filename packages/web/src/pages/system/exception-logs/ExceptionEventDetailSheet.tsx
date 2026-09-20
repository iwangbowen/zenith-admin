import { Button, Descriptions, Empty, SideSheet, Space, Typography } from '@douyinfe/semi-ui';
import type { ErrorEvent } from '@zenith/shared/analytics';
import { ANALYTICS_ENVIRONMENT_LABELS } from '@zenith/shared/analytics';
import { useNavigate } from 'react-router-dom';
import { CodeBlock, ErrorLevelTag, ErrorTypeIcon, ErrorTypeTag, safeJson } from '@/components/error-tracking';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Paragraph, Text, Title } = Typography;

interface EventContext {
  request?: Record<string, unknown>;
  job?: Record<string, unknown>;
  errorDetails?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

function contextOf(event: ErrorEvent): EventContext {
  return (event.context ?? {}) as EventContext;
}

/** 链路跳转：日志查看器按 reqId 检索、链路追踪按 traceId 聚合、前端错误现场按同一 traceId 定位（权限各自门控） */
export function TraceActions({ traceId }: Readonly<{ traceId: string | null }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  if (!traceId) return null;
  return (
    <Space spacing={4} wrap>
      {hasPermission('system:trace:view') && (
        <Button size="small" theme="borderless" type="primary" onClick={() => navigate(`/system/trace?traceId=${encodeURIComponent(traceId)}`)}>
          查看链路
        </Button>
      )}
      {hasPermission('monitor:error:list') && (
        <Button size="small" theme="borderless" type="primary" onClick={() => navigate(`/analytics/errors?tab=events&traceId=${encodeURIComponent(traceId)}`)}>
          查看前端现场
        </Button>
      )}
      <Text copyable={{ content: traceId }} size="small" type="tertiary">{traceId}</Text>
    </Space>
  );
}

export interface ExceptionEventDetailSheetProps {
  readonly event: ErrorEvent | null;
  readonly onClose: () => void;
}

/** 单条异常事件详情：定位信息 → 堆栈 → 请求快照 / 作业 / 异常细节 / 附加上下文 */
export function ExceptionEventDetailSheet({ event, onClose }: ExceptionEventDetailSheetProps) {
  const ctx = event ? contextOf(event) : {};
  return (
    <SideSheet
      title={event ? <Space spacing={8}><ErrorTypeIcon type={event.errorType} /><span>异常事件 #{event.id}</span></Space> : '异常事件'}
      visible={event !== null}
      onCancel={onClose}
      width={760}
      closeOnEsc
    >
      {event && (
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <Space spacing={8} wrap>
            <ErrorTypeTag type={event.errorType} />
            <ErrorLevelTag level={event.level} />
            {event.errorName && <Text code>{event.errorName}{event.errorCode ? ` · ${event.errorCode}` : ''}</Text>}
          </Space>
          <Paragraph style={{ margin: 0, wordBreak: 'break-word' }}>{event.message}</Paragraph>

          <Descriptions
            size="small"
            data={[
              { key: '发生时间', value: formatDateTime(event.createdAt) },
              { key: '链路 ID', value: <TraceActions traceId={event.traceId} /> },
              { key: '路由', value: event.route ? <Text code>{event.httpMethod ? `${event.httpMethod} ` : ''}{event.route}</Text> : EMPTY_PLACEHOLDER },
              { key: 'HTTP 状态', value: event.httpStatus ?? EMPTY_PLACEHOLDER },
              { key: '请求地址', value: event.httpUrl ? <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 520 }}>{event.httpUrl}</Text> : EMPTY_PLACEHOLDER },
              { key: '任务 / 作业', value: event.jobType ? <Text code>{event.jobType}{event.jobId ? ` #${event.jobId}` : ''}</Text> : EMPTY_PLACEHOLDER },
              { key: '进程', value: `${event.hostname ?? EMPTY_PLACEHOLDER} · pid ${event.pid ?? EMPTY_PLACEHOLDER} · ${event.processRole ?? EMPTY_PLACEHOLDER}` },
              { key: '版本 / 环境', value: `${event.release ?? EMPTY_PLACEHOLDER} · ${ANALYTICS_ENVIRONMENT_LABELS[event.environment] ?? event.environment}` },
              { key: '触发用户', value: event.username ? `${event.username}（#${event.userId}）` : event.userId ? `#${event.userId}` : '无登录态' },
              { key: '所属租户', value: event.affectedTenantId ?? '平台 / 无' },
            ]}
          />

          <div style={{ width: '100%' }}>
            <Title heading={6} style={{ marginBottom: 8 }}>堆栈</Title>
            {event.stack ? <CodeBlock maxHeight={360}>{event.stack}</CodeBlock> : <Empty title="没有堆栈信息" style={{ padding: 12 }} />}
          </div>

          {ctx.request && (
            <div style={{ width: '100%' }}>
              <Title heading={6} style={{ marginBottom: 8 }}>请求快照（已脱敏）</Title>
              <CodeBlock maxHeight={320}>{safeJson(ctx.request)}</CodeBlock>
            </div>
          )}
          {ctx.job && (
            <div style={{ width: '100%' }}>
              <Title heading={6} style={{ marginBottom: 8 }}>作业上下文</Title>
              <CodeBlock maxHeight={200}>{safeJson(ctx.job)}</CodeBlock>
            </div>
          )}
          {ctx.errorDetails && (
            <div style={{ width: '100%' }}>
              <Title heading={6} style={{ marginBottom: 8 }}>异常细节</Title>
              <CodeBlock maxHeight={200}>{safeJson(ctx.errorDetails)}</CodeBlock>
            </div>
          )}
          {ctx.extra && (
            <div style={{ width: '100%' }}>
              <Title heading={6} style={{ marginBottom: 8 }}>附加上下文</Title>
              <CodeBlock maxHeight={200}>{safeJson(ctx.extra)}</CodeBlock>
            </div>
          )}
        </Space>
      )}
    </SideSheet>
  );
}
