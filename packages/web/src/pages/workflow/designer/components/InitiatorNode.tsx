/**
 * 发起人节点
 */
import { ChevronRight, User } from 'lucide-react';
import type { FlowNode, FieldPermission, NodeRuntimeInfo } from '../types';

interface InitiatorNodeProps {
  node: FlowNode;
  onEdit: (node: FlowNode) => void;
  started?: boolean;
  runtime?: NodeRuntimeInfo;
  onSimulationNodeClick?: (node: FlowNode) => void;
  onSimulationNodeContextMenu?: (node: FlowNode) => void;
  simulationBreakpoint?: boolean;
}

export default function InitiatorNode({
  node,
  onEdit,
  started,
  runtime,
  onSimulationNodeClick,
  onSimulationNodeContextMenu,
  simulationBreakpoint = false,
}: Readonly<InitiatorNodeProps>) {
  const desc = node.props.initiatorDesc as string || '所有人';

  // 表单权限摘要
  const fp = node.props.fieldPermissions as Record<string, FieldPermission> | undefined;
  const permSummary = fp ? (() => {
    const values = Object.values(fp);
    const editCount = values.filter(v => v === 'edit').length;
    const readCount = values.filter(v => v === 'read').length;
    const hiddenCount = values.filter(v => v === 'hidden').length;
    const parts: string[] = [];
    if (editCount > 0) parts.push(`${editCount}可编辑`);
    if (readCount > 0) parts.push(`${readCount}只读`);
    if (hiddenCount > 0) parts.push(`${hiddenCount}隐藏`);
    return parts.length > 0 ? parts.join(' · ') : null;
  })() : null;

  return (
    <div className="fd-initiator-node">
      <button
        type="button"
        className={`fd-node-card fd-node-card--initiator${runtime ? ` fd-node-card--rt fd-node-card--rt-${runtime.status}` : ''}${runtime?.active ? ' fd-node-card--rt-active' : ''}${onSimulationNodeClick || onSimulationNodeContextMenu ? ' fd-node-card--sim-interactive' : ''}${simulationBreakpoint ? ' fd-node-card--sim-breakpoint' : ''}`}
        onClick={() => (onSimulationNodeClick ? onSimulationNodeClick(node) : onEdit(node))}
        onContextMenu={onSimulationNodeContextMenu ? (e) => {
          e.preventDefault();
          e.stopPropagation();
          onSimulationNodeContextMenu(node);
        } : undefined}
        title={onSimulationNodeClick || onSimulationNodeContextMenu ? '点击跳转到仿真步骤；右键切换断点' : undefined}
      >
        <div className="fd-node-card__header" style={{ background: '#ff943e' }}>
          <span className="fd-node-card__header-icon"><User size={14} /></span>
          <span className="fd-node-card__header-title">{node.name}</span>
          {started && <span className="fd-node-card__header-status" style={{ marginLeft: 'auto', fontSize: 12 }}>已发起</span>}
        </div>
        <div className="fd-node-card__body">
          <div className="fd-node-card__body-content">
            <span className="fd-node-card__body-text">{desc}</span>
            {permSummary && (
              <div className="fd-node-card__body-tags">
                <span className="fd-node-card__tag">{permSummary}</span>
              </div>
            )}
          </div>
          <ChevronRight size={16} className="fd-node-card__body-arrow" />
        </div>
      </button>
    </div>
  );
}
