/**
 * FlowRenderer — 递归渲染整个流程树
 */
import type { FlowNode, FlowNodeType, FlowBranch, NodeRuntimeInfo, NodeHealthInfo } from '../types';
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
  formFields?: ReadonlyArray<{ key: string; label: string; type?: string; options?: readonly string[] }>;
  readOnly?: boolean;
  /** 只读但允许点击节点查看其配置（只读设计器场景） */
  readOnlyInteractive?: boolean;
  /** 运行态：nodeKey → 节点运行态（实例详情流程图叠加状态） */
  nodeRuntime?: Map<string, NodeRuntimeInfo>;
  /** 设计态：nodeKey → 节点体检问题（画布实时红点/告警角标） */
  nodeHealth?: Map<string, NodeHealthInfo>;
  /** 运行态：未被实际命中的分支 id 集合（用于置灰未走的分支） */
  dimmedBranchIds?: Set<string>;
  /** 运行态：实例状态（用于 start/end 节点状态标识） */
  instanceStatus?: string;
  /** 仿真图交互：点击节点跳转到该节点步骤 */
  onSimulationNodeClick?: (node: FlowNode) => void;
  /** 仿真图交互：右键节点切换断点 */
  onSimulationNodeContextMenu?: (node: FlowNode) => void;
  /** 仿真图交互：点击分支查看条件命中原因 */
  onSimulationBranchClick?: (branch: FlowBranch, branchNode: FlowNode) => void;
  selectedSimulationBranchId?: string | null;
  simulationBreakpoints?: Set<string>;
  /** 仿真图：调试模式开启时，节点显示断点切换 affordance */
  simulationDebug?: boolean;
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
  nodeHealth,
  dimmedBranchIds,
  instanceStatus,
  onSimulationNodeClick,
  onSimulationNodeContextMenu,
  onSimulationBranchClick,
  selectedSimulationBranchId,
  simulationBreakpoints,
  simulationDebug,
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

    if (node.sharedReference) {
      const interactive = !readOnly || readOnlyInteractive;
      return (
        <button
          type="button"
          className="fd-shared-node-reference"
          disabled={!interactive}
          onClick={interactive ? () => editNode(node) : undefined}
          title={interactive ? '点击编辑共享节点，修改将同步到所有引用路径' : undefined}
        >
          <span>共享节点：{node.name}</span>
          {interactive && <span className="fd-shared-node-reference__hint">点击查看配置</span>}
        </button>
      );
    }

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
            health={nodeHealth?.get(node.key ?? node.id)}
            dimmedBranchIds={dimmedBranchIds}
            onSimulationBranchClick={onSimulationBranchClick}
            selectedSimulationBranchId={selectedSimulationBranchId}
            renderChildren={(childNode, key) => renderNodeChain(childNode, key)}
            readOnly={readOnly}
          />
        ) : (
          <NodeCard
            node={node}
            formFields={formFields}
            onEdit={editNode}
            onDelete={deleteNode}
            onDuplicate={onDuplicateNode}
            readOnly={readOnly}
            readOnlyInteractive={readOnlyInteractive}
            runtime={nodeRuntime?.get(node.key ?? node.id)}
            health={nodeHealth?.get(node.key ?? node.id)}
            onSimulationNodeClick={onSimulationNodeClick}
            onSimulationNodeContextMenu={onSimulationNodeContextMenu}
            simulationBreakpoint={simulationBreakpoints?.has(node.key ?? node.id)}
            simulationDebug={simulationDebug}
          />
        )}

        {(!isBranchNode(node.type) || node.children) && !readOnly && <AddNodeButton onAdd={(type) => addAfter(node.id, type)} />}
        {(!isBranchNode(node.type) || node.children) && readOnly && <AddNodeButton onAdd={noop} readOnly />}

        {node.children && renderNodeChain(node.children, node.id)}
      </>
    );
  }

  return (
    <div className="fd-flow-wrap">
      <InitiatorNode
        node={process.initiator}
        onEdit={editNode}
        started={!!nodeRuntime}
        runtime={nodeRuntime?.get(process.initiator.key ?? 'start') ?? nodeRuntime?.get('start')}
        onSimulationNodeClick={onSimulationNodeClick}
        onSimulationNodeContextMenu={onSimulationNodeContextMenu}
        simulationBreakpoint={simulationBreakpoints?.has(process.initiator.key ?? 'start') || simulationBreakpoints?.has('start')}
        simulationDebug={simulationDebug}
      />

      {!readOnly && <AddNodeButton onAdd={(type) => addAfter(process.initiator.id, type)} />}
      {readOnly && <AddNodeButton onAdd={noop} readOnly />}

      {renderNodeChain(process.initiator.children, process.initiator.id)}

      <EndNode status={nodeRuntime ? instanceStatus : undefined} />
    </div>
  );
}
