import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Switch, Space, Typography, Empty } from '@douyinfe/semi-ui';
import type { WorkflowFormField } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';
import { buildFieldDependencyGraph, DEP_KIND_COLOR, type DepKind } from '../form-graph';

const NODE_WIDTH = 190;
const NODE_HEIGHT = 54;

const TYPE_LABEL = new Map(FORM_FIELD_TYPES.map((t) => [t.type as string, t.label]));

interface FieldNodeData extends Record<string, unknown> {
  label: string;
  typeLabel: string;
  fieldKey: string;
  missing: boolean;
  dimmed: boolean;
}

const FieldNode = memo(({ data, selected }: NodeProps) => {
  const d = data as FieldNodeData;
  return (
    <div
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        background: d.missing ? 'var(--semi-color-danger-light-default)' : 'var(--semi-color-bg-0)',
        border: `1px solid ${selected ? 'var(--semi-color-primary)' : d.missing ? 'var(--semi-color-danger)' : 'var(--semi-color-border)'}`,
        borderRadius: 6,
        boxShadow: selected ? '0 0 0 2px var(--semi-color-primary-light-default)' : 'none',
        opacity: d.dimmed ? 0.2 : 1,
        padding: '6px 10px',
        transition: 'opacity 120ms',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--semi-color-primary)', width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--semi-color-primary)', width: 6, height: 6 }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: d.missing ? 'var(--semi-color-danger)' : 'var(--semi-color-text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {d.label}{d.missing ? '（缺失）' : ''}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 10, color: 'var(--semi-color-text-2)' }}>{d.typeLabel}</span>
        <span style={{ fontSize: 10, color: 'var(--semi-color-text-2)', fontFamily: 'var(--semi-font-family-mono, monospace)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{d.fieldKey}</span>
      </div>
    </div>
  );
});
FieldNode.displayName = 'FieldNode';

const nodeTypes = { field: FieldNode };

function layoutWithDagre(nodes: RFNode[], edges: RFEdge[]): RFNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 90, marginx: 20, marginy: 20 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 } };
  });
}

function FieldDependencyGraphInner({ fields }: Readonly<{ fields: WorkflowFormField[] }>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hideIsolated, setHideIsolated] = useState(true);

  const graph = useMemo(() => buildFieldDependencyGraph(fields), [fields]);

  const connectedKeys = useMemo(() => {
    const s = new Set<string>();
    graph.edges.forEach((e) => { s.add(e.source); s.add(e.target); });
    return s;
  }, [graph.edges]);

  const baseNodes = useMemo<RFNode[]>(() => {
    const visible = graph.nodes.filter((n) => !hideIsolated || n.missing || connectedKeys.has(n.key));
    return visible.map((n) => ({
      id: n.key,
      type: 'field',
      position: { x: 0, y: 0 },
      data: {
        label: n.label,
        typeLabel: n.missing ? '缺失字段' : (TYPE_LABEL.get(n.type) ?? n.type),
        fieldKey: n.key,
        missing: !!n.missing,
        dimmed: false,
      } satisfies FieldNodeData,
    }));
  }, [graph.nodes, hideIsolated, connectedKeys]);

  const baseEdges = useMemo<RFEdge[]>(() => {
    const visibleIds = new Set(baseNodes.map((n) => n.id));
    return graph.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e, i) => {
        const color = DEP_KIND_COLOR[e.kind];
        return {
          id: `dep-${i}-${e.source}-${e.target}-${e.kind}`,
          source: e.source,
          target: e.target,
          label: e.kind,
          labelStyle: { fontSize: 10, fill: color },
          labelBgStyle: { fill: 'var(--semi-color-bg-0)' },
          style: { stroke: color, strokeWidth: 1.4 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        } satisfies RFEdge;
      });
  }, [graph.edges, baseNodes]);

  const laidOutNodes = useMemo(() => layoutWithDagre(baseNodes, baseEdges), [baseNodes, baseEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(laidOutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(baseEdges);

  useEffect(() => {
    setNodes(laidOutNodes);
    setEdges(baseEdges);
    setSelectedId(null);
  }, [laidOutNodes, baseEdges, setNodes, setEdges]);

  useEffect(() => {
    if (!selectedId) {
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...(n.data as FieldNodeData), dimmed: false } })));
      setEdges((es) => es.map((e) => ({ ...e, style: { ...e.style, opacity: 1 } })));
      return;
    }
    const related = new Set<string>([selectedId]);
    const relatedEdges = new Set<string>();
    baseEdges.forEach((e) => {
      if (e.source === selectedId || e.target === selectedId) {
        related.add(e.source);
        related.add(e.target);
        relatedEdges.add(e.id);
      }
    });
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...(n.data as FieldNodeData), dimmed: !related.has(n.id) } })));
    setEdges((es) => es.map((e) => ({ ...e, style: { ...e.style, opacity: relatedEdges.has(e.id) ? 1 : 0.08 } })));
  }, [selectedId, baseEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback((_: unknown, node: RFNode) => {
    setSelectedId((prev) => (prev === node.id ? null : node.id));
  }, []);
  const handlePaneClick = useCallback(() => setSelectedId(null), []);

  const kinds: DepKind[] = ['公式', '显隐', '必填', '只读', '级联', '天数', '赋值'];

  if (graph.edges.length === 0) {
    return (
      <div style={{ padding: '48px 0' }}>
        <Empty description="当前表单字段之间还没有公式/显隐/级联/赋值等依赖关系" />
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: 560, border: '1px solid var(--semi-color-border)', borderRadius: 6, background: 'var(--semi-color-bg-0)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--semi-color-border)', background: 'var(--semi-color-fill-0)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Space spacing="tight">
          <Switch size="small" checked={hideIsolated} onChange={setHideIsolated} />
          <span style={{ fontSize: 12, color: 'var(--semi-color-text-1)' }}>只看有依赖的字段</span>
        </Space>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {kinds.map((k) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--semi-color-text-1)' }}>
              <span style={{ width: 14, height: 2, background: DEP_KIND_COLOR[k], display: 'inline-block' }} />{k}
            </span>
          ))}
        </div>
        <Typography.Text type="tertiary" size="small" style={{ marginLeft: 'auto' }}>箭头：驱动方 → 被影响方；点击节点高亮相关</Typography.Text>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

export default function FieldDependencyGraph(props: Readonly<{ fields: WorkflowFormField[] }>) {
  return (
    <ReactFlowProvider>
      <FieldDependencyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
