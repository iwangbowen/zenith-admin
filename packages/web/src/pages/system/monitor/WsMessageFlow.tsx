import { useMemo, useState } from 'react';
import { Button, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  selectWsMessageSamples,
  WS_BUSINESS_MESSAGE_SAMPLE_LIMIT, WS_CONTROL_MESSAGE_SAMPLE_LIMIT, WS_EXCEPTION_MESSAGE_SAMPLE_LIMIT,
  WS_MESSAGE_STREAM_SCOPES, WS_MESSAGE_STREAM_SCOPE_LABELS,
  type MonitorWsHeartbeat, type MonitorWsMessage, type MonitorWsMetrics, type WsMessageStreamScope,
} from '@zenith/shared/platform';
import ConfigurableTable from '@/components/ConfigurableTable';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { usePagination } from '@/hooks/usePagination';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';

const { Text } = Typography;
const numberFormatter = new Intl.NumberFormat('zh-CN');

export function WsMessageResult({ message }: { readonly message: MonitorWsMessage }) {
  if (!message.success) return <Tag color="red" size="small">失败</Tag>;
  return <Tag color="green" size="small">{message.direction === 'inbound' ? '已解析' : '已写出'}</Tag>;
}

const messageColumns: ColumnProps<MonitorWsMessage>[] = [
  dateTimeColumn('时间', 'at'),
  { title: '方向', dataIndex: 'direction', width: 80, render: (value: MonitorWsMessage['direction']) => <Tag color={value === 'inbound' ? 'blue' : 'green'} size="small">{value === 'inbound' ? '入站' : '出站'}</Tag> },
  { title: '类型', dataIndex: 'type', minWidth: 180 },
  { title: 'Topic', dataIndex: 'topic', width: 130, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
  { title: '节点', dataIndex: 'nodeId', width: 150 },
  { title: '连接', dataIndex: 'connId', width: 90, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
  { title: '用户', dataIndex: 'userId', width: 80, render: (value: number | null) => value ?? EMPTY_PLACEHOLDER },
  { title: '大小', dataIndex: 'bytes', width: 90, render: (value: number) => `${numberFormatter.format(value)} B` },
  { title: '本地结果', dataIndex: 'success', width: 100, render: (_: unknown, message: MonitorWsMessage) => <WsMessageResult message={message} /> },
];
const heartbeatColumns: ColumnProps<MonitorWsHeartbeat>[] = [
  { title: '连接', dataIndex: 'connId', minWidth: 100 },
  { title: '节点', dataIndex: 'nodeId', width: 150 },
  { title: '用户', dataIndex: 'userId', width: 80 },
  { title: '收到 ping', dataIndex: 'pingCount', width: 110, align: 'right', render: (value: number) => numberFormatter.format(value) },
  { title: '写出 pong', dataIndex: 'pongCount', width: 110, align: 'right', render: (value: number) => numberFormatter.format(value) },
  { title: '失败', dataIndex: 'failedCount', width: 80, align: 'right', render: (value: number) => value > 0 ? <Tag color="red" size="small">{numberFormatter.format(value)}</Tag> : '0' },
  dateTimeColumn('最近 ping', 'lastPingAt'),
  dateTimeColumn('最近 pong', 'lastPongAt'),
  dateTimeColumn('最近失败', 'lastFailureAt'),
];

interface WsMessageFlowProps {
  readonly metrics: MonitorWsMetrics;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly initialKeyword?: string;
}

/** 三个独立采样窗口的只读视图；不接触消息正文。 */
export default function WsMessageFlow({ metrics, refreshing, onRefresh, initialKeyword = '' }: WsMessageFlowProps) {
  const [scope, setScope] = useState<WsMessageStreamScope>('business');
  const [keyword, setKeyword] = useState(initialKeyword);
  const [type, setType] = useState<string>();
  const [node, setNode] = useState<string>();
  const [direction, setDirection] = useState<MonitorWsMessage['direction']>();
  const [failedOnly, setFailedOnly] = useState(false);
  const samples = useMemo(() => selectWsMessageSamples(metrics, scope === 'heartbeats' ? 'control' : scope), [metrics, scope]);
  const allSamples = useMemo(() => selectWsMessageSamples(metrics, 'all'), [metrics]);
  const nodeOptions = useMemo(() => [...new Set([
    ...allSamples.map((message) => message.nodeId), ...metrics.heartbeats.map((heartbeat) => heartbeat.nodeId),
  ])].sort().map((value) => ({ value, label: value })), [allSamples, metrics.heartbeats]);
  const typeOptions = useMemo(() => [...new Set(samples.map((message) => message.type))].sort().map((value) => ({ value, label: value })), [samples]);
  const normalized = keyword.trim().toLowerCase();
  const filtered = useMemo(() => samples.filter((message) => (
    (!normalized || [message.type, message.topic ?? '', message.nodeId, message.connId ?? '', String(message.userId ?? '')].some((value) => value.toLowerCase().includes(normalized)))
    && (!type || message.type === type)
    && (!node || message.nodeId === node)
    && (!direction || message.direction === direction)
    && (!failedOnly || !message.success)
  )), [samples, normalized, type, node, direction, failedOnly]);
  const filteredHeartbeats = useMemo(() => metrics.heartbeats.filter((heartbeat) => (
    (!normalized || [heartbeat.nodeId, heartbeat.connId, String(heartbeat.userId)].some((value) => value.toLowerCase().includes(normalized)))
    && (!node || heartbeat.nodeId === node)
    && (!failedOnly || heartbeat.failedCount > 0)
  )).sort((a, b) => b.failedCount - a.failedCount || (b.lastPingAt ?? 0) - (a.lastPingAt ?? 0)), [metrics.heartbeats, normalized, node, failedOnly]);
  const pagination = usePagination({ pageSize: 20, resetKey: [scope, keyword, type, node, direction, failedOnly] });
  const heartbeatPagination = usePagination({ pageSize: 20, resetKey: [keyword, node, failedOnly] });
  // 四个页签统一显示“消息条数”；心跳摘要表另行展示在线连接数。
  const counts = { business: metrics.messages.length, exceptions: metrics.exceptionMessages.length, heartbeats: metrics.controlMessages.length, all: allSamples.length };
  const hasFilter = Boolean(keyword || type || node || direction || failedOnly);
  const changeScope = (value: WsMessageStreamScope) => {
    setScope(value);
    setType(undefined);
    setDirection(undefined);
    setFailedOnly(false);
  };
  const renderMessages = () => (
    <ConfigurableTable<MonitorWsMessage>
      columnSettingsKey="ws-monitor-message-samples"
      columns={messageColumns}
      dataSource={filtered}
      rowKey={(message) => `${message?.nodeId}:${message?.id}`}
      size="small"
      pagination={pagination.buildPagination(filtered.length)}
      empty={scope === 'business' ? '暂无业务消息，心跳可在「心跳」视图查看' : '暂无符合条件的消息'}
      onRefresh={onRefresh}
      refreshLoading={refreshing}
    />
  );

  return (
    <section className="ws-monitor-section ws-message-flow">
      <div className="ws-message-flow__summary">
        <Text type="tertiary" size="small">业务 {counts.business}/{WS_BUSINESS_MESSAGE_SAMPLE_LIMIT} · 心跳明细 {counts.heartbeats}/{WS_CONTROL_MESSAGE_SAMPLE_LIMIT} · 在线心跳连接 {metrics.heartbeats.length} · 异常 {counts.exceptions}/{WS_EXCEPTION_MESSAGE_SAMPLE_LIMIT}</Text>
        <Button size="small" theme="borderless" type={counts.exceptions > 0 ? 'danger' : 'tertiary'} onClick={() => changeScope('exceptions')}>查看异常（{counts.exceptions}）</Button>
      </div>
      <div className="ws-message-flow__scopes" role="tablist" aria-label="消息类别">
        {WS_MESSAGE_STREAM_SCOPES.map((value) => (
          <button key={value} type="button" role="tab" aria-selected={scope === value} className={scope === value ? 'is-active' : ''} onClick={() => changeScope(value)}>
            {WS_MESSAGE_STREAM_SCOPE_LABELS[value]}（{counts[value]}）
          </button>
        ))}
      </div>
      <div className="ws-monitor-filters ws-message-flow__filters">
        <KeywordInput value={keyword} onChange={setKeyword} placeholder={scope === 'heartbeats' ? '连接 / 用户 / 节点' : '类型 / Topic / 连接 / 用户 / 节点'} />
        <FilterSelect value={node} onChange={setNode} placeholder="全部节点" items={nodeOptions} width={150} />
        {scope !== 'heartbeats' && <FilterSelect value={type} onChange={setType} placeholder="全部类型" items={typeOptions} width={190} />}
        {scope !== 'heartbeats' && (
          <div className="ws-message-flow__directions">
            <Button size="small" theme={!direction ? 'solid' : 'light'} onClick={() => setDirection(undefined)}>全部方向</Button>
            <Button size="small" theme={direction === 'inbound' ? 'solid' : 'light'} onClick={() => setDirection('inbound')}>入站</Button>
            <Button size="small" theme={direction === 'outbound' ? 'solid' : 'light'} onClick={() => setDirection('outbound')}>出站</Button>
          </div>
        )}
        <Button size="small" theme={failedOnly ? 'solid' : 'light'} onClick={() => setFailedOnly((value) => !value)}>仅失败</Button>
        {hasFilter && <Button size="small" theme="borderless" onClick={() => { setKeyword(''); setType(undefined); setNode(undefined); setDirection(undefined); setFailedOnly(false); }}>清除筛选</Button>}
      </div>
      {scope === 'heartbeats' ? (
        <>
          <Text strong>原始 ping / pong 明细（{filtered.length}）</Text>
          <Text type="tertiary" size="small" className="ws-message-flow__hint">页签数量统一表示消息条数；这里直接展示每条心跳。下方的在线连接摘要用于查看累计次数，当前 {metrics.heartbeats.length} 个连接。</Text>
          {renderMessages()}
          <div className="ws-message-flow__summary ws-message-flow__summary--secondary">
            <Text strong>在线连接心跳摘要（{filteredHeartbeats.length} / {metrics.heartbeats.length}）</Text>
            <Text type="tertiary" size="small">断开后摘要移除；失败明细仍保留在异常窗口。</Text>
          </div>
          <ConfigurableTable<MonitorWsHeartbeat>
            columnSettingsKey="ws-monitor-heartbeat-summary"
            columns={heartbeatColumns}
            dataSource={filteredHeartbeats}
            rowKey={(heartbeat) => `${heartbeat?.nodeId}:${heartbeat?.connId}`}
            size="small"
            pagination={heartbeatPagination.buildPagination(filteredHeartbeats.length)}
            empty="暂无符合条件的在线连接心跳"
            onRefresh={onRefresh}
            refreshLoading={refreshing}
          />
        </>
      ) : renderMessages()}
      <Text type="tertiary" size="small" className="ws-message-flow__hint">仅采集元数据。已解析表示入站协议通过；已写出表示本节点写出成功，不代表业务完成或客户端确认收到。</Text>
    </section>
  );
}
