/**
 * 分支容器组件 — 条件分支 / 并行分支 / 包容分支 / 路由分支
 *
 * 渲染多列分支布局，每列内部可递归渲染子节点。
 */
import { Trash2, X } from 'lucide-react';
import { Popconfirm } from '@douyinfe/semi-ui';
import type { FlowNode, FlowBranch, FlowNodeType, BranchNodeType } from '../types';
import { NODE_COLOR_MAP, BRANCH_ADD_LABEL } from '../constants';
import AddNodeButton from './AddNodeButton';

interface BranchContainerProps {
  node: FlowNode;
  onAddBranch: (branchNodeId: string) => void;
  onRemoveBranch: (branchNodeId: string, branchId: string) => void;
  onEditBranch: (branch: FlowBranch, branchNodeId: string) => void;
  onAddNodeInBranch: (branchNodeId: string, branchId: string, nodeType: FlowNodeType) => void;
  onDeleteNode?: (nodeId: string) => void;
  renderChildren: (childNode: FlowNode | undefined, parentId: string) => React.ReactNode;
  readOnly?: boolean;
}

function getBranchNameClass(type: BranchNodeType, isDefault?: boolean): string {
  if (isDefault) return 'fd-branch-title__name fd-branch-title__name--default';
  switch (type) {
    case 'conditionBranch': return 'fd-branch-title__name fd-branch-title__name--condition';
    case 'parallelBranch': return 'fd-branch-title__name fd-branch-title__name--parallel';
    case 'inclusiveBranch': return 'fd-branch-title__name fd-branch-title__name--inclusive';
    default: return 'fd-branch-title__name fd-branch-title__name--condition';
  }
}

function getBranchDesc(branch: FlowBranch, branchType: BranchNodeType): string {
  if (branch.isDefault) return '未满足其它条件时，将进入此分支';
  if (branchType === 'parallelBranch') return '无需配置条件，同时执行';
  if (branch.conditions?.length) {
    const totalRules = branch.conditions.reduce((s, g) => s + g.rules.length, 0);
    const groupInfo = branch.conditions.map(g => {
      const logicLabel = g.type === 'and' ? '且' : '或';
      return `${g.rules.length}条件(${logicLabel})`;
    }).join(' + ');
    return `${totalRules} 个条件：${groupInfo}`;
  }
  return '点击配置条件';
}

export default function BranchContainer({
  node,
  onAddBranch,
  onRemoveBranch,
  onEditBranch,
  onAddNodeInBranch,
  onDeleteNode,
  renderChildren,
  readOnly = false,
}: Readonly<BranchContainerProps>) {
  const branches = node.branches ?? [];
  const color = NODE_COLOR_MAP[node.type];
  const branchType = node.type as BranchNodeType;
  const addLabel = BRANCH_ADD_LABEL[branchType] ?? '添加分支';
  const canRemoveBranch = branches.length > 2;

  return (
    <div className="fd-branch-wrap">
      {!readOnly && (
      <div className="fd-branch-toolbar">
        <button
          className="fd-branch-add-btn"
          type="button"
          style={{ borderColor: color, color }}
          onClick={() => onAddBranch(node.id)}
        >
          {addLabel}
        </button>
        {onDeleteNode && (
          <Popconfirm
            title="确认删除整个分支节点？"
            content="所有分支及其内部节点将被一并删除"
            position="top"
            onConfirm={() => onDeleteNode(node.id)}
          >
            <button
              type="button"
              className="fd-branch-delete-btn"
              title="删除整个分支节点"
            >
              <Trash2 size={12} />
              <span>删除分支</span>
            </button>
          </Popconfirm>
        )}
      </div>
      )}

      <div className="fd-branch-box">
        {branches.map((branch, index) => (
          <div key={branch.id} className="fd-branch-col">
            <div className="fd-branch-col-top-line" />

            <button className="fd-branch-title" type="button" onClick={readOnly ? undefined : () => onEditBranch(branch, node.id)} tabIndex={readOnly ? -1 : 0}>
              <div className="fd-branch-title__header">
                <span className={getBranchNameClass(branchType, branch.isDefault)}>
                  {branch.name}
                </span>
                {branch.priority != null && (
                  <span className="fd-branch-title__priority">
                    优先级{branch.priority}
                  </span>
                )}
              </div>
              <div className="fd-branch-title__desc">
                {getBranchDesc(branch, branchType)}
              </div>

              {!readOnly && canRemoveBranch && !branch.isDefault && (
                <span
                  className="fd-branch-title__close"
                  role="none"
                  onClick={(e) => { e.stopPropagation(); onRemoveBranch(node.id, branch.id); }}
                  title={`删除${branch.name}`}
                >
                  <X size={10} />
                </span>
              )}
            </button>

            {!readOnly && (
              <AddNodeButton
                onAdd={(type) => onAddNodeInBranch(node.id, branch.id, type)}
              />
            )}

            {renderChildren(branch.children, `branch-${branch.id}-${index}`)}

            <div className="fd-branch-col-bottom-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
