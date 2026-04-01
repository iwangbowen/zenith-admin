/**
 * 通用节点卡片 — 审批人 / 办理人 / 抄送 / 延迟器 / 触发器 / 子流程
 */
import { ChevronRight, X } from 'lucide-react';
import type { FlowNode } from '../types';
import { NODE_COLOR_MAP, ADDABLE_NODE_TYPES } from '../constants';

interface NodeCardProps {
  node: FlowNode;
  onEdit: (node: FlowNode) => void;
  onDelete: (nodeId: string) => void;
}

function getNodeInfo(type: FlowNode['type']) {
  return ADDABLE_NODE_TYPES.find(n => n.type === type);
}

export default function NodeCard({ node, onEdit, onDelete }: NodeCardProps) {
  const info = getNodeInfo(node.type);
  const color = NODE_COLOR_MAP[node.type] ?? '#999';
  const Icon = info?.icon;

  const bodyText = node.props.assigneeName as string
    || node.props.description as string
    || '请设置';

  return (
    <div
      className="fd-node-card"
      onClick={() => onEdit(node)}
    >
      {/* 标题栏 */}
      <div className="fd-node-card__header" style={{ background: color }}>
        {Icon && (
          <span className="fd-node-card__header-icon">
            <Icon size={14} />
          </span>
        )}
        <span className="fd-node-card__header-title">{node.name || info?.label || '节点'}</span>
        <span className="fd-node-card__header-actions">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
            title="删除"
          >
            <X size={12} />
          </button>
        </span>
      </div>

      {/* 内容区 */}
      <div className="fd-node-card__body">
        <span className="fd-node-card__body-text">{bodyText}</span>
        <ChevronRight size={16} className="fd-node-card__body-arrow" />
      </div>
    </div>
  );
}
