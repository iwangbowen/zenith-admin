import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlowProvider,
  useNodesInitialized, useReactFlow, useUpdateNodeInternals,
  type Edge as RFEdge, type Node as RFNode, type NodeProps,
} from '@xyflow/react';
import { Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { ThemedReactFlow } from '@/components/ThemedReactFlow';
import { useGraphSelectionHighlight } from '@/hooks/useGraphSelectionHighlight';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';
import { formatSecondsHuman } from '@/utils/format';
import {
  buildWsTopology,
  type MonitorWsMetrics,
  type WsClientKind,
  type WsClientStats,
  type WsReconnectLink,
  type WsTopoEdgeKind,
  type WsTopoNode,
} from '@zenith/shared/platform';
import './WebSocketMonitorPage.css';

const { Title, Text } = Typography;

const TOPO_NODE_WIDTH = 230;
const TOPO_NODE_HEIGHT = 88;
/** 图节点过多时退化为纯表格（图形化只适合中小规模直观呈现） */
const TOPO_GRAPH_MAX_NODES = 120;

const KIND_LABEL: Record<WsClientKind, string> = {
  web: '网页',
  desktop: '桌面端',
  mobile: '移动端',
  unknown: '未知',
};

const EDGE_STYLE: Record<WsTopoEdgeKind, { stroke: string; dashed: boolean }> = {
  fanout: { stroke: 'var(--semi-color-text-3)', dashed: true },
  attach: { stroke: 'var(--semi-color-success)', dashed: false },
  deliver: { stroke: 'var(--semi-color-primary)', dashed: false },
};

interface WsTopoNodeData extends Record<string, unknown> {
  topo: WsTopoNode;
  rate: string | null;
  dimmed: boolean;
}

const WsTopoNodeView = memo(({ data }: NodeProps) => {
  const d = data as WsTopoNodeData;
  const t = d.topo;
  const accent = t.kind === 'bus'
    ? 'var(--semi-color-warning)'
    : t.kind === 'gateway'
      ? 'var(--semi-color-primary)'
      : t.kind === 'topic'
        ? 'var(--semi-color-info)'
        : 'var(--semi-color-success)';
  return (
    <div
      className="ws-topo-node"
      style={{ width: TOPO_NODE_WIDTH, height: TOPO_NODE_HEIGHT, opacity: d.dimmed ? 0.35 : 1 }}
    >
      {(t.kind === 'gateway' || t.kind === 'user') && (
        <Handle type="target" position={Position.Top} style={{ background: accent, width: 6, height: 6 }} />
      )}
      {(t.kind === 'bus' || t.kind === 'gateway' || t.kind === 'topic') && (
        <Handle type="source" position={Position.Bottom} style={{ background: accent, width: 6, height: 6 }} />
      )}
      <div className="ws-topo-node__title">
        <i style={{ background: accent }} />
        <span>{t.label}</span>
      </div>
      <div className="ws-topo-node__sub">{t.sub}</div>
      <div className="ws-topo-node__meta">
        {t.kind === 'user' && t.kinds.map((k) => <Tag key={k} size="small" color={k === 'unknown' ? 'grey' : 'blue'}>{KIND_LABEL[k]}</Tag>)}
        {t.kind === 'user' && t.connections > 1 && <Tag size="small" color="violet">{t.connections} 连接</Tag>}
        {t.kind === 'user' && t.reconnected && <Tag size="small" color="orange">疑似重连</Tag>}
        {t.kind === 'gateway' && <Tag size="small" color="grey">{t.connections} 连接 · {t.users} 用户</Tag>}
        {t.kind === 'gateway' && d.rate && <Tag size="small" color="grey">{d.rate}</Tag>}
        {t.kind === 'topic' && <Tag size="small" color="grey">{t.users} 个用户</Tag>}
      </div>
    </div>
  );
});
WsTopoNodeView.displayName = 'WsTopoNodeView';

const topoNodeTypes = { wsTopo: WsTopoNodeView };

export interface WsNodeRate {
  sentPerSec: number;
  recvPerSec: number;
}

interface WsTopologyViewProps {
  metrics: MonitorWsMetrics;
  /** 各网关节点的实时速率（页面由轮询差值换算） */
  nodeRates: Record<string, WsNodeRate>;
  reconnects: WsReconnectLink[];
  onSelectUser: (userId: number) => void;
  onInspectTopic: (topic: string) => void;
  onSelectNode: (nodeId: string) => void;
}

function WsTopologyGraph({ metrics, nodeRates, onSelectUser, onInspectTopic, onSelectNode }: Omit<WsTopologyViewProps, 'reconnects'>) {
  const topology = useMemo(() => buildWsTopology(metrics), [metrics]);
  const [ready, setReady] = useState(false);
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 320);
    return () => clearTimeout(timer);
  }, []);

  const draggedPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  const baseNodes = useMemo<RFNode[]>(() => topology.nodes.map((t) => ({
    id: t.id,
    type: 'wsTopo',
    position: draggedPositionsRef.current[t.id] ?? { x: 0, y: 0 },
    width: TOPO_NODE_WIDTH,
    height: TOPO_NODE_HEIGHT,
    data: {
      topo: t,
      rate: t.nodeId && nodeRates[t.nodeId]
        ? `${nodeRates[t.nodeId].sentPerSec}↑ ${nodeRates[t.nodeId].recvPerSec}↓ 条/秒`
        : null,
      dimmed: false,
    } satisfies WsTopoNodeData,
  })), [topology, nodeRates]);

  const baseEdges = useMemo<RFEdge[]>(() => topology.edges.map((e) => {
    const style = EDGE_STYLE[e.kind];
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      labelStyle: { fontSize: 10, fill: 'var(--semi-color-text-2)' },
      style: { stroke: style.stroke, strokeWidth: 1.4, ...(style.dashed ? { strokeDasharray: '6 4' } : {}) },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
    };
  }), [topology]);

  // 使用固定语义分层而不是 dagre：基础设施关系向下，Topic 投递关系放在用户右侧，避免节点重叠和悬空箭头。
  const laidOutNodes = useMemo(() => {
    const gateways = baseNodes.filter((node) => (node.data as WsTopoNodeData).topo.kind === 'gateway');
    const users = baseNodes.filter((node) => (node.data as WsTopoNodeData).topo.kind === 'user');
    const topics = baseNodes.filter((node) => (node.data as WsTopoNodeData).topo.kind === 'topic');
    const bus = baseNodes.find((node) => (node.data as WsTopoNodeData).topo.kind === 'bus');
    const columnGap = TOPO_NODE_WIDTH + 36;
    const centerX = Math.max(0, (users.length - 1) * columnGap / 2);
    const positionById = new Map<string, { x: number; y: number }>();
    if (bus) positionById.set(bus.id, { x: centerX, y: 24 });
    gateways.forEach((node, index) => positionById.set(node.id, { x: index * columnGap, y: 156 }));
    users.forEach((node, index) => positionById.set(node.id, { x: index * columnGap, y: 288 }));
    topics.forEach((node, index) => positionById.set(node.id, { x: Math.max(users.length, 1) * columnGap + index * columnGap, y: 288 }));
    return baseNodes.map((node) => ({
      ...node,
      position: draggedPositionsRef.current[node.id] ?? positionById.get(node.id) ?? { x: 0, y: 24 },
    }));
  }, [baseNodes]);
  const fitNodeTargets = useMemo(() => laidOutNodes.map(({ id }) => ({ id })), [laidOutNodes]);
  const topologyStructureKey = useMemo(
    () => `${topology.nodes.map(({ id }) => id).join('|')}::${topology.edges.map(({ id }) => id).join('|')}`,
    [topology],
  );

  useEffect(() => {
    if (!ready || !nodesInitialized || fitNodeTargets.length === 0) return;
    const raf = requestAnimationFrame(() => {
      updateNodeInternals(fitNodeTargets.map(({ id }) => id));
      void fitView({ nodes: fitNodeTargets, padding: 0.2, maxZoom: 1, duration: 200 });
    });
    return () => cancelAnimationFrame(raf);
  }, [fitView, nodesInitialized, ready, topologyStructureKey, updateNodeInternals]);

  const { nodes, edges, onNodesChange, onEdgesChange, handleNodeClick, handlePaneClick } = useGraphSelectionHighlight<WsTopoNodeData>(
    laidOutNodes,
    baseEdges,
    {
      edgeStyle: (state) => (state === 'unrelated' ? { opacity: 0.15 } : state === 'related' ? { opacity: 1, strokeWidth: 2.2 } : {}),
    },
  );

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) draggedPositionsRef.current[change.id] = change.position;
    }
    onNodesChange(changes);
  }, [onNodesChange]);

  if (topology.nodes.length > TOPO_GRAPH_MAX_NODES) {
    return (
      <Text type="tertiary">
        节点过多（{topology.nodes.length} 个，含 {topology.userCount} 用户），图形化已降级；请用连接总览表格查看明细。
      </Text>
    );
  }

  return (
    <div className="ws-topo-wrap">
      <div className="ws-topo-bar">
        <Tag size="small" color="green">用户 {topology.userCount}</Tag>
        <Tag size="small" color="blue">Topic {topology.topicCount}</Tag>
        <Tag size="small">网关 {metrics.nodes.length}</Tag>
        {topology.truncatedUsers > 0 && <Tag size="small" color="orange">另有 {topology.truncatedUsers} 用户未进图</Tag>}
        <Text type="tertiary" size="small" className="ws-topo-bar__hint">绿线 = 归属，蓝线 = 投递（采样），灰虚线 = 扇出；点选节点高亮相邻，点击用户 / Topic 可下钻</Text>
      </div>
      {ready ? (
        <ThemedReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={topoNodeTypes}
          onInit={(instance) => {
            // React Flow 首次测量自定义节点后再 fit，避免只按初始 0 尺寸计算而放大到 2x+。
            requestAnimationFrame(() => instance.fitView({ nodes: fitNodeTargets, padding: 0.2, maxZoom: 1 }));
          }}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => {
            handleNodeClick(_, node);
            if (node.id.startsWith('user:')) onSelectUser(Number(node.id.slice(5)));
            else if (node.id.startsWith('topic:')) onInspectTopic(node.id.slice(6));
            else if (node.id.startsWith('node:')) onSelectNode(node.id.slice(5));
          }}
          onPaneClick={handlePaneClick}
          fitView
          // 单层 / 小数据集 fitView 可能把缩放放大到节点占满画布；限制默认缩放，避免首次打开节点过大。
          fitViewOptions={{ nodes: fitNodeTargets, padding: 0.2, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ThemedReactFlow>
      ) : (
        <div className="ws-topo-loading"><Spin size="large" /></div>
      )}
    </div>
  );
}

const KIND_ROW_LABEL: Record<WsClientKind, string> = {
  web: '网页端',
  desktop: '桌面端',
  mobile: '移动端',
  unknown: '未知端',
};

export default function WsTopologyView({ reconnects, clientStats, ...graphProps }: WsTopologyViewProps & {
  clientStats: WsClientStats;
}) {
  return (
    <div className="ws-monitor-view-pane">
      <section className="ws-monitor-section">
        <div className="ws-monitor-section__header">
          <div>
            <Title heading={6}>关系拓扑</Title>
            <Text type="tertiary" size="small">
              扇出总线 → 网关节点 → 用户；Topic → 用户表示最近 200 条出站采样中的投递，不是订阅关系（/api/ws 无订阅原语）；
              重连为同 Token 启发式推断。
            </Text>
          </div>
        </div>
        <ReactFlowProvider>
          <WsTopologyGraph {...graphProps} />
        </ReactFlowProvider>
      </section>

      <section className="ws-monitor-section">
        <div className="ws-monitor-section__header"><Title heading={6}>客户端类型分布</Title></div>
        <div className="ws-topo-clients">
          <div className="ws-topo-clients__kinds">
            {(Object.keys(KIND_ROW_LABEL) as WsClientKind[]).map((kind) => {
              const stat = clientStats.byKind.find((s) => s.kind === kind);
              return (
                <div key={kind}>
                  <Text type="tertiary" size="small">{KIND_ROW_LABEL[kind]}</Text>
                  <strong>{stat ? stat.connections : 0}</strong>
                  <Text type="tertiary" size="small">连接 · {stat ? stat.users : 0} 用户</Text>
                </div>
              );
            })}
          </div>
          <div className="ws-topo-clients__tops">
            <div>
              <Text type="tertiary" size="small">浏览器 Top</Text>
              {clientStats.topBrowsers.length > 0 ? (
                <ul>{clientStats.topBrowsers.map((b) => <li key={b.name}><span>{b.name}</span><em>{b.connections}</em></li>)}</ul>
              ) : <Text type="tertiary" size="small">{EMPTY_PLACEHOLDER}</Text>}
            </div>
            <div>
              <Text type="tertiary" size="small">操作系统 Top</Text>
              {clientStats.topOSs.length > 0 ? (
                <ul>{clientStats.topOSs.map((b) => <li key={b.name}><span>{b.name}</span><em>{b.connections}</em></li>)}</ul>
              ) : <Text type="tertiary" size="small">{EMPTY_PLACEHOLDER}</Text>}
            </div>
          </div>
        </div>
      </section>

      <section className="ws-monitor-section">
        <div className="ws-monitor-section__header">
          <div>
            <Title heading={6}>疑似重连 <Text type="tertiary">{reconnects.length} 条</Text></Title>
            <Text type="tertiary" size="small">同一 Token 在断开前后 60 秒出现新连接即计入；跨节点即连接迁移。服务端不存连接血缘，此为推断。</Text>
          </div>
        </div>
        <Table
          size="small"
          bordered
          dataSource={reconnects}
          rowKey={(r) => (r ? `${r.newConnId}` : '')}
          pagination={false}
          empty={<Text type="tertiary">暂无命中的重连（单连接常驻时为空）</Text>}
          columns={[
            {
              title: '用户', dataIndex: 'userId', width: 150,
              render: (_: unknown, r: WsReconnectLink) => (
                <span>{r.nickname || r.username || EMPTY_PLACEHOLDER} <Text type="tertiary" size="small">#{r.userId}</Text></span>
              ),
            },
            { title: 'Token', dataIndex: 'tokenId', width: 130, render: (v: string) => <Text type="tertiary" size="small">{v.slice(0, 10)}…</Text> },
            { title: '旧连接', dataIndex: 'prevConnId', width: 100 },
            { title: '断开原因', dataIndex: 'prevReason', width: 130, render: (v: string) => <Tag size="small">{v || EMPTY_PLACEHOLDER}</Tag> },
            dateTimeColumn('断开时间', 'prevAt'),
            { title: '新连接', dataIndex: 'newConnId', width: 100 },
            { title: '落在节点', dataIndex: 'newNodeId', width: 180, render: (v: string) => v ?? EMPTY_PLACEHOLDER },
            {
              title: '迁移', dataIndex: 'crossNode', width: 90,
              render: (v: boolean) => (v ? <Tag color="orange" size="small">跨节点</Tag> : <Tag color="grey" size="small">同节点</Tag>),
            },
            {
              title: '间隔', dataIndex: 'gapMs', width: 110, align: 'right' as const,
              render: (v: number) => (v >= 0 ? formatSecondsHuman(v / 1000) : `并存 ${formatSecondsHuman(-v / 1000)}`),
            },
          ]}
        />
      </section>
    </div>
  );
}

export type { WsTopologyViewProps };
