/**
 * 分支容器组件 — 条件分支 / 并行分支 / 包容分支 / 路由分支
 *
 * 渲染多列分支布局，每列内部可递归渲染子节点。
 */
import { X } from 'lucide-react';
import type { FlowNode, FlowBranch, FlowNodeType, BranchNodeType } from '../types';
import { NODE_COLOR_MAP, BRANCH_ADD_LABEL } from '../constants';
import AddNodeButton from './AddNodeButton';

interface BranchContainerProps {
  node: FlowNode;
  onAddBranch: (branchNodeId: string) => void;
  onRemoveBranch: (branchNodeId: string, branchId: string) => void;
  onEditBranch: (branch: FlowBranch, branchNodeId: string) => void;
  onAddNodeInBranch: (branchNodeId: string, branchId: string, nodeType: FlowNodeType) => void;
  renderChildren: (childNode: FlowNode | undefined, parentId: string) => React.ReactNode;
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
  renderChildren,
}: Readonly<BranchContainerProps>) {
  const branches = node.branches ?? [];
  const color = NODE_COLOR_MAP[node.type];
  const branchType = node.type as BranchNodeType;
  const addLabel = BRANCH_ADD_LABEL[branchType] ?? '添加分支';
  const canRemoveBranch = branches.length > 2;

  return (
    <div className="fd-branch-wrap">
      {/* 分支列容器 */}
      <div className="fd-branch-box">
        {/* 添加条件/分支按钮 */}
        <button
          className="fd-branch-add-btn"
          type="button"
          style={{ borderColor: color, color }}
          onClick={() => onAddBranch(node.id)}
        >
          {addLabel}
        </button>

        {branches.map((branch, index) => (
          <div key={branch.id} className="fd-branch-col">
            {/* 顶部竖线 */}
            <div className="fd-branch-col-top-line" />

            {/* 分支标题卡 */}
            <button className="fd-branch-title" type="button" onClick={() => onEditBranch(branch, node.id)}>
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

              {/* 删除分支按钮 */}
              {canRemoveBranch && !branch.isDefault && (
                <button
                  className="fd-branch-title__close"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemoveBranch(node.id, branch.id); }}
                  title={`删除${branch.name}`}
                >
                  <X size={10} />
                </button>
              )}
            </button>

            {/* 分支内添加节点 */}
            <AddNodeButton
              onAdd={(type) => onAddNodeInBranch(node.id, branch.id, type)}
            />

            {/* 分支内子节点 */}
            {renderChildren(branch.children, `branch-${branch.id}-${index}`)}

            {/* 底部竖线 */}
            <div className="fd-branch-col-bottom-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
