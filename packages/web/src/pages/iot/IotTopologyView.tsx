import { memo, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Background, Controls, MarkerType, Handle, Position, ReactFlowProvider,
  useNodesState, useEdgesState, useReactFlow, useUpdateNodeInternals,
  type Node as RFNode, type Edge as RFEdge, type NodeProps,
} from '@xyflow/react';
import { Badge, Empty, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { IotTopologyChild } from '@zenith/shared/iot';
import { ThemedReactFlow } from '@/components/ThemedReactFlow';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';
import { layoutWithDagre } from '@/utils/graph-layout';
import { useIotDeviceTopology, iotTopologyKeys } from '@/hooks/queries/iot-devices';
import { useWebSocket } from '@/hooks/useWebSocket';

const { Text } = Typography;

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;
/** 子设备超过该数量时拓扑图退化为表格（图形化只适合小规模直观呈现） */
const GRAPH_MAX_CHILDREN = 50;

interface TopoNodeData extends Record<string, unknown> {
  label: string;
  sn: string;
  online: boolean;
  isGateway: boolean;
  firingAlarmCount: number;
  disabled: boolean;
}

const TopoNode = memo(({ data }: NodeProps) => {
  const d = data as TopoNodeData;
  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: d.isGateway ? 'var(--semi-color-primary-light-default)' : 'var(--semi-color-bg-2)',
        border: `1px solid ${d.isGateway ? 'var(--semi-color-primary)' : 'var(--semi-color-border)'}`,
        borderRadius: 'var(--semi-border-radius-medium)',
        opacity: d.disabled ? 0.5 : 1,
        padding: '0 10px',
      }}
    >
      {!d.isGateway && <Handle type="target" position={Position.Top} style={{ background: 'var(--semi-color-primary)', width: 6, height: 6 }} />}
      {d.isGateway && <Handle type="source" position={Position.Bottom} style={{ background: 'var(--semi-color-primary)', width: 6, height: 6 }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: d.online ? 'var(--semi-color-success)' : 'var(--semi-color-text-3)',
        }} />
        <span style={{
          fontSize: 13, fontWeight: 600, color: 'var(--semi-color-text-0)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {d.label}
        </span>
        {d.firingAlarmCount > 0 && (
          <Badge count={d.firingAlarmCount} type="danger" style={{ flexShrink: 0 }} />
        )}
      </div>
      <div style={{
        fontSize: 10, color: 'var(--semi-color-text-2)', marginTop: 2,
        fontFamily: 'var(--semi-font-family-mono, monospace)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {d.sn}{d.disabled ? '（已禁用）' : ''}
      </div>
    </div>
  );
});
TopoNode.displayName = 'TopoNode';

const nodeTypes = { topo: TopoNode };

function layoutTopology(nodes: RFNode[], edges: RFEdge[]): RFNode[] {
  return layoutWithDagre(nodes, edges, { rankdir: 'TB', nodesep: 24, ranksep: 70, nodeSize: { width: NODE_WIDTH, height: NODE_HEIGHT } });
}

interface IotTopologyViewProps {
  deviceId: number;
  onOpenChild?: (childDeviceId: number) => void;
}

function IotTopologyGraph({ deviceId, onOpenChild }: Readonly<IotTopologyViewProps>) {
  const topologyQuery = useIotDeviceTopology(deviceId);
  const topology = topologyQuery.data;
  const qc = useQueryClient();

  // 实时：上下线事件到达即失效拓扑（在线点/边样式跟随刷新）
  useWebSocket((msg) => {
    if (msg.type !== 'iot:device-event' || msg.payload.kind !== 'lifecycle') return;
    if (msg.payload.identifier !== 'online' && msg.payload.identifier !== 'offline') return;
    const ids = [topology?.gateway.id, ...(topology?.children.map((c) => c.id) ?? [])];
    if (ids.includes(msg.payload.deviceId)) {
      void qc.invalidateQueries({ queryKey: iotTopologyKeys.of(deviceId) });
    }
  });

  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 320);
    return () => clearTimeout(t);
  }, []);

  const { baseNodes, baseEdges } = useMemo(() => {
    if (!topology) return { baseNodes: [] as RFNode[], baseEdges: [] as RFEdge[] };
    const gatewayNode: RFNode = {
      id: `g-${topology.gateway.id}`,
      type: 'topo',
      position: { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      sourcePosition: Position.Bottom,
      data: {
        label: topology.gateway.name,
        sn: topology.gateway.sn,
        online: topology.gateway.online,
        isGateway: true,
        firingAlarmCount: 0,
        disabled: false,
      } satisfies TopoNodeData,
    };
    const childNodes: RFNode[] = topology.children.map((c) => ({
      id: `c-${c.id}`,
      type: 'topo',
      position: { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      targetPosition: Position.Top,
      data: {
        label: c.name,
        sn: c.sn,
        online: c.online,
        isGateway: false,
        firingAlarmCount: c.firingAlarmCount,
        disabled: c.status === 'disabled',
      } satisfies TopoNodeData,
    }));
    const edges: RFEdge[] = topology.children.map((c) => ({
      id: `e-${c.id}`,
      source: `g-${topology.gateway.id}`,
      target: `c-${c.id}`,
      animated: c.online,
      style: {
        stroke: c.online ? 'var(--semi-color-success)' : 'var(--semi-color-text-3)',
        strokeWidth: 1.4,
        ...(c.online ? {} : { strokeDasharray: '6 4' }),
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: c.online ? 'var(--semi-color-success)' : 'var(--semi-color-text-3)' },
    }));
    return { baseNodes: [gatewayNode, ...childNodes], baseEdges: edges };
  }, [topology]);

  const laidOutNodes = useMemo(() => layoutTopology(baseNodes, baseEdges), [baseNodes, baseEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(laidOutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(baseEdges);
  const updateNodeInternals = useUpdateNodeInternals();
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(laidOutNodes);
    setEdges(baseEdges);
  }, [laidOutNodes, baseEdges, setNodes, setEdges]);

  // 挂载/数据变化后重新测量并自适应视野（容器从隐藏 Tab 转可见时 fitView 需重算）
  useEffect(() => {
    if (!ready || laidOutNodes.length === 0) return;
    const raf = requestAnimationFrame(() => {
      updateNodeInternals(laidOutNodes.map((n) => n.id));
      void fitView({ padding: 0.2, duration: 200 });
    });
    return () => cancelAnimationFrame(raf);
  }, [ready, laidOutNodes, updateNodeInternals, fitView]);

  if (topologyQuery.isLoading) {
    return <div style={{ padding: '48px 0', textAlign: 'center' }}><Spin size="large" /></div>;
  }
  if (!topology) return null;
  if (topology.children.length === 0) {
    return <Empty description="该网关下还没有子设备；在设备管理中注册子设备并指定所属网关" style={{ padding: '48px 0' }} />;
  }
  if (topology.children.length > GRAPH_MAX_CHILDREN) {
    return <TopologyTable childrenRows={topology.children} onOpenChild={onOpenChild} onRefresh={() => void topologyQuery.refetch()} refreshLoading={topologyQuery.isFetching} />;
  }

  return (
    <div style={{
      width: '100%', height: 420, border: '1px solid var(--semi-color-border)',
      borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--surface-card)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--semi-color-border)',
        background: 'var(--semi-color-fill-0)', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Tag size="small" color="green">在线 {topology.children.filter((c) => c.online).length}</Tag>
        <Tag size="small">离线 {topology.children.filter((c) => !c.online).length}</Tag>
        <Text type="tertiary" size="small" style={{ marginLeft: 'auto' }}>实线 = 在线，虚线 = 离线；点击子设备打开详情</Text>
      </div>
      {ready ? (
        <ThemedReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => {
            if (node.id.startsWith('c-') && onOpenChild) onOpenChild(Number(node.id.slice(2)));
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ThemedReactFlow>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
      )}
    </div>
  );
}

/** 规模兜底：子设备过多时用表格呈现（同一数据源） */
function TopologyTable({ childrenRows, onOpenChild, onRefresh, refreshLoading }: Readonly<{
  childrenRows: IotTopologyChild[];
  onOpenChild?: (childDeviceId: number) => void;
  onRefresh: () => void;
  refreshLoading: boolean;
}>) {
  const columns: ColumnProps<IotTopologyChild>[] = [
    {
      title: '状态', dataIndex: 'online', width: 80,
      render: (v: boolean) => <Tag size="small" color={v ? 'green' : 'grey'}>{v ? '在线' : '离线'}</Tag>,
    },
    { title: '设备名称', dataIndex: 'name', minWidth: 180 },
    {
      title: 'SN', dataIndex: 'sn', width: 200,
      render: (v: string) => <Text type="tertiary" size="small" style={{ whiteSpace: 'nowrap' }}>{v}</Text>,
    },
    {
      title: '活跃告警', dataIndex: 'firingAlarmCount', width: 90, align: 'right',
      render: (v: number) => v > 0 ? <Text type="danger">{v}</Text> : EMPTY_PLACEHOLDER,
    },
    dateTimeColumn<IotTopologyChild>('最后在线', 'lastSeenAt'),
  ];
  return (
    <ConfigurableTable
      bordered
      columnSettingsKey="iot-topology-children"
      columns={columns}
      dataSource={childrenRows}
      rowKey="id"
      size="small"
      pagination={false}
      onRefresh={onRefresh}
      refreshLoading={refreshLoading}
      onRow={(record) => ({
        onClick: () => record && onOpenChild?.(record.id),
        style: { cursor: onOpenChild ? 'pointer' : undefined },
      })}
    />
  );
}

/** 网关拓扑视图（React Flow + dagre 自动布局，上下线实时刷新） */
export default function IotTopologyView(props: Readonly<IotTopologyViewProps>) {
  return (
    <ReactFlowProvider>
      <IotTopologyGraph {...props} />
    </ReactFlowProvider>
  );
}
