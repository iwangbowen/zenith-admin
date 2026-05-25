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
  onEditNode?: (node: FlowNode) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onAddNodeAfter?: (parentId: string, nodeType: FlowNodeType) => void;
  onAddNodeInBranch?: (branchNodeId: string, branchId: string, nodeType: FlowNodeType) => void;
  onAddBranch?: (branchNodeId: string) => void;
  onRemoveBranch?: (branchNodeId: string, branchId: string) => void;
  onEditBranch?: (branch: FlowBranch, branchNodeId: string) => void;
  formFields?: ReadonlyArray<{ key: string; label: string; type?: string }>;
  readOnly?: boolean;
}

const noop = () => { /* noop */ };

export default function FlowRenderer({
  process,
  onEditNode,
  onDeleteNode,
  onDuplicateNode,
  onAddNodeAfter,
  onAddNodeInBranch,
  onAddBranch,
  onRemoveBranch,
  onEditBranch,
  formFields,
  readOnly = false,
}: Readonly<FlowRendererProps>) {

  const editNode = onEditNode ?? noop;
  const deleteNode = onDeleteNode ?? noop;
  const addAfter = onAddNodeAfter ?? noop;
  const addInBranch = onAddNodeInBranch ?? noop;
  const addBranch = onAddBranch ?? noop;
  const removeBranch = onRemoveBranch ?? noop;
  const editBranch = onEditBranch ?? noop;

  function renderNodeChain(node: FlowNode | undefined, _parentId: string): React.ReactNode {
    if (!node) return null;

    return (
      <>
        {isBranchNode(node.type) ? (
          <BranchContainer
            node={node}
            onAddBranch={addBranch}
            onRemoveBranch={removeBranch}
            onEditBranch={editBranch}
            onAddNodeInBranch={addInBranch}
            onDeleteNode={deleteNode}
            onEditNode={editNode}
            formFields={formFields}
            renderChildren={(childNode, key) => renderNodeChain(childNode, key)}
            readOnly={readOnly}
          />
        ) : (
          <NodeCard
            node={node}
            onEdit={editNode}
            onDelete={deleteNode}
            onDuplicate={onDuplicateNode}
            readOnly={readOnly}
          />
        )}

        {!readOnly && <AddNodeButton onAdd={(type) => addAfter(node.id, type)} />}

        {node.children && renderNodeChain(node.children, node.id)}
      </>
    );
  }

  return (
    <div className="fd-flow-wrap">
      <InitiatorNode
        node={process.initiator}
        onEdit={editNode}
      />

      {!readOnly && <AddNodeButton onAdd={(type) => addAfter(process.initiator.id, type)} />}

      {renderNodeChain(process.initiator.children, process.initiator.id)}

      <EndNode />
    </div>
  );
}
