import dagre from 'dagre';
import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react';

export interface DagreLayoutOptions<N extends RFNode = RFNode> {
  /** 排布方向：`TB` 自上而下（拓扑树）/ `LR` 自左向右（依赖图 / ER 图） */
  rankdir: 'TB' | 'LR';
  /** 同层节点间距 */
  nodesep: number;
  /** 层间距 */
  ranksep: number;
  /** 节点尺寸；定尺图直接给对象，尺寸随内容变化的图给函数 */
  nodeSize: { width: number; height: number } | ((node: N) => { width: number; height: number });
  /** 画布外边距，缺省 20 */
  margin?: number;
}

/**
 * 用 dagre 为 React Flow 节点计算自动布局：dagre 给出的是节点中心点，这里换算为 React Flow 需要的左上角坐标。
 * IoT 拓扑 / 表单字段依赖图 / ER 图共用，仅方向、间距与节点尺寸不同。
 */
export function layoutWithDagre<N extends RFNode>(nodes: N[], edges: RFEdge[], options: DagreLayoutOptions<N>): N[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  const margin = options.margin ?? 20;
  g.setGraph({ rankdir: options.rankdir, nodesep: options.nodesep, ranksep: options.ranksep, marginx: margin, marginy: margin });
  const sizeOf = typeof options.nodeSize === 'function' ? options.nodeSize : () => options.nodeSize as { width: number; height: number };
  nodes.forEach((n) => g.setNode(n.id, sizeOf(n)));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 } };
  });
}
