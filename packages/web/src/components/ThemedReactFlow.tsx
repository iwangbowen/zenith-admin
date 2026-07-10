import {
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useThemeController } from '../providers/theme-controller';

export function ThemedReactFlow<
  NodeType extends Node = Node,
  EdgeType extends Edge = Edge,
>({
  className,
  proOptions,
  ...props
}: ReactFlowProps<NodeType, EdgeType>) {
  const { isDark } = useThemeController();

  return (
    <ReactFlow<NodeType, EdgeType>
      {...props}
      className={['zenith-react-flow', className].filter(Boolean).join(' ')}
      colorMode={isDark ? 'dark' : 'light'}
      proOptions={{ hideAttribution: true, ...proOptions }}
    />
  );
}
