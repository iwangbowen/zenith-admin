import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useEdgesState, useNodesState, type Edge as RFEdge, type Node as RFNode } from '@xyflow/react';

export type GraphEdgeHighlightState = 'reset' | 'related' | 'unrelated';

export interface UseGraphSelectionHighlightOptions {
  /**
   * 边在三种状态下要合并进 `edge.style` 的样式：
   * `reset` = 无选中，`related` = 与选中节点相邻，`unrelated` = 其余边（通常压低 opacity）。
   */
  readonly edgeStyle: (state: GraphEdgeHighlightState) => CSSProperties;
}

/**
 * React Flow 关系图的「点选节点 → 高亮相邻、淡化其余」交互状态。
 *
 * 封装了三段每张关系图都要抄一遍的逻辑：
 * 1. 以布局后的节点 / 边初始化 `useNodesState` / `useEdgesState`，输入变化时整体重置并清空选中；
 * 2. 选中变化时把 `data.dimmed` 写回每个节点、按 `edgeStyle` 重写每条边样式；
 * 3. 节点点击切换选中、画布点击清空。
 *
 * 节点 `data` 需带 `dimmed: boolean` 字段（由节点组件负责渲染淡化效果）。
 */
export function useGraphSelectionHighlight<TNodeData extends { dimmed: boolean }>(
  laidOutNodes: RFNode[],
  baseEdges: RFEdge[],
  { edgeStyle }: UseGraphSelectionHighlightOptions,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(laidOutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(baseEdges);

  useEffect(() => {
    setNodes(laidOutNodes);
    setEdges(baseEdges);
    setSelectedId(null);
  }, [laidOutNodes, baseEdges, setNodes, setEdges]);

  useEffect(() => {
    if (!selectedId) {
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...(n.data as TNodeData), dimmed: false } })));
      setEdges((es) => es.map((e) => ({ ...e, style: { ...e.style, ...edgeStyle('reset') } })));
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
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...(n.data as TNodeData), dimmed: !related.has(n.id) } })));
    setEdges((es) => es.map((e) => ({ ...e, style: { ...e.style, ...edgeStyle(relatedEdges.has(e.id) ? 'related' : 'unrelated') } })));
    // edgeStyle 通常是页面里的字面量函数，每次渲染引用都不同；它只依赖状态参数，不纳入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, baseEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback((_: unknown, node: RFNode) => {
    setSelectedId((prev) => (prev === node.id ? null : node.id));
  }, []);
  const handlePaneClick = useCallback(() => setSelectedId(null), []);

  return { selectedId, setSelectedId, nodes, edges, onNodesChange, onEdgesChange, handleNodeClick, handlePaneClick };
}
