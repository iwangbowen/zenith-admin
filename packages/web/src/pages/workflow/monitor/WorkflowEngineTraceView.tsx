import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Empty, Spin, Space, Tag, Timeline, Tooltip, Typography } from '@douyinfe/semi-ui';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import type { WorkflowEngineTraceEntry, WorkflowInstanceTrace, WorkflowJobType } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'orange' | 'red' | 'violet' | 'light-blue';
type TimelineType = 'default' | 'ongoing' | 'success' | 'warning' | 'error';

interface Props {
  instanceId: number;
}

const JOB_TYPE_LABEL: Record<WorkflowJobType, string> = {
  delay_wake: '延时唤醒', task_timeout: '任务超时', trigger_dispatch: '触发器调度', external_dispatch: '外部审批',
  subprocess_spawn: '子流程派生', subprocess_join: '子流程汇聚', event_dispatch: '事件派发', webhook_delivery: 'Webhook 投递',
};

const STATUS_META: Record<string, { text: string; color: TagColor; timeline: TimelineType }> = {
  pending: { text: '待处理', color: 'grey', timeline: 'default' },
  waiting: { text: '等待中', color: 'blue', timeline: 'ongoing' },
  running: { text: '运行中', color: 'blue', timeline: 'ongoing' },
  succeeded: { text: '成功', color: 'green', timeline: 'success' },
  approved: { text: '通过', color: 'green', timeline: 'success' },
  rejected: { text: '驳回', color: 'red', timeline: 'error' },
  failed: { text: '失败', color: 'orange', timeline: 'warning' },
  dead: { text: '死信', color: 'red', timeline: 'error' },
  canceled: { text: '已取消', color: 'grey', timeline: 'default' },
  skipped: { text: '跳过', color: 'grey', timeline: 'default' },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { text: status, color: 'grey' as TagColor, timeline: 'default' as TimelineType };
}

const BANNER_TYPE: Record<string, 'info' | 'warning' | 'danger' | 'success'> = {
  completed: 'success', running: 'info', blocked: 'danger', rejected: 'warning', canceled: 'info', withdrawn: 'info', draft: 'info',
};

const SEVERITY_META: Record<string, { text: string; color: TagColor }> = {
  critical: { text: '严重', color: 'red' },
  warning: { text: '警告', color: 'orange' },
  info: { text: '提示', color: 'blue' },
};

function renderExecutions(entry: WorkflowEngineTraceEntry) {
  if (entry.executions.length === 0) return null;
  return (
    <div style={{ marginTop: 6, borderLeft: '2px solid var(--semi-color-fill-1)', paddingLeft: 10 }}>
      {entry.executions.map((ex) => {
        const m = statusMeta(ex.status);
        return (
          <div key={ex.attempt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '20px', flexWrap: 'wrap' }}>
            <Typography.Text type="tertiary" size="small">第 {ex.attempt} 次</Typography.Text>
            <Tag size="small" color={m.color}>{m.text}</Tag>
            {ex.requestUrl && <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 260 }}>{ex.requestMethod ? `${ex.requestMethod} ` : ''}{ex.requestUrl}</Typography.Text>}
            {ex.responseStatus != null && <Typography.Text type="tertiary" size="small">→ {ex.responseStatus}</Typography.Text>}
            {ex.durationMs != null && <Typography.Text type="tertiary" size="small">{ex.durationMs}ms</Typography.Text>}
            {ex.errorMessage && <Tooltip content={<div style={{ maxWidth: 360, wordBreak: 'break-all' }}>{ex.errorMessage}</div>}><Typography.Text type="danger" size="small" ellipsis={{ rows: 1 }} style={{ maxWidth: 220 }}>{ex.errorMessage}</Typography.Text></Tooltip>}
          </div>
        );
      })}
    </div>
  );
}

export default function WorkflowEngineTraceView({ instanceId }: Props) {
  const [data, setData] = useState<WorkflowInstanceTrace | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchTrace = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<WorkflowInstanceTrace>(`/api/workflows/instances/${instanceId}/trace`);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => { void fetchTrace(); }, [fetchTrace]);

  if (loading && !data) return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  if (!data) return <Empty description="暂无运行轨迹" />;

  const { explanation: ex, trace } = data;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" theme="borderless" icon={<RefreshCw size={14} className={loading ? 'spin' : ''} />} disabled={loading} onClick={() => void fetchTrace()}>刷新</Button>
      </div>

      {/* 引擎解释 */}
      <Banner
        type={BANNER_TYPE[ex.state] ?? 'info'}
        closeIcon={null}
        title={ex.headline}
        description={(
          <Space vertical align="start" spacing={6} style={{ width: '100%', marginTop: 4 }}>
            {ex.blockers.length === 0 && <Typography.Text size="small" type="tertiary">当前无阻塞项</Typography.Text>}
            {ex.blockers.map((b, i) => {
              const sm = SEVERITY_META[b.severity] ?? SEVERITY_META.info;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Tag size="small" color={sm.color}>{sm.text}</Tag>
                  <Typography.Text strong size="small">{b.title}</Typography.Text>
                  <Typography.Text size="small" type="tertiary">{b.detail}</Typography.Text>
                  {b.nextRetryAt && <Typography.Text size="small" type="tertiary"><Clock size={11} style={{ verticalAlign: -1 }} /> {b.nextRetryAt}</Typography.Text>}
                </div>
              );
            })}
            {ex.nextWakeAt && (
              <Typography.Text size="small" type="tertiary">
                下一个自动作业预计于 <b>{ex.nextWakeAt}</b> 执行
              </Typography.Text>
            )}
          </Space>
        )}
        style={{ marginBottom: 16 }}
      />

      {/* 运行轨迹时间线 */}
      <Typography.Title heading={6} style={{ marginBottom: 12 }}>运行轨迹（{trace.length}）</Typography.Title>
      {trace.length === 0
        ? <Empty description="暂无轨迹记录" />
        : (
          <Timeline>
            {trace.map((entry) => {
              const m = statusMeta(entry.status);
              const isJob = entry.kind === 'job';
              return (
                <Timeline.Item key={entry.key} time={entry.at} type={m.timeline}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Tag size="small" color={isJob ? 'violet' : 'cyan'} type="light">{isJob ? '作业' : '任务'}</Tag>
                    <Typography.Text strong>{entry.title}</Typography.Text>
                    <Tag size="small" color={m.color}>{m.text}</Tag>
                    {entry.nodeName && <Typography.Text type="tertiary" size="small">@ {entry.nodeName}</Typography.Text>}
                    {isJob && entry.attempts != null && <Typography.Text type="tertiary" size="small">尝试 {entry.attempts}/{entry.maxAttempts}</Typography.Text>}
                    {entry.traceId && <Tooltip content={`traceId: ${entry.traceId}`}><Tag size="small" color="grey" type="ghost" style={{ fontFamily: 'monospace' }}>{entry.traceId.slice(0, 8)}</Tag></Tooltip>}
                  </div>
                  {entry.comment && <Typography.Paragraph type="secondary" size="small" style={{ margin: '4px 0 0' }}>意见：{entry.comment}</Typography.Paragraph>}
                  {isJob && entry.nextRetryAt && (
                    <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 2 }}>
                      <Clock size={11} style={{ verticalAlign: -1 }} /> 下次执行 {entry.nextRetryAt}
                    </Typography.Text>
                  )}
                  {isJob && entry.lastError && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                      <AlertTriangle size={12} color="var(--semi-color-danger)" style={{ marginTop: 3, flexShrink: 0 }} />
                      <Typography.Text type="danger" size="small" style={{ wordBreak: 'break-all' }}>{entry.lastError}</Typography.Text>
                    </div>
                  )}
                  {renderExecutions(entry)}
                </Timeline.Item>
              );
            })}
          </Timeline>
        )}
    </div>
  );
}
