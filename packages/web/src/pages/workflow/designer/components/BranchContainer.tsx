/**
 * 分支容器组件 — 条件分支 / 并行分支 / 包容分支 / 路由分支
 *
 * 渲染多列分支布局，每列内部可递归渲染子节点。
 */
import { Pencil, X, ChevronUp, ChevronDown } from 'lucide-react';
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
  /** 条件分支专用：上移/下移分支以调整优先级（匹配顺序） */
  onMoveBranch?: (branchNodeId: string, branchId: string, direction: 'up' | 'down') => void;
  /** 点击路由分支头部提示行时打开节点配置抽屉 */
  onEditNode?: (node: FlowNode) => void;
  renderChildren: (childNode: FlowNode | undefined, parentId: string) => React.ReactNode;
  /** 可选：表单字段列表，用于路由分支展示「路由字段：XXX」提示 */
  formFields?: ReadonlyArray<{ key: string; label: string; type?: string }>;
  /** 运行态：未被实际命中的分支 id（置灰展示） */
  dimmedBranchIds?: Set<string>;
  readOnly?: boolean;
  /** 仿真图交互：点击分支标题查看条件命中原因 */
  onSimulationBranchClick?: (branch: FlowBranch, branchNode: FlowNode) => void;
  selectedSimulationBranchId?: string | null;
}

function getBranchNameClass(type: BranchNodeType, isDefault?: boolean): string {
  if (isDefault) return 'fd-branch-title__name fd-branch-title__name--default';
  switch (type) {
    case 'conditionBranch': return 'fd-branch-title__name fd-branch-title__name--condition';
    case 'parallelBranch': return 'fd-branch-title__name fd-branch-title__name--parallel';
    case 'inclusiveBranch': return 'fd-branch-title__name fd-branch-title__name--inclusive';
    case 'routeBranch': return 'fd-branch-title__name fd-branch-title__name--route';
    default: return 'fd-branch-title__name fd-branch-title__name--condition';
  }
}

function getBranchDesc(branch: FlowBranch, branchType: BranchNodeType): string {
  if (branch.isDefault) return '未命中其它分支时，将进入此分支';
  if (branchType === 'parallelBranch') return '';
  if (branchType === 'routeBranch') {
    const v = branch.caseValue?.trim();
    return v ? `匹配值：${v}` : '点击配置路由值';
  }
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

function getBranchBanner(branchType: BranchNodeType): { text: string; className: string } | null {
  switch (branchType) {
    case 'parallelBranch':
      return { text: '并行分支：所有分支同时执行，全部完成后才会继续', className: 'fd-branch-banner fd-branch-banner--parallel' };
    case 'inclusiveBranch':
      return { text: '包容分支：所有满足条件的分支同时执行', className: 'fd-branch-banner fd-branch-banner--inclusive' };
    default:
      return null;
  }
}

export default function BranchContainer({
  node,
  onAddBranch,
  onRemoveBranch,
  onEditBranch,
  onAddNodeInBranch,
  onDeleteNode,
  onMoveBranch,
  onEditNode,
  renderChildren,
  formFields,
  dimmedBranchIds,
  readOnly = false,
  onSimulationBranchClick,
  selectedSimulationBranchId,
}: Readonly<BranchContainerProps>) {
  const branches = node.branches ?? [];
  const color = NODE_COLOR_MAP[node.type];
  const branchType = node.type as BranchNodeType;
  const addLabel = BRANCH_ADD_LABEL[branchType] ?? '添加分支';
  // 仅条件分支的优先级（匹配顺序）有意义，提供上移/下移
  const showReorder = !readOnly && branchType === 'conditionBranch' && !!onMoveBranch;
  const nonDefaultCount = branches.filter(b => !b.isDefault).length;
  // 非默认分支始终可关闭；当剩余分支 ≤ 2 时点击 X 改为删除整个网关节点
  const handleBranchClose = (branchId: string) => {
    if (branches.length > 2) {
      onRemoveBranch(node.id, branchId);
    } else if (onDeleteNode) {
      onDeleteNode(node.id);
    }
  };

  // 路由分支顶部提示行：展示当前已选的路由字段
  const routeFieldKey = node.type === 'routeBranch'
    ? (node.props?.routeFieldKey as string | undefined)?.trim()
    : undefined;
  const routeFieldLabel = routeFieldKey
    ? (formFields?.find(f => f.key === routeFieldKey)?.label ?? routeFieldKey)
    : null;

  const banner = getBranchBanner(branchType);

  return (
    <>
      {branchType === 'routeBranch' && (
        <button
          type="button"
          className="fd-branch-route-hint"
          onClick={readOnly ? undefined : () => onEditNode?.(node)}
          title={readOnly ? undefined : '点击调整路由字段'}
          disabled={readOnly}
        >
          <span className="fd-branch-route-hint__label">路由字段：</span>
          <span className="fd-branch-route-hint__value">{routeFieldLabel ?? '未选择'}</span>
          {!readOnly && <Pencil size={12} className="fd-branch-route-hint__icon" />}
        </button>
      )}
      {banner && (
        <div className={banner.className}>
          {banner.text}
        </div>
      )}
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
      </div>
      )}

      <div className="fd-branch-box">
        {branches.map((branch, index) => (
          <div key={branch.id} className={`fd-branch-col${dimmedBranchIds?.has(branch.id) ? ' fd-branch-col--dimmed' : ''}`}>
            <div className="fd-branch-col-top-line" />

            <button
              className={`fd-branch-title${onSimulationBranchClick ? ' fd-branch-title--sim-interactive' : ''}${selectedSimulationBranchId === branch.id ? ' fd-branch-title--sim-selected' : ''}`}
              type="button"
              onClick={onSimulationBranchClick
                ? () => onSimulationBranchClick(branch, node)
                : readOnly || branchType === 'parallelBranch'
                  ? undefined
                  : () => onEditBranch(branch, node.id)}
              tabIndex={(readOnly || branchType === 'parallelBranch') && !onSimulationBranchClick ? -1 : 0}
              title={onSimulationBranchClick ? '点击查看该分支条件命中原因' : undefined}
            >
              <div className="fd-branch-title__header">
                <span className={getBranchNameClass(branchType, branch.isDefault)}>
                  {branch.name}
                </span>
                {branch.priority != null && (
                  <span className="fd-branch-title__priority">
                    优先级{branch.priority}
                  </span>
                )}
                {showReorder && !branch.isDefault && nonDefaultCount > 1 && (
                  <span className="fd-branch-move" role="none" onClick={(e) => e.stopPropagation()}>
                    <span
                      className={`fd-branch-move__btn ${index === 0 ? 'fd-branch-move__btn--disabled' : ''}`}
                      role="none"
                      title="上移（提高优先级）"
                      onClick={index === 0 ? undefined : () => onMoveBranch?.(node.id, branch.id, 'up')}
                    >
                      <ChevronUp size={12} />
                    </span>
                    <span
                      className={`fd-branch-move__btn ${index >= nonDefaultCount - 1 ? 'fd-branch-move__btn--disabled' : ''}`}
                      role="none"
                      title="下移（降低优先级）"
                      onClick={index >= nonDefaultCount - 1 ? undefined : () => onMoveBranch?.(node.id, branch.id, 'down')}
                    >
                      <ChevronDown size={12} />
                    </span>
                  </span>
                )}
              </div>
              {getBranchDesc(branch, branchType) && (
                <div className="fd-branch-title__desc">
                  {getBranchDesc(branch, branchType)}
                </div>
              )}

              {!readOnly && !branch.isDefault && (
                <Popconfirm
                  title={branches.length > 2 ? `确认删除${branch.name}？` : '确认删除整个分支节点？'}
                  content={branches.length > 2 ? undefined : '所有分支及其内部节点将被一并删除'}
                  position="top"
                  onConfirm={() => handleBranchClose(branch.id)}
                >
                  <span
                    className="fd-branch-title__close"
                    role="none"
                    onClick={(e) => e.stopPropagation()}
                    title={branches.length > 2 ? `删除${branch.name}` : '删除整个分支节点'}
                  >
                    <X size={10} />
                  </span>
                </Popconfirm>
              )}
            </button>

            {!readOnly && (
              <AddNodeButton
                onAdd={(type) => onAddNodeInBranch(node.id, branch.id, type)}
              />
            )}
            {readOnly && <AddNodeButton onAdd={() => { /* noop */ }} readOnly />}

            {renderChildren(branch.children, `branch-${branch.id}-${index}`)}

            <div className="fd-branch-col-bottom-line" />
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
