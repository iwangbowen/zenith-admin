/**
 * 发起人节点
 */
import { ChevronRight, User } from 'lucide-react';
import type { FlowNode } from '../types';

interface InitiatorNodeProps {
  node: FlowNode;
  onEdit: (node: FlowNode) => void;
}

export default function InitiatorNode({ node, onEdit }: InitiatorNodeProps) {
  const desc = node.props.initiatorDesc as string || '请设置发起人';

  return (
    <div className="fd-initiator-node">
      <div
        className="fd-node-card fd-node-card--initiator"
        onClick={() => onEdit(node)}
      >
        <div className="fd-node-card__header" style={{ background: '#ff943e' }}>
          <span className="fd-node-card__header-icon"><User size={14} /></span>
          <span className="fd-node-card__header-title">{node.name}</span>
        </div>
        <div className="fd-node-card__body">
          <span className="fd-node-card__body-text">{desc}</span>
          <ChevronRight size={16} className="fd-node-card__body-arrow" />
        </div>
      </div>
    </div>
  );
}
