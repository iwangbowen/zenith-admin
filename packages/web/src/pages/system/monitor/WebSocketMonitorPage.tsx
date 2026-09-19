import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Empty, Input, Select, SideSheet, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity, Copy, RadioTower, RefreshCw, Search, X } from 'lucide-react';
import { useMonitorWsMetrics } from '@/hooks/queries/monitor';
import { usePagination } from '@/hooks/usePagination';
import ConfigurableTable from '@/components/ConfigurableTable';
import DateTimeText from '@/components/DateTimeText';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';
import { copyTextWithToast } from '@/utils/clipboard';
import { formatSecondsHuman } from '@/utils/format';
import { useNowTick } from '@/hooks/useNowTick';
import {
  describeWsClient,
  groupWsDisconnectReasons,
  inferWsReconnects,
  isWsConnectionActive,
  statWsClients,
  statWsTopicDirections,
  summarizeWsHealth,
  type MonitorWsConnection,
  type MonitorWsDisconnect,
  type MonitorWsMessage,
  type MonitorWsNode,
  type WsTopicDirectionStat,
} from '@zenith/shared/platform';
import WsTopologyView, { type WsNodeRate } from './WsTopologyView';
import './WebSocketMonitorPage.css';

const { Title, Text } = Typography;

type ConnectionStatus = 'active' | 'idle';
const numberFormatter = new Intl.NumberFormat('zh-CN');
const formatNumber = (value: number) => numberFormatter.format(value);
const formatRate = (value: number) => (Number.isInteger(value) ? formatNumber(value) : value.toFixed(1));

function toStatus(connection: MonitorWsConnection, now: number): ConnectionStatus {
  return isWsConnectionActive(connection.lastActivityAt, now) ? 'active' : 'idle';
}

/**
 * 连接活跃 / 空闲标签。
 *
 * 语义是「由最后活动时间派生的在线态」，与启用 / 禁用无关，因此不适用 `renderEnabledStatusTag`
 * （该类两态标签的文案与配色由 `COMMON_STATUS_LABELS` 定义，这里两个分支的文案都不同）。
 * 列与详情面板共用同一个组件，避免同一状态在两处漂移。
 */
function StatusTag({ status }: { status: ConnectionStatus }) {
  return status === 'active'
    ? <Tag color="green" size="small">活跃</Tag>
    : <Tag color="orange" size="small">空闲</Tag>;
}

export default function WebSocketMonitorPage() {
  const [live, setLive] = useState(true);
  const query = useMonitorWsMetrics(live ? 5000 : false);
  const metrics = query.data ?? null;
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<ConnectionStatus | 'all'>('all');
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [activeView, setActiveView] = useState('connections');
  const [messageDirection, setMessageDirection] = useState<'all' | MonitorWsMessage['direction']>('all');
  const [messageKeyword, setMessageKeyword] = useState('');
  const [messageType, setMessageType] = useState<string>('all');
  const [messageNode, setMessageNode] = useState<string>('all');
  const [messageResult, setMessageResult] = useState<'all' | 'success' | 'failed'>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [disconnectNode, setDisconnectNode] = useState<string>('all');
  /** 详情面板只存 connId：渲染时从最新快照取，轮询刷新后面板不会停在打开那一刻 */
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  /** 连接断开后仍可查看的最后一次快照（配合「已断开」提示） */
  const [selectedSnapshot, setSelectedSnapshot] = useState<MonitorWsConnection | null>(null);
  const connectionsPagination = usePagination(20);
  const disconnectsPagination = usePagination(20);
  /** 共享节拍（30s）：暂停轮询时「持续时间 / 活跃判定 / 平均在线时长」仍能推进 */
  const now = useNowTick();

  const messages = useMemo(() => metrics?.messages ?? [], [metrics]);
  const nodes = useMemo(() => metrics?.nodes ?? [], [metrics]);

  const health = useMemo(
    () => (metrics ? summarizeWsHealth(metrics.connections, metrics.currentUsers, messages, now) : null),
    [metrics, messages, now],
  );
  const reasonStats = useMemo(() => groupWsDisconnectReasons(metrics?.recentDisconnects ?? []), [metrics]);
  const topicStats = useMemo(() => statWsTopicDirections(messages), [messages]);
  const reconnects = useMemo(
    () => (metrics ? inferWsReconnects(metrics.connections, metrics.recentDisconnects) : []),
    [metrics],
  );
  const clientStats = useMemo(() => statWsClients(metrics?.connections ?? []), [metrics]);

  /** 累计收发差值换算实时速率；进程重启导致计数回退时丢弃本轮 */
  const [rates, setRates] = useState<{ sentPerSec: number; recvPerSec: number } | null>(null);
  const prevTotalsRef = useRef<{ at: number; sent: number; recv: number } | null>(null);
  useEffect(() => {
    if (!metrics) return;
    const now = Date.now();
    const prev = prevTotalsRef.current;
    prevTotalsRef.current = { at: now, sent: metrics.totalSent, recv: metrics.totalRecv };
    if (!prev || now <= prev.at) return;
    const seconds = (now - prev.at) / 1000;
    const deltaSent = metrics.totalSent - prev.sent;
    const deltaRecv = metrics.totalRecv - prev.recv;
    if (deltaSent < 0 || deltaRecv < 0) {
      setRates(null);
      return;
    }
    setRates({
      sentPerSec: Math.round((deltaSent / seconds) * 10) / 10,
      recvPerSec: Math.round((deltaRecv / seconds) * 10) / 10,
    });
  }, [metrics]);

  /** 各网关节点收发速率（轮询差值换算，进程重启回退时丢弃本轮） */
  const [nodeRates, setNodeRates] = useState<Record<string, WsNodeRate>>({});
  const prevNodesRef = useRef<{ at: number; byId: Map<string, { sent: number; recv: number }> } | null>(null);
  useEffect(() => {
    if (!metrics) return;
    const now = Date.now();
    const byId = new Map(metrics.nodes.map((n) => [n.nodeId, { sent: n.sent, recv: n.recv }]));
    const prev = prevNodesRef.current;
    prevNodesRef.current = { at: now, byId };
    if (!prev || now <= prev.at) return;
    const seconds = (now - prev.at) / 1000;
    const next: Record<string, WsNodeRate> = {};
    for (const [nodeId, cur] of byId) {
      const p = prev.byId.get(nodeId);
      if (!p) continue;
      const deltaSent = cur.sent - p.sent;
      const deltaRecv = cur.recv - p.recv;
      if (deltaSent < 0 || deltaRecv < 0) continue;
      next[nodeId] = {
        sentPerSec: Math.round((deltaSent / seconds) * 10) / 10,
        recvPerSec: Math.round((deltaRecv / seconds) * 10) / 10,
      };
    }
    setNodeRates(next);
  }, [metrics]);

  const nodeOptions = useMemo(() => nodes.map((n) => ({ value: n.nodeId, label: n.nodeId })), [nodes]);
  const messageTypes = useMemo(() => [...new Set(messages.map((m) => m.type))].sort(), [messages]);
  const siblingCounts = useMemo(() => {
    const byToken = new Map<string, number>();
    const byUser = new Map<number, number>();
    for (const c of metrics?.connections ?? []) {
      byToken.set(c.tokenId, (byToken.get(c.tokenId) ?? 0) + 1);
      byUser.set(c.userId, (byUser.get(c.userId) ?? 0) + 1);
    }
    return { byToken, byUser };
  }, [metrics]);

  const filteredConnections = useMemo(() => {
    if (!metrics) return [];
    const normalized = keyword.trim().toLowerCase();
    return metrics.connections.filter((connection) => {
      const matchesKeyword = !normalized || [
        connection.connId,
        connection.tokenId,
        connection.nodeId ?? '',
        connection.username ?? '',
        connection.nickname ?? '',
        String(connection.userId),
      ].some((value) => value.toLowerCase().includes(normalized));
      return (
        matchesKeyword
        && (status === 'all' || toStatus(connection, now) === status)
        && (nodeFilter === 'all' || connection.nodeId === nodeFilter)
      );
    });
  }, [keyword, metrics, now, status, nodeFilter]);

  const filteredMessages = useMemo(() => {
    const normalized = messageKeyword.trim().toLowerCase();
    return messages.filter((message) => {
      const matchesKeyword = !normalized || [
        message.type,
        message.topic ?? '',
        message.connId ?? '',
        message.nodeId ?? '',
        message.userId === null ? '' : String(message.userId),
      ].some((value) => value.toLowerCase().includes(normalized));
      return (
        matchesKeyword
        && (messageDirection === 'all' || message.direction === messageDirection)
        && (messageType === 'all' || message.type === messageType)
        && (messageNode === 'all' || message.nodeId === messageNode)
        && (messageResult === 'all' || (messageResult === 'success' ? message.success : !message.success))
      );
    });
  }, [messageDirection, messageKeyword, messageNode, messageResult, messageType, messages]);

  const filteredDisconnects = useMemo(() => {
    if (!metrics) return [];
    return metrics.recentDisconnects.filter(
      (d) => (reasonFilter === 'all' || d.reason === reasonFilter)
        && (disconnectNode === 'all' || d.nodeId === disconnectNode),
    );
  }, [disconnectNode, metrics, reasonFilter]);

  /** 仍在线的那条连接（断开后为 null），详情面板据此在「实时数据」与「已断开」两种形态间切换 */
  const liveSelected = useMemo(
    () => (selectedConnId === null ? null : metrics?.connections.find((c) => c.connId === selectedConnId) ?? null),
    [metrics, selectedConnId],
  );
  useEffect(() => {
    if (liveSelected) setSelectedSnapshot(liveSelected);
  }, [liveSelected]);
  /** 展示用记录：优先取在线快照，连接消失后退回断开前那一次 */
  const selectedConnection = liveSelected ?? selectedSnapshot;
  const selectedDisconnect = useMemo(
    () => (liveSelected || selectedConnId === null
      ? null
      : metrics?.recentDisconnects.find((d) => d.connId === selectedConnId) ?? null),
    [liveSelected, metrics, selectedConnId],
  );
  const openConnection = (record: MonitorWsConnection) => {
    setSelectedConnId(record.connId);
    setSelectedSnapshot(record);
  };

  const selectedSiblings = useMemo(() => {
    if (!selectedConnection || !metrics) return { sameToken: [], sameUser: [] };
    return {
      sameToken: metrics.connections.filter((c) => c.tokenId === selectedConnection.tokenId && c.connId !== selectedConnection.connId),
      sameUser: metrics.connections.filter((c) => c.userId === selectedConnection.userId && c.tokenId !== selectedConnection.tokenId),
    };
  }, [metrics, selectedConnection]);
  const selectedMessages = useMemo(() => {
    if (!selectedConnection) return [];
    return messages.filter((m) => m.connId === selectedConnection.connId).slice(0, 5);
  }, [messages, selectedConnection]);

  const messageColumns: ColumnProps<MonitorWsMessage>[] = [
    dateTimeColumn('时间', 'at'),
    { title: '方向', dataIndex: 'direction', width: 90, render: (value: MonitorWsMessage['direction']) => <Tag color={value === 'inbound' ? 'blue' : 'green'} size="small">{value === 'inbound' ? '入站' : '出站'}</Tag> },
    // 弹性主列：消息类型是这一行的主标识，吸收容器多余宽度
    { title: '类型', dataIndex: 'type', minWidth: 190 },
    { title: 'Topic', dataIndex: 'topic', width: 130, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '节点', dataIndex: 'nodeId', width: 150, render: (value: string) => value ?? EMPTY_PLACEHOLDER },
    { title: '连接', dataIndex: 'connId', width: 100, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '用户', dataIndex: 'userId', width: 90, render: (value: number | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '大小', dataIndex: 'bytes', width: 90, render: (value: number) => `${formatNumber(value)} B` },
    { title: '结果', dataIndex: 'success', width: 80, render: (value: boolean) => <Tag color={value ? 'green' : 'red'} size="small">{value ? '成功' : '失败'}</Tag> },
  ];

  const nodeColumns: ColumnProps<MonitorWsNode>[] = [
    // 弹性主列：节点 ID 长度不定，容器更宽时由它吸收剩余空间
    { title: '服务节点', dataIndex: 'nodeId', minWidth: 240 },
    { title: '连接数', dataIndex: 'connections', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '在线用户', dataIndex: 'users', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '发送', dataIndex: 'sent', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '接收', dataIndex: 'recv', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
  ];

  const topicColumns: ColumnProps<WsTopicDirectionStat>[] = [
    // 弹性主列：Topic / 类型名长度差异最大
    { title: 'Topic / 类型', dataIndex: 'topic', minWidth: 240 },
    { title: '入站', dataIndex: 'inbound', width: 90, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '出站', dataIndex: 'outbound', width: 90, align: 'right' as const, render: (value: number) => formatNumber(value) },
    {
      title: '失败',
      dataIndex: 'failed',
      width: 90,
      align: 'right' as const,
      render: (value: number) => (value > 0
        ? <Text type="danger" strong>{formatNumber(value)}</Text>
        : formatNumber(value)),
    },
    { title: '采样消息数', dataIndex: 'messages', width: 110, align: 'right' as const, render: (_: unknown, r: WsTopicDirectionStat) => formatNumber(r.inbound + r.outbound) },
    { title: '采样字节数', dataIndex: 'bytes', width: 130, align: 'right' as const, render: (value: number) => `${formatNumber(value)} B` },
  ];

  const connectionColumns: ColumnProps<MonitorWsConnection>[] = [
    {
      title: '连接',
      dataIndex: 'connId',
      // 弹性主列：连接 ID 与 Token 都是定长技术标识，不换行，容器更宽时吸收剩余空间
      minWidth: 220,
      render: (value: string, record: MonitorWsConnection) => (
        <span className="ws-monitor-connection-cell">
          <Text strong>{value}</Text>
          <Text type="tertiary" size="small">Token {record.tokenId.slice(0, 10)}…</Text>
        </span>
      ),
    },
    { title: '节点', dataIndex: 'nodeId', width: 180, render: (value: string | undefined) => value ?? EMPTY_PLACEHOLDER },
    {
      title: '用户',
      dataIndex: 'userId',
      width: 150,
      render: (_value: number, record: MonitorWsConnection) => (
        <span>{record.nickname || record.username || EMPTY_PLACEHOLDER} <Text type="tertiary" size="small">#{record.userId}</Text></span>
      ),
    },
    {
      title: '多端',
      dataIndex: 'presence',
      key: 'presence',
      width: 130,
      render: (_: unknown, record: MonitorWsConnection) => {
        const tokenCount = siblingCounts.byToken.get(record.tokenId) ?? 0;
        const userCount = siblingCounts.byUser.get(record.userId) ?? 0;
        if (tokenCount <= 1 && userCount <= 1) return <Text type="tertiary" size="small">单端</Text>;
        return (
          <span className="ws-monitor-badges">
            {tokenCount > 1 && <Tag color="blue" size="small">{tokenCount} 标签页</Tag>}
            {userCount > 1 && <Tag color="violet" size="small">{userCount} 连接</Tag>}
          </span>
        );
      },
    },
    { title: '状态', dataIndex: 'connectionStatus', key: 'connectionStatus', width: 80, render: (_: unknown, record: MonitorWsConnection) => <StatusTag status={toStatus(record, now)} /> },
    dateTimeColumn('建立时间', 'connectedAt'),
    dateTimeColumn('最近活动', 'lastActivityAt'),
    {
      title: '持续时间',
      dataIndex: 'connectionDuration',
      key: 'connectionDuration',
      width: 110,
      align: 'right' as const,
      sorter: (a?: MonitorWsConnection, b?: MonitorWsConnection) => (a?.connectedAt ?? 0) - (b?.connectedAt ?? 0),
      render: (_: unknown, record: MonitorWsConnection) => formatSecondsHuman((now - record.connectedAt) / 1000),
    },
    {
      title: '发送',
      dataIndex: 'sent',
      width: 90,
      align: 'right' as const,
      sorter: (a?: MonitorWsConnection, b?: MonitorWsConnection) => (a?.sent ?? 0) - (b?.sent ?? 0),
      render: (value: number) => formatNumber(value),
    },
    {
      title: '接收',
      dataIndex: 'recv',
      width: 90,
      align: 'right' as const,
      sorter: (a?: MonitorWsConnection, b?: MonitorWsConnection) => (a?.recv ?? 0) - (b?.recv ?? 0),
      render: (value: number) => formatNumber(value),
    },
  ];

  const disconnectColumns: ColumnProps<MonitorWsDisconnect>[] = [
    // 弹性主列：连接 ID 在断开记录里同样是最长且最重要的技术标识
    { title: '连接', dataIndex: 'connId', minWidth: 140 },
    { title: '节点', dataIndex: 'nodeId', width: 180, render: (value: string | undefined) => value ?? EMPTY_PLACEHOLDER },
    {
      title: '用户',
      dataIndex: 'userId',
      width: 150,
      render: (_value: number, record: MonitorWsDisconnect) => (
        <span>{record.nickname || record.username || EMPTY_PLACEHOLDER} <Text type="tertiary" size="small">#{record.userId}</Text></span>
      ),
    },
    dateTimeColumn('断开时间', 'at'),
    { title: '原因', dataIndex: 'reason', width: 140, render: (value: string) => <Tag size="small">{value || EMPTY_PLACEHOLDER}</Tag> },
    { title: '持续时间', dataIndex: 'duration', width: 110, render: (value: number) => formatSecondsHuman(value / 1000) },
    { title: '发送', dataIndex: 'sent', width: 90, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '接收', dataIndex: 'recv', width: 90, align: 'right' as const, render: (value: number) => formatNumber(value) },
  ];

  const hasConnectionFilter = keyword !== '' || status !== 'all' || nodeFilter !== 'all';
  const hasMessageFilter = messageKeyword !== '' || messageType !== 'all' || messageNode !== 'all' || messageResult !== 'all' || messageDirection !== 'all';
  const hasDisconnectFilter = reasonFilter !== 'all' || disconnectNode !== 'all';
  const maxReasonCount = reasonStats[0]?.count ?? 0;

  return (
    <div className="ws-monitor-page">
      <div className="ws-monitor-header">
        <div className="ws-monitor-heading">
          <Title heading={5}><RadioTower size={18} />WebSocket 连接</Title>
          <Text type="tertiary">实时查看连接状态、活动情况、消息计数和断开记录{live ? ' · 每 5 秒刷新' : ' · 已暂停'}</Text>
        </div>
        <div className="ws-monitor-header__actions">
          <Button size="small" onClick={() => setLive((value) => !value)}>{live ? '暂停刷新' : '继续刷新'}</Button>
          <Button icon={<RefreshCw size={14} />} size="small" loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
        </div>
      </div>

      {metrics ? (
        <>
          <div className="ws-monitor-metrics">
            <div><Text type="tertiary" size="small">当前连接</Text><strong>{formatNumber(metrics.currentConnections)}</strong><Text type="tertiary" size="small">条</Text></div>
            <div><Text type="tertiary" size="small">在线用户</Text><strong>{formatNumber(metrics.currentUsers)}</strong><Text type="tertiary" size="small">人</Text></div>
            <div><Text type="tertiary" size="small">累计连接</Text><strong>{formatNumber(metrics.totalConnects)}</strong><Text type="tertiary" size="small">次</Text></div>
            <div><Text type="tertiary" size="small">累计发送</Text><strong>{formatNumber(metrics.totalSent)}</strong><Text type="tertiary" size="small">条消息{rates ? ` · ${formatRate(rates.sentPerSec)} 条/秒` : ''}</Text></div>
            <div><Text type="tertiary" size="small">累计接收</Text><strong>{formatNumber(metrics.totalRecv)}</strong><Text type="tertiary" size="small">条消息{rates ? ` · ${formatRate(rates.recvPerSec)} 条/秒` : ''}</Text></div>
            <div><Text type="tertiary" size="small">累计断开</Text><strong>{formatNumber(metrics.totalDisconnects)}</strong><Text type="tertiary" size="small">次</Text></div>
          </div>

          {health && (
            <div className="ws-monitor-health">
              <span>消息成功率 <strong>{health.successRate === null ? EMPTY_PLACEHOLDER : `${health.successRate}%`}</strong></span>
              <span>空闲连接 <strong>{formatNumber(health.idleCount)}</strong>{health.idleRatio === null ? '' : `（${health.idleRatio}%）`}</span>
              <span>人均连接 <strong>{health.avgConnsPerUser ?? EMPTY_PLACEHOLDER}</strong></span>
              <span>平均在线时长 <strong>{health.avgDurationSec === null ? EMPTY_PLACEHOLDER : formatSecondsHuman(health.avgDurationSec)}</strong></span>
            </div>
          )}

          <div className="ws-monitor-view-tabs" role="tablist" aria-label="WebSocket 监控视图">
            <button type="button" className={activeView === 'connections' ? 'is-active' : ''} onClick={() => setActiveView('connections')}>连接总览</button>
            <button type="button" className={activeView === 'messages' ? 'is-active' : ''} onClick={() => setActiveView('messages')}>消息流（{messages.length}）</button>
            <button type="button" className={activeView === 'topology' ? 'is-active' : ''} onClick={() => setActiveView('topology')}>节点与 Topic</button>
            <button type="button" className={activeView === 'graph' ? 'is-active' : ''} onClick={() => setActiveView('graph')}>关系拓扑</button>
          </div>
          {activeView === 'connections' && (
            <div className="ws-monitor-view-pane">
              <section className="ws-monitor-section">
            <div className="ws-monitor-section__header">
              <div><Title heading={6}><Activity size={15} />在线连接 <Text type="tertiary">{filteredConnections.length} / {metrics.connections.length}</Text></Title></div>
              <div className="ws-monitor-filters">
                <Input prefix={<Search size={14} />} value={keyword} onChange={setKeyword} placeholder="连接 ID / 用户 / Token / 节点" showClear />
                <Select
                  value={nodeFilter}
                  onChange={(value) => setNodeFilter(value as string)}
                  optionList={[{ value: 'all', label: '全部节点' }, ...nodeOptions]}
                  className="ws-monitor-filter-select"
                />
                <Button theme={status === 'all' ? 'solid' : 'light'} size="small" onClick={() => setStatus('all')}>全部</Button>
                <Button theme={status === 'active' ? 'solid' : 'light'} size="small" onClick={() => setStatus('active')}>活跃</Button>
                <Button theme={status === 'idle' ? 'solid' : 'light'} size="small" onClick={() => setStatus('idle')}>空闲</Button>
                {hasConnectionFilter && <Button icon={<X size={14} />} theme="borderless" size="small" onClick={() => { setKeyword(''); setStatus('all'); setNodeFilter('all'); }}>清除</Button>}
              </div>
            </div>
            <ConfigurableTable<MonitorWsConnection>
              columnSettingsKey="ws-monitor-connections"
              columns={connectionColumns}
              dataSource={filteredConnections}
              rowKey="connId"
              size="small"
              loading={query.isFetching && !metrics}
              // 只有这张表支持点行开详情，手型光标只随它走，不用页面级 .semi-table-row 规则
              onRow={(record) => ({ onClick: () => { if (record) openConnection(record); }, style: { cursor: 'pointer' } })}
              // 每页条数与选项由 ConfigurableTable 按偏好补齐
              pagination={filteredConnections.length > 20 ? connectionsPagination.buildPagination(filteredConnections.length) : false}
              empty="暂无符合条件的在线连接"
              onRefresh={() => void query.refetch()}
              refreshLoading={query.isFetching}
            />
          </section>

          <section className="ws-monitor-section">
            <div className="ws-monitor-section__header">
              <div><Title heading={6}>最近断开 <Text type="tertiary">最多保留 50 条 · 已筛 {filteredDisconnects.length} 条</Text></Title></div>
              <div className="ws-monitor-filters">
                <Select
                  value={reasonFilter}
                  onChange={(value) => setReasonFilter(value as string)}
                  optionList={[{ value: 'all', label: '全部原因' }, ...reasonStats.map((r) => ({ value: r.reason, label: `${r.reason}（${r.count}）` }))]}
                  className="ws-monitor-filter-select"
                />
                <Select
                  value={disconnectNode}
                  onChange={(value) => setDisconnectNode(value as string)}
                  optionList={[{ value: 'all', label: '全部节点' }, ...nodeOptions]}
                  className="ws-monitor-filter-select"
                />
                {hasDisconnectFilter && <Button icon={<X size={14} />} theme="borderless" size="small" onClick={() => { setReasonFilter('all'); setDisconnectNode('all'); }}>清除</Button>}
              </div>
            </div>
            {reasonStats.length > 0 && (
              <div className="ws-monitor-reasons" aria-label="断开原因分布">
                {reasonStats.slice(0, 5).map((r) => (
                  <button
                    key={r.reason}
                    type="button"
                    className={reasonFilter === r.reason ? 'is-active' : ''}
                    onClick={() => setReasonFilter((prev) => (prev === r.reason ? 'all' : r.reason))}
                    title={`${r.reason}：${r.count} 次`}
                  >
                    <span>{r.reason}</span>
                    <i><b style={{ width: `${maxReasonCount > 0 ? Math.max(4, Math.round((r.count / maxReasonCount) * 100)) : 0}%` }} /></i>
                    <em>{formatNumber(r.count)}</em>
                  </button>
                ))}
              </div>
            )}
            <ConfigurableTable<MonitorWsDisconnect>
              columnSettingsKey="ws-monitor-disconnects"
              columns={disconnectColumns}
              dataSource={filteredDisconnects}
              rowKey={(record) => (record ? `${record.connId}-${record.at}` : '')}
              size="small"
              pagination={filteredDisconnects.length > 20 ? disconnectsPagination.buildPagination(filteredDisconnects.length) : false}
              empty="暂无断开记录"
              onRefresh={() => void query.refetch()}
              refreshLoading={query.isFetching}
            />
          </section>
            </div>
          )}
          {activeView === 'messages' && (
            <div className="ws-monitor-view-pane">
              <section className="ws-monitor-section">
                <div className="ws-monitor-section__header">
                  <div>
                    <Title heading={6}>最近消息流 <Text type="tertiary">{filteredMessages.length} / {messages.length}</Text></Title>
                    <Text type="tertiary" size="small">保留最近 200 条元数据，不展示业务载荷</Text>
                  </div>
                  <div className="ws-monitor-filters">
                    <Input prefix={<Search size={14} />} value={messageKeyword} onChange={setMessageKeyword} placeholder="类型 / Topic / 连接 / 用户" showClear />
                    <Select
                      value={messageType}
                      onChange={(value) => setMessageType(value as string)}
                      optionList={[{ value: 'all', label: '全部类型' }, ...messageTypes.map((t) => ({ value: t, label: t }))]}
                      className="ws-monitor-filter-select ws-monitor-filter-select--wide"
                    />
                    <Select
                      value={messageNode}
                      onChange={(value) => setMessageNode(value as string)}
                      optionList={[{ value: 'all', label: '全部节点' }, ...nodeOptions]}
                      className="ws-monitor-filter-select"
                    />
                    <Select
                      value={messageResult}
                      onChange={(value) => setMessageResult(value as 'all' | 'success' | 'failed')}
                      optionList={[
                        { value: 'all', label: '全部结果' },
                        { value: 'success', label: '成功' },
                        { value: 'failed', label: '失败' },
                      ]}
                      className="ws-monitor-filter-select"
                    />
                    <Button theme={messageDirection === 'all' ? 'solid' : 'light'} size="small" onClick={() => setMessageDirection('all')}>全部</Button>
                    <Button theme={messageDirection === 'inbound' ? 'solid' : 'light'} size="small" onClick={() => setMessageDirection('inbound')}>入站</Button>
                    <Button theme={messageDirection === 'outbound' ? 'solid' : 'light'} size="small" onClick={() => setMessageDirection('outbound')}>出站</Button>
                    {hasMessageFilter && (
                      <Button
                        icon={<X size={14} />}
                        theme="borderless"
                        size="small"
                        onClick={() => { setMessageKeyword(''); setMessageType('all'); setMessageNode('all'); setMessageResult('all'); setMessageDirection('all'); }}
                      >
                        清除
                      </Button>
                    )}
                  </div>
                </div>
                <ConfigurableTable<MonitorWsMessage>
                  columnSettingsKey="ws-monitor-messages"
                  columns={messageColumns}
                  dataSource={filteredMessages}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  empty="暂无消息记录"
                  onRefresh={() => void query.refetch()}
                  refreshLoading={query.isFetching}
                />
              </section>
            </div>
          )}
          {activeView === 'topology' && (
            <div className="ws-monitor-view-pane">
              <section className="ws-monitor-section">
                <div className="ws-monitor-section__header">
                  <div>
                    <Title heading={6}>服务节点 <Text type="tertiary">{nodes.length} 个</Text></Title>
                    <Text type="tertiary" size="small">集群合并视图：各 api 节点快照按 30 秒节拍汇总，失联节点超过 90 秒自动移出</Text>
                  </div>
                </div>
                <ConfigurableTable<MonitorWsNode>
                  columnSettingsKey="ws-monitor-nodes"
                  columns={nodeColumns}
                  dataSource={nodes}
                  rowKey="nodeId"
                  size="small"
                  pagination={false}
                  empty="暂无节点数据"
                  onRefresh={() => void query.refetch()}
                  refreshLoading={query.isFetching}
                />
              </section>
              <section className="ws-monitor-section">
                <div className="ws-monitor-section__header">
                  <div>
                    <Title heading={6}>消息 Topic / 类型聚合</Title>
                    <Text type="tertiary" size="small">由最近 200 条业务消息采样现算，已排除 ping / pong 心跳，含入站 / 出站拆分与失败计数</Text>
                  </div>
                </div>
                <ConfigurableTable<WsTopicDirectionStat>
                  columnSettingsKey="ws-monitor-topics"
                  columns={topicColumns}
                  dataSource={topicStats}
                  rowKey="topic"
                  size="small"
                  pagination={false}
                  empty="暂无 Topic 数据"
                  onRefresh={() => void query.refetch()}
                  refreshLoading={query.isFetching}
                />
              </section>
            </div>
          )}
          {activeView === 'graph' && (
            <WsTopologyView
              metrics={metrics}
              nodeRates={nodeRates}
              reconnects={reconnects}
              clientStats={clientStats}
              onSelectUser={(userId) => {
                const target = metrics.connections.find((c) => c.userId === userId);
                if (target) openConnection(target);
              }}
              onInspectTopic={(topic) => {
                setMessageKeyword(topic);
                setMessageType('all');
                setMessageNode('all');
                setMessageResult('all');
                setMessageDirection('all');
              }}
              onSelectNode={(nodeId) => {
                setKeyword('');
                setStatus('all');
                setNodeFilter(nodeId);
              }}
            />
          )}
        </>
      ) : query.isError ? (
        <div className="ws-monitor-empty">
          <Empty
            title="WebSocket 监控数据加载失败"
            description={query.error instanceof Error ? query.error.message : '请稍后重试'}
          >
            <Button icon={<RefreshCw size={14} />} loading={query.isFetching} onClick={() => void query.refetch()}>重试</Button>
          </Empty>
        </div>
      ) : query.isFetching ? (
        <div className="ws-monitor-empty"><Spin size="large" /></div>
      ) : (
        <div className="ws-monitor-empty"><Empty title="暂无 WebSocket 监控数据" /></div>
      )}

      <SideSheet title="连接详情" visible={selectedConnId !== null} onCancel={() => setSelectedConnId(null)} placement="right" width={440}>
        {selectedConnection && (
          <div className="ws-monitor-detail">
            <div className="ws-monitor-detail__status">
              {liveSelected
                ? <StatusTag status={toStatus(selectedConnection, now)} />
                : <Tag color="red" size="small">已断开</Tag>}
              <Text type="tertiary">
                {liveSelected ? `实时数据 · ${live ? '每 5 秒刷新' : '已暂停'}` : '以下为断开前最后一次采集到的数据'}
              </Text>
            </div>
            {!liveSelected && (
              <Banner
                type="warning"
                className="ws-monitor-detail__closed"
                description={(
                  <>
                    该连接已于
                    {' '}<DateTimeText value={selectedDisconnect?.at ?? selectedConnection.lastActivityAt} mode="absolute" />{' '}
                    断开{selectedDisconnect?.reason ? `（${selectedDisconnect.reason}）` : ''}
                  </>
                )}
              />
            )}
            <dl>
              <dt>连接 ID</dt>
              <dd className="ws-monitor-detail__copy">
                <span>{selectedConnection.connId}</span>
                <Button icon={<Copy size={12} />} theme="borderless" size="small" aria-label="复制连接 ID" onClick={() => { void copyTextWithToast(selectedConnection.connId); }} />
              </dd>
              <dt>用户</dt><dd>{selectedConnection.nickname || selectedConnection.username || EMPTY_PLACEHOLDER}（#{selectedConnection.userId}）</dd>
              <dt>Token</dt>
              <dd className="ws-monitor-detail__copy">
                <span className="ws-monitor-detail__mono">{selectedConnection.tokenId}</span>
                <Button icon={<Copy size={12} />} theme="borderless" size="small" aria-label="复制 Token" onClick={() => { void copyTextWithToast(selectedConnection.tokenId); }} />
              </dd>
              <dt>节点</dt><dd>{selectedConnection.nodeId ?? EMPTY_PLACEHOLDER}</dd>
              <dt>IP</dt>
              <dd className="ws-monitor-detail__copy">
                <span className="ws-monitor-detail__mono">{selectedConnection.ip ?? EMPTY_PLACEHOLDER}</span>
                {selectedConnection.ip && (
                  <Button icon={<Copy size={12} />} theme="borderless" size="small" aria-label="复制 IP" onClick={() => { void copyTextWithToast(selectedConnection.ip ?? ''); }} />
                )}
              </dd>
              <dt>客户端</dt>
              <dd>
                {(() => {
                  const client = describeWsClient(selectedConnection.userAgent);
                  return client.browser === 'Unknown' && client.os === 'Unknown'
                    ? EMPTY_PLACEHOLDER
                    : `${client.browser} · ${client.os}`;
                })()}
              </dd>
              <dt>最近消息</dt>
              <dd>
                {selectedConnection.lastMessageType ? (
                  <span>
                    <Tag color={selectedConnection.lastDirection === 'inbound' ? 'blue' : 'green'} size="small">
                      {selectedConnection.lastDirection === 'inbound' ? '入站' : '出站'}
                    </Tag>{' '}
                    <span className="ws-monitor-detail__mono">{selectedConnection.lastMessageType}</span>{' '}
                    {selectedConnection.lastMessageAt !== null && (
                      <Text type="tertiary" size="small"><DateTimeText value={selectedConnection.lastMessageAt} /></Text>
                    )}
                  </span>
                ) : (
                  <Text type="tertiary" size="small">暂无收发</Text>
                )}
              </dd>
              <dt>建立时间</dt><dd><DateTimeText value={selectedConnection.connectedAt} /></dd>
              <dt>最近活动</dt><dd><DateTimeText value={selectedConnection.lastActivityAt} /></dd>
              <dt>持续时间</dt><dd>{formatSecondsHuman((now - selectedConnection.connectedAt) / 1000)}</dd>
              <dt>发送消息</dt><dd>{formatNumber(selectedConnection.sent)}</dd>
              <dt>接收消息</dt><dd>{formatNumber(selectedConnection.recv)}</dd>
            </dl>
            {(selectedSiblings.sameToken.length > 0 || selectedSiblings.sameUser.length > 0) && (
              <div className="ws-monitor-detail__siblings">
                <Text strong size="small">关联连接</Text>
                {selectedSiblings.sameToken.length > 0 && (
                  <div>
                    <Text type="tertiary" size="small">同登录会话（{selectedSiblings.sameToken.length} 个标签页）</Text>
                    <div className="ws-monitor-detail__sibling-list">
                      {selectedSiblings.sameToken.map((c) => (
                        <Button key={c.connId} size="small" theme="light" onClick={() => openConnection(c)}>{c.connId}</Button>
                      ))}
                    </div>
                  </div>
                )}
                {selectedSiblings.sameUser.length > 0 && (
                  <div>
                    <Text type="tertiary" size="small">同用户其他会话（{selectedSiblings.sameUser.length} 条）</Text>
                    <div className="ws-monitor-detail__sibling-list">
                      {selectedSiblings.sameUser.map((c) => (
                        <Button key={c.connId} size="small" theme="light" onClick={() => openConnection(c)}>{c.connId}</Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="ws-monitor-detail__messages">
              <Text strong size="small">该连接最近消息（{selectedMessages.length}）</Text>
              {selectedMessages.length > 0 ? (
                <ul>
                  {selectedMessages.map((m) => (
                    <li key={m.id}>
                      <Tag color={m.direction === 'inbound' ? 'blue' : 'green'} size="small">{m.direction === 'inbound' ? '入站' : '出站'}</Tag>
                      <span className="ws-monitor-detail__mono">{m.type}</span>
                      <Text type="tertiary" size="small"><DateTimeText value={m.at} /></Text>
                      {!m.success && <Tag color="red" size="small">失败</Tag>}
                    </li>
                  ))}
                </ul>
              ) : (
                <Text type="tertiary" size="small">采样中暂无该连接的消息</Text>
              )}
            </div>
            <Text type="tertiary" size="small">消息内容默认不采集，仅展示脱敏后的元数据；消息流和 Topic 聚合可在对应页签查看。</Text>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
