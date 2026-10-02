import { memo, useMemo } from 'react';
import { Empty, Tag, Typography } from '@douyinfe/semi-ui';
import { Background, Controls, Handle, MarkerType, Position, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { WORKFLOW_NODE_TYPE_LABELS, type WorkflowFlowData } from '@zenith/shared/workflow';
import { ThemedReactFlow } from '@/components/ThemedReactFlow';
import { layoutWithDagre } from '@/utils/graph-layout';
import type { NodeRuntimeInfo } from '@/pages/workflow/designer/types';
import { INSTANCE_STATUS_MAP, NODE_RT_STATUS_COLOR, NODE_RT_STATUS_LABEL } from './workflow-runtime';

interface WorkflowGraphCanvasProps {
  flowData: WorkflowFlowData;
  nodeRuntime?: ReadonlyMap<string, NodeRuntimeInfo>;
  height?: number | string;
  instanceStatus?: string;
}

type GraphNodeData = {
  label: string;
  key: string;
  nodeType: WorkflowFlowData['nodes'][number]['data']['type'];
  configuredNames: string[];
  runtime?: NodeRuntimeInfo;
  instanceStatus?: string;
};
type CanvasNode = Node<GraphNodeData, 'workflow'>;

const WorkflowNode = memo(function WorkflowNode({ data }: NodeProps<CanvasNode>) {
  const runtime = data.runtime;
  const names = runtime?.approvers.length ? runtime.approvers.map((item) => item.name) : data.configuredNames;
  const instanceState = data.instanceStatus ? INSTANCE_STATUS_MAP[data.instanceStatus as keyof typeof INSTANCE_STATUS_MAP] : undefined;
  return (
    <div data-workflow-node-key={data.key} style={{
      width: 240, minHeight: 96, padding: 12, background: 'var(--semi-color-bg-0)',
      border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)',
      boxShadow: 'var(--semi-shadow-elevated)',
    }}>
      {data.nodeType !== 'start' && <Handle type="target" position={Position.Top} isConnectable={false} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <Typography.Text size="small" type="tertiary">{WORKFLOW_NODE_TYPE_LABELS[data.nodeType]}</Typography.Text>
        {runtime && <Tag size="small" color={NODE_RT_STATUS_COLOR[runtime.status]}>{NODE_RT_STATUS_LABEL[runtime.status]}</Tag>}
        {!runtime && data.nodeType === 'start' && instanceState && <Tag size="small" color="blue">已提交</Tag>}
        {!runtime && data.nodeType === 'end' && instanceState && <Tag size="small" color={instanceState.color}>{instanceState.text}</Tag>}
      </div>
      <Typography.Text strong style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{data.label}</Typography.Text>
      {names.length > 0 && (
        <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 6, overflowWrap: 'anywhere' }}>
          {names.join('、')}
        </Typography.Text>
      )}
      {data.nodeType !== 'end' && <Handle type="source" position={Position.Bottom} isConnectable={false} />}
    </div>
  );
});

const NODE_TYPES = { workflow: WorkflowNode };

/** Loaded together with React Flow/CSS only when a graph is opened. Renders every canonical edge, including loops and exceptions. */
export default function WorkflowGraphCanvas({ flowData, nodeRuntime, height = 480, instanceStatus }: Readonly<WorkflowGraphCanvasProps>) {
  const { nodes, edges } = useMemo(() => {
    const graphEdges: Edge[] = flowData.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      label: edge.label || (edge.isException ? '异常路径' : edge.isDefault ? '默认分支' : undefined),
      markerEnd: { type: MarkerType.ArrowClosed, color: edge.isException ? 'var(--semi-color-danger)' : 'var(--semi-color-text-2)' },
      style: { stroke: edge.isException ? 'var(--semi-color-danger)' : 'var(--semi-color-text-2)', ...(edge.isException ? { strokeDasharray: '6 4' } : {}) },
      labelStyle: { fill: 'var(--semi-color-text-0)', fontSize: 12 },
      labelBgStyle: { fill: 'var(--semi-color-bg-0)' },
      interactionWidth: 16,
    }));
    const graphNodes: CanvasNode[] = flowData.nodes.map((node) => ({
      id: node.id,
      type: 'workflow',
      position: node.position,
      data: {
        label: node.data.label,
        key: node.data.key,
        nodeType: node.data.type,
        configuredNames: node.data.assigneeNames ?? (node.data.assigneeName ? [node.data.assigneeName] : []),
        runtime: nodeRuntime?.get(node.data.key),
        instanceStatus,
      },
    }));
    const uniquePositions = new Set(graphNodes.map((node) => `${node.position.x},${node.position.y}`));
    return {
      nodes: uniquePositions.size <= 1 && graphNodes.length > 1
        ? layoutWithDagre(graphNodes, graphEdges, { rankdir: 'TB', nodesep: 72, ranksep: 80, nodeSize: { width: 240, height: 132 } })
        : graphNodes,
      edges: graphEdges,
    };
  }, [flowData, nodeRuntime, instanceStatus]);

  if (!nodes.length) return <Empty description="该流程尚未配置节点" />;
  return (
    <div style={{ height, minHeight: 280, width: '100%', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
      <ReactFlowProvider>
        <ThemedReactFlow<CanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.15}
          maxZoom={1.5}
          ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大流程图', 'controls.zoomOut.ariaLabel': '缩小流程图', 'controls.fitView.ariaLabel': '自适应流程图' }}
        >
          <Background gap={20} color="var(--semi-color-border)" />
          <Controls showInteractive={false} />
        </ThemedReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
