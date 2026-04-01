/**
 * FlowRenderer — 递归渲染整个流程树
 */
import type { FlowNode, FlowNodeType, FlowBranch } from '../types';
import { isBranchNode } from '../types';
import InitiatorNode from './InitiatorNode';
import EndNode from './EndNode';
import NodeCard from './NodeCard';
import AddNodeButton from './AddNodeButton';
import BranchContainer from './BranchContainer';

interface FlowRendererProps {
  process: { initiator: FlowNode };
  onEditNode: (node: FlowNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onAddNodeAfter: (parentId: string, nodeType: FlowNodeType) => void;
  onAddNodeInBranch: (branchNodeId: string, branchId: string, nodeType: FlowNodeType) => void;
  onAddBranch: (branchNodeId: string) => void;
  onRemoveBranch: (branchNodeId: string, branchId: string) => void;
  onEditBranch: (branch: FlowBranch, branchNodeId: string) => void;
}

export default function FlowRenderer({
  process,
  onEditNode,
  onDeleteNode,
  onAddNodeAfter,
  onAddNodeInBranch,
  onAddBranch,
  onRemoveBranch,
  onEditBranch,
}: Readonly<FlowRendererProps>) {

  /** 递归渲染节点链 */
  function renderNodeChain(node: FlowNode | undefined, _parentId: string): React.ReactNode {
    if (!node) return null;

    return (
      <>
        {isBranchNode(node.type) ? (
          <BranchContainer
            node={node}
            onAddBranch={onAddBranch}
            onRemoveBranch={onRemoveBranch}
            onEditBranch={onEditBranch}
            onAddNodeInBranch={onAddNodeInBranch}
            renderChildren={(childNode, key) => renderNodeChain(childNode, key)}
          />
        ) : (
          <NodeCard
            node={node}
            onEdit={onEditNode}
            onDelete={onDeleteNode}
          />
        )}

        {/* 节点后的 "+" 按钮 */}
        <AddNodeButton onAdd={(type) => onAddNodeAfter(node.id, type)} />

        {/* 递归渲染后续节点 */}
        {node.children && renderNodeChain(node.children, node.id)}
      </>
    );
  }

  return (
    <div className="fd-flow-wrap">
      {/* 发起人 */}
      <InitiatorNode
        node={process.initiator}
        onEdit={onEditNode}
      />

      {/* 发起人后的 "+" */}
      <AddNodeButton onAdd={(type) => onAddNodeAfter(process.initiator.id, type)} />

      {/* 后续节点链 */}
      {renderNodeChain(process.initiator.children, process.initiator.id)}

      {/* 结束节点 */}
      <EndNode />
    </div>
  );
}
