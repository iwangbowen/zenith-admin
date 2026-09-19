import { useMemo, useState } from 'react';
import { Button, Input, SideSheet, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { Activity, RadioTower, RefreshCw, Search, X } from 'lucide-react';
import { useMonitorWsMetrics } from '@/hooks/queries/monitor';
import { TABLE_PAGE_SIZE_OPTIONS, usePagination } from '@/hooks/usePagination';
import DateTimeText from '@/components/DateTimeText';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';
import { formatSecondsHuman } from '@/utils/format';
import type { MonitorWsConnection, MonitorWsDisconnect, MonitorWsMessage } from '@zenith/shared/platform';
import './WebSocketMonitorPage.css';

const { Title, Text } = Typography;

type ConnectionStatus = 'active' | 'idle';
const numberFormatter = new Intl.NumberFormat('zh-CN');
const formatNumber = (value: number) => numberFormatter.format(value);

function connectionStatus(connection: MonitorWsConnection): ConnectionStatus {
  return Date.now() - connection.lastActivityAt > 120_000 ? 'idle' : 'active';
}

export default function WebSocketMonitorPage() {
  const [live, setLive] = useState(true);
  const query = useMonitorWsMetrics(live ? 5000 : false);
  const metrics = query.data ?? null;
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<ConnectionStatus | 'all'>('all');
  const [activeView, setActiveView] = useState('connections');
  const [messageDirection, setMessageDirection] = useState<'all' | MonitorWsMessage['direction']>('all');
  const [selectedConnection, setSelectedConnection] = useState<MonitorWsConnection | null>(null);
  const connectionsPagination = usePagination(20);
  const disconnectsPagination = usePagination(20);

  const messages = useMemo(() => metrics?.messages ?? [], [metrics]);
  const nodes = useMemo(() => metrics?.nodes ?? [], [metrics]);
  const topics = useMemo(() => metrics?.topics ?? [], [metrics]);

  const filteredMessages = useMemo(() => messages.filter((message) => messageDirection === 'all' || message.direction === messageDirection), [messageDirection, messages]);

  const filteredConnections = useMemo(() => {
    if (!metrics) return [];
    const normalized = keyword.trim().toLowerCase();
    return metrics.connections.filter((connection) => {
      const matchesKeyword = !normalized || [
        connection.connId,
        connection.tokenId,
        connection.username ?? '',
        connection.nickname ?? '',
        String(connection.userId),
      ].some((value) => value.toLowerCase().includes(normalized));
      return matchesKeyword && (status === 'all' || connectionStatus(connection) === status);
    });
  }, [keyword, metrics, status]);

  const messageColumns = [
    { title: '时间', dataIndex: 'at', width: 180, render: (value: number) => <DateTimeText value={value} /> },
    { title: '方向', dataIndex: 'direction', width: 90, render: (value: MonitorWsMessage['direction']) => <Tag color={value === 'inbound' ? 'blue' : 'green'} size="small">{value === 'inbound' ? '入站' : '出站'}</Tag> },
    { title: '类型', dataIndex: 'type', width: 190 },
    { title: 'Topic', dataIndex: 'topic', width: 130, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '连接', dataIndex: 'connId', width: 100, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '用户', dataIndex: 'userId', width: 90, render: (value: number | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '大小', dataIndex: 'bytes', width: 90, render: (value: number) => `${formatNumber(value)} B` },
    { title: '结果', dataIndex: 'success', width: 80, render: (value: boolean) => <Tag color={value ? 'green' : 'red'} size="small">{value ? '成功' : '失败'}</Tag> },
  ];

  const nodeColumns = [
    { title: '服务节点', dataIndex: 'nodeId', width: 240 },
    { title: '连接数', dataIndex: 'connections', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '在线用户', dataIndex: 'users', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '发送', dataIndex: 'sent', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '接收', dataIndex: 'recv', width: 100, align: 'right' as const, render: (value: number) => formatNumber(value) },
  ];

  const topicColumns = [
    { title: 'Topic / 类型', dataIndex: 'topic', width: 240 },
    { title: '采样消息数', dataIndex: 'messages', width: 130, align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '采样字节数', dataIndex: 'bytes', width: 130, align: 'right' as const, render: (value: number) => `${formatNumber(value)} B` },
  ];

  const connectionColumns = [
    {
      title: '连接',
      dataIndex: 'connId',
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
    { title: '状态', dataIndex: 'connectionStatus', key: 'connectionStatus', render: (_: unknown, record: MonitorWsConnection) => connectionStatus(record) === 'active' ? <Tag color="green" size="small">活跃</Tag> : <Tag color="orange" size="small">空闲</Tag> },
    dateTimeColumn('建立时间', 'connectedAt'),
    dateTimeColumn('最近活动', 'lastActivityAt'),
    { title: '持续时间', dataIndex: 'connectionDuration', key: 'connectionDuration', render: (_: unknown, record: MonitorWsConnection) => formatSecondsHuman((Date.now() - record.connectedAt) / 1000) },
    { title: '发送', dataIndex: 'sent', align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '接收', dataIndex: 'recv', align: 'right' as const, render: (value: number) => formatNumber(value) },
  ];

  const disconnectColumns = [
    { title: '连接', dataIndex: 'connId', width: 120 },
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
    { title: '原因', dataIndex: 'reason', render: (value: string) => <Tag size="small">{value || EMPTY_PLACEHOLDER}</Tag> },
    { title: '持续时间', dataIndex: 'duration', render: (value: number) => formatSecondsHuman(value / 1000) },
    { title: '发送', dataIndex: 'sent', align: 'right' as const, render: (value: number) => formatNumber(value) },
    { title: '接收', dataIndex: 'recv', align: 'right' as const, render: (value: number) => formatNumber(value) },
  ];

  return (
    <div className="ws-monitor-page">
      <div className="ws-monitor-header">
        <div className="ws-monitor-heading">
          <Title heading={5}><RadioTower size={18} />WebSocket 连接</Title>
          <Text type="tertiary">实时查看连接状态、活动情况、消息计数和断开记录</Text>
        </div>
        <Button icon={<RefreshCw size={14} />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
      </div>

      {metrics ? (
        <>
          <div className="ws-monitor-metrics">
            <div><Text type="tertiary" size="small">当前连接</Text><strong>{formatNumber(metrics.currentConnections)}</strong><Text type="tertiary" size="small">条</Text></div>
            <div><Text type="tertiary" size="small">在线用户</Text><strong>{formatNumber(metrics.currentUsers)}</strong><Text type="tertiary" size="small">人</Text></div>
            <div><Text type="tertiary" size="small">累计发送</Text><strong>{formatNumber(metrics.totalSent)}</strong><Text type="tertiary" size="small">条消息</Text></div>
            <div><Text type="tertiary" size="small">累计接收</Text><strong>{formatNumber(metrics.totalRecv)}</strong><Text type="tertiary" size="small">条消息</Text></div>
            <div><Text type="tertiary" size="small">累计断开</Text><strong>{formatNumber(metrics.totalDisconnects)}</strong><Text type="tertiary" size="small">次</Text></div>
          </div>

          <div className="ws-monitor-view-tabs" role="tablist" aria-label="WebSocket 监控视图">
            <button type="button" className={activeView === 'connections' ? 'is-active' : ''} onClick={() => setActiveView('connections')}>连接总览</button>
            <button type="button" className={activeView === 'messages' ? 'is-active' : ''} onClick={() => setActiveView('messages')}>消息流（{messages.length}）</button>
            <button type="button" className={activeView === 'topology' ? 'is-active' : ''} onClick={() => setActiveView('topology')}>节点与 Topic</button>
          </div>
          {activeView === 'connections' && (
            <div className="ws-monitor-view-pane">
              <section className="ws-monitor-section">
            <div className="ws-monitor-section__header">
              <div><Title heading={6}><Activity size={15} />在线连接 <Text type="tertiary">{filteredConnections.length} / {metrics.connections.length}</Text></Title></div>
              <div className="ws-monitor-filters">
                <Input prefix={<Search size={14} />} value={keyword} onChange={setKeyword} placeholder="连接 ID / 用户 / Token" showClear />
                <Button theme={status === 'all' ? 'solid' : 'light'} size="small" onClick={() => setStatus('all')}>全部</Button>
                <Button theme={status === 'active' ? 'solid' : 'light'} size="small" onClick={() => setStatus('active')}>活跃</Button>
                <Button theme={status === 'idle' ? 'solid' : 'light'} size="small" onClick={() => setStatus('idle')}>空闲</Button>
                {(keyword || status !== 'all') && <Button icon={<X size={14} />} theme="borderless" size="small" onClick={() => { setKeyword(''); setStatus('all'); }}>清除</Button>}
              </div>
            </div>
            <Table
              size="small"
              bordered
              loading={query.isFetching && !metrics}
              dataSource={filteredConnections}
              rowKey="connId"
              onRow={(record) => ({ onClick: () => { if (record) setSelectedConnection(record); } })}
              pagination={filteredConnections.length > 20 ? { ...connectionsPagination.buildPagination(filteredConnections.length), showSizeChanger: true, pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS } : false}
              empty={<Text type="tertiary">暂无符合条件的在线连接</Text>}
              columns={connectionColumns}
            />
          </section>

          <section className="ws-monitor-section">
            <div className="ws-monitor-section__header"><Title heading={6}>最近断开 <Text type="tertiary">最多保留 50 条</Text></Title></div>
            <Table
              size="small"
              bordered
              dataSource={metrics.recentDisconnects}
              rowKey={(record) => (record ? `${record.connId}-${record.at}` : '')}
              pagination={metrics.recentDisconnects.length > 20 ? { ...disconnectsPagination.buildPagination(metrics.recentDisconnects.length), showSizeChanger: true, pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS } : false}
              empty={<Text type="tertiary">暂无断开记录</Text>}
              columns={disconnectColumns}
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
                    <Button theme={messageDirection === 'all' ? 'solid' : 'light'} size="small" onClick={() => setMessageDirection('all')}>全部</Button>
                    <Button theme={messageDirection === 'inbound' ? 'solid' : 'light'} size="small" onClick={() => setMessageDirection('inbound')}>入站</Button>
                    <Button theme={messageDirection === 'outbound' ? 'solid' : 'light'} size="small" onClick={() => setMessageDirection('outbound')}>出站</Button>
                    <Button size="small" onClick={() => setLive((value) => !value)}>{live ? '暂停刷新' : '继续刷新'}</Button>
                  </div>
                </div>
                <Table size="small" bordered dataSource={filteredMessages} rowKey="id" pagination={false} empty={<Text type="tertiary">暂无消息记录</Text>} columns={messageColumns} />
              </section>
            </div>
          )}
          {activeView === 'topology' && (
            <div className="ws-monitor-view-pane">
              <section className="ws-monitor-section">
                <div className="ws-monitor-section__header"><Title heading={6}>服务节点</Title></div>
                <Table size="small" bordered dataSource={nodes} rowKey="nodeId" pagination={false} empty={<Text type="tertiary">暂无节点数据</Text>} columns={nodeColumns} />
              </section>
              <section className="ws-monitor-section">
                <div className="ws-monitor-section__header"><Title heading={6}>消息 Topic / 类型聚合</Title></div>
                <Table size="small" bordered dataSource={topics} rowKey="topic" pagination={false} empty={<Text type="tertiary">暂无 Topic 数据</Text>} columns={topicColumns} />
              </section>
            </div>
          )}
        </>
      ) : (
        <div className="ws-monitor-empty">{query.isFetching ? '正在加载 WebSocket 监控数据…' : 'WebSocket 监控数据不可用'}</div>
      )}

      <SideSheet title="连接详情" visible={Boolean(selectedConnection)} onCancel={() => setSelectedConnection(null)} placement="right" width={420}>
        {selectedConnection && (
          <div className="ws-monitor-detail">
            <div className="ws-monitor-detail__status"><Tag color={connectionStatus(selectedConnection) === 'active' ? 'green' : 'orange'}>{connectionStatus(selectedConnection) === 'active' ? '活跃' : '空闲'}</Tag><Text type="tertiary">实时数据每 5 秒刷新</Text></div>
            <dl>
              <dt>连接 ID</dt><dd>{selectedConnection.connId}</dd>
              <dt>用户</dt><dd>{selectedConnection.nickname || selectedConnection.username || EMPTY_PLACEHOLDER}（#{selectedConnection.userId}）</dd>
              <dt>Token</dt><dd>{selectedConnection.tokenId}</dd>
              <dt>建立时间</dt><dd><DateTimeText value={selectedConnection.connectedAt} /></dd>
              <dt>最近活动</dt><dd><DateTimeText value={selectedConnection.lastActivityAt} /></dd>
              <dt>发送消息</dt><dd>{formatNumber(selectedConnection.sent)}</dd>
              <dt>接收消息</dt><dd>{formatNumber(selectedConnection.recv)}</dd>
            </dl>
            <Text type="tertiary" size="small">消息内容默认不采集，仅展示脱敏后的元数据；消息流和 Topic 聚合可在对应页签查看。</Text>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
