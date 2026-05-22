import { useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node as RFNode,
  type Edge as RFEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export interface ErFk {
  schema: string;
  table: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
}

interface ErDiagramProps {
  fks: ErFk[];
  onNodeClick?: (full: string) => void;
}

export function ErDiagram({ fks, onNodeClick }: Readonly<ErDiagramProps>) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const tableSet = new Set<string>();
    fks.forEach((f) => {
      tableSet.add(`${f.schema}.${f.table}`);
      tableSet.add(`${f.referencedSchema}.${f.referencedTable}`);
    });
    const tableList = Array.from(tableSet).sort((a, b) => a.localeCompare(b));
    const cols = 4;
    const cellW = 240;
    const cellH = 110;
    const nodes: RFNode[] = tableList.map((full, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        id: full,
        position: { x: col * cellW, y: row * cellH },
        data: { label: full },
        style: {
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid var(--semi-color-border)',
          background: 'var(--semi-color-fill-0)',
          color: 'var(--semi-color-text-0)',
          fontSize: 12,
          width: 200,
        },
      };
    });
    const edges: RFEdge[] = fks.map((fk, i) => ({
      id: `er-${i}-${fk.schema}.${fk.table}-${fk.columns.join(',')}`,
      source: `${fk.schema}.${fk.table}`,
      target: `${fk.referencedSchema}.${fk.referencedTable}`,
      label: fk.columns.join(','),
      labelStyle: { fontSize: 10, fill: 'var(--semi-color-text-2)' },
      labelBgStyle: { fill: 'var(--semi-color-bg-0)' },
      style: { stroke: 'var(--semi-color-primary)', strokeWidth: 1.2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--semi-color-primary)' },
    }));
    return { initialNodes: nodes, initialEdges: edges };
  }, [fks]);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div
      style={{
        width: '100%',
        height: 600,
        border: '1px solid var(--semi-color-border)',
        borderRadius: 6,
        background: 'var(--semi-color-bg-0)',
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
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
