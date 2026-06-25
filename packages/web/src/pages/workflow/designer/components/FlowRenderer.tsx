/**
 * FlowRenderer — 递归渲染整个流程树
 */
import type { FlowNode, FlowNodeType, FlowBranch, NodeRuntimeInfo } from '../types';
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
  onMoveBranch?: (branchNodeId: string, branchId: string, direction: 'up' | 'down') => void;
  formFields?: ReadonlyArray<{ key: string; label: string; type?: string }>;
  readOnly?: boolean;
  /** 只读但允许点击节点查看其配置（只读设计器场景） */
  readOnlyInteractive?: boolean;
  /** 运行态：nodeKey → 节点运行态（实例详情流程图叠加状态） */
  nodeRuntime?: Map<string, NodeRuntimeInfo>;
  /** 运行态：未被实际命中的分支 id 集合（用于置灰未走的分支） */
  dimmedBranchIds?: Set<string>;
  /** 运行态：实例状态（用于 start/end 节点状态标识） */
  instanceStatus?: string;
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
  onMoveBranch,
  formFields,
  readOnly = false,
  readOnlyInteractive = false,
  nodeRuntime,
  dimmedBranchIds,
  instanceStatus,
}: Readonly<FlowRendererProps>) {

  const editNode = onEditNode ?? noop;
  const deleteNode = onDeleteNode ?? noop;
  const addAfter = onAddNodeAfter ?? noop;
  const addInBranch = onAddNodeInBranch ?? noop;
  const addBranch = onAddBranch ?? noop;
  const removeBranch = onRemoveBranch ?? noop;
  const editBranch = onEditBranch ?? noop;
  const moveBranch = onMoveBranch ?? noop;

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
            onMoveBranch={moveBranch}
            onEditNode={editNode}
            formFields={formFields}
            dimmedBranchIds={dimmedBranchIds}
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
            readOnlyInteractive={readOnlyInteractive}
            runtime={nodeRuntime?.get(node.key ?? node.id)}
          />
        )}

        {!readOnly && <AddNodeButton onAdd={(type) => addAfter(node.id, type)} />}
        {readOnly && <AddNodeButton onAdd={noop} readOnly />}

        {node.children && renderNodeChain(node.children, node.id)}
      </>
    );
  }

  return (
    <div className="fd-flow-wrap">
      <InitiatorNode
        node={process.initiator}
        onEdit={editNode}
        started={readOnly && !!nodeRuntime}
      />

      {!readOnly && <AddNodeButton onAdd={(type) => addAfter(process.initiator.id, type)} />}
      {readOnly && <AddNodeButton onAdd={noop} readOnly />}

      {renderNodeChain(process.initiator.children, process.initiator.id)}

      <EndNode status={readOnly && nodeRuntime ? instanceStatus : undefined} />
    </div>
  );
}
