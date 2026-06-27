/**
 * 通用节点卡片 — 审批人 / 办理人 / 抄送 / 延迟器 / 触发器 / 子流程
 *
 * Body 区域根据节点属性显示丰富的配置摘要
 */
import { ChevronRight, Copy, X } from 'lucide-react';
import { Popconfirm, Tooltip } from '@douyinfe/semi-ui';
import type { FlowNode, AssigneeType, ApproveMethod, ApprovalType, OperationPermission, FieldPermission, NodeRuntimeInfo } from '../types';
import { NODE_COLOR_MAP, ADDABLE_NODE_TYPES, ASSIGNEE_TYPE_OPTIONS, APPROVE_METHOD_OPTIONS, APPROVAL_TYPE_OPTIONS } from '../constants';
import { UserAvatar } from '@/components/UserAvatar';
import { formatDateTime } from '@/utils/date';

interface NodeCardProps {
  node: FlowNode;
  onEdit: (node: FlowNode) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  readOnly?: boolean;
  /** 只读但允许点击查看（点击打开只读配置抽屉，用于只读设计器） */
  readOnlyInteractive?: boolean;
  /** 仿真图交互：点击节点跳转到该节点步骤 */
  onSimulationNodeClick?: (node: FlowNode) => void;
  /** 仿真图交互：右键节点切换断点 */
  onSimulationNodeContextMenu?: (node: FlowNode) => void;
  simulationBreakpoint?: boolean;
  /** 运行态信息（实例详情流程图叠加：实际处理人 + 状态 + 时间）；设计态为空 */
  runtime?: NodeRuntimeInfo;
}

/** 节点级运行态标签 */
const RT_NODE_STATUS: Record<NodeRuntimeInfo['status'], { label: string }> = {
  approved: { label: '已通过' },
  rejected: { label: '已驳回' },
  pending: { label: '审批中' },
  waiting: { label: '待审批' },
  skipped: { label: '已跳过' },
};

/** 单处理人状态文案（抄送节点语义不同） */
function approverStatusLabel(nodeType: FlowNode['type'], status: NodeRuntimeInfo['status']): string {
  if (nodeType === 'cc') return status === 'approved' ? '已抄送' : '待抄送';
  switch (status) {
    case 'approved': return '已同意';
    case 'rejected': return '已拒绝';
    case 'pending': return '审批中';
    case 'waiting': return '待审批';
    case 'skipped': return '已跳过';
    default: return '';
  }
}

function getNodeInfo(type: FlowNode['type']) {
  return ADDABLE_NODE_TYPES.find(n => n.type === type);
}

/** 生成节点 Body 摘要文本 */
function getBodySummary(node: FlowNode): string {
  const p = node.props;

  switch (node.type) {
    case 'approver':
    case 'handler': {
      const approvalType = p.approvalType as ApprovalType | undefined;
      // 自动通过/自动拒绝时显示类型而非审批人
      if (node.type === 'approver' && approvalType && approvalType !== 'manual') {
        return APPROVAL_TYPE_OPTIONS.find(o => o.value === approvalType)?.label ?? '';
      }

      const assigneeType = p.assigneeType as AssigneeType | undefined;
      if (!assigneeType) return '请设置';

      const typeLabel = ASSIGNEE_TYPE_OPTIONS.find(o => o.value === assigneeType)?.label ?? '';
      const parts: string[] = [];

      if (assigneeType === 'user') {
        const names = p.assigneeNames as string[] | undefined;
        parts.push(names?.length ? names.join('、') : '请选择成员');
      } else if (assigneeType === 'role') {
        const names = p.roleNames as string[] | undefined;
        parts.push(names?.length ? names.join('、') : '请选择角色');
      } else if (assigneeType === 'manager') {
        const level = p.managerLevel as number | undefined;
        parts.push(`${level ?? 1}级主管`);
      } else {
        parts.push(typeLabel);
      }

      if (node.type === 'approver') {
        const method = p.approveMethod as ApproveMethod | undefined;
        const methodLabel = APPROVE_METHOD_OPTIONS.find(o => o.value === (method ?? 'or'))?.label;
        if (methodLabel) parts.push(methodLabel);
      }

      return parts.join(' · ');
    }

    case 'cc': {
      const assigneeType = p.assigneeType as AssigneeType | undefined;
      if (!assigneeType) return '请设置抄送人';
      const parts: string[] = [];
      if (assigneeType === 'user') {
        const names = p.assigneeNames as string[] | undefined;
        parts.push(names?.length ? names.join('、') : '请选择抄送人');
      } else {
        parts.push(ASSIGNEE_TYPE_OPTIONS.find(o => o.value === assigneeType)?.label ?? '请设置');
      }
      if (p.onlyOnApprove) parts.push('仅同意时抄送');
      return parts.join(' · ');
    }

    case 'delay': {
      const delayType = p.delayType as string | undefined;
      if (delayType === 'toDate') return '到指定日期';
      const v = p.delayValue as number | undefined;
      const unitMap: Record<string, string> = { minute: '分钟', hour: '小时', day: '天' };
      const u = unitMap[(p.delayUnit as string) ?? 'hour'] ?? '小时';
      return v ? `等待 ${v} ${u}` : '请设置延迟时间';
    }

    case 'trigger': {
      const triggerType = p.triggerType as string | undefined;
      const typeMap: Record<string, string> = {
        webhook: 'HTTP 请求',
        callback: 'HTTP 回调',
        updateData: '更新数据',
        deleteData: '删除数据',
      };
      return typeMap[triggerType ?? ''] ?? '请设置触发器';
    }

    case 'subProcess': {
      const subName = p.subProcessName as string | undefined;
      const isAsync = (p.isAsync as boolean | undefined) || p.subProcessWaitChild === false;
      const parts: string[] = [];
      const idStr = typeof p.subProcessId === 'number' ? String(p.subProcessId) : '';
      parts.push(subName ?? `流程#${idStr}`);
      if (p.subProcessMode === 'multi') {
        parts.push(p.subProcessMultiExecution === 'serial' ? '多实例·串行' : '多实例·并行');
      }
      if (isAsync) parts.push('异步');
      return parts.join(' · ') || '请选择子流程';
    }

    default:
      return p.description as string || '请设置';
  }
}

/** 生成附加的标签信息 */
function getNodeTags(node: FlowNode): string[] {
  const tags: string[] = [];
  const p = node.props;

  if (node.type === 'approver') {
    const approvalType = p.approvalType as ApprovalType | undefined;
    if (approvalType && approvalType !== 'manual') {
      tags.push(approvalType === 'autoApprove' ? '自动通过' : '自动拒绝');
    }

    const ops = p.operations as OperationPermission[] | undefined;
    if (ops && !ops.includes('reject')) tags.push('不可拒绝');

    const fp = p.fieldPermissions as Record<string, FieldPermission> | undefined;
    if (fp) {
      const editCount = Object.values(fp).filter(v => v === 'edit').length;
      if (editCount > 0) tags.push(`${editCount}字段可编辑`);
    }

    const timeout = p.timeout as { enabled?: boolean } | undefined;
    if (timeout?.enabled) tags.push('超时处理');
  }

  return tags;
}

export default function NodeCard({
  node,
  onEdit,
  onDelete,
  onDuplicate,
  readOnly = false,
  readOnlyInteractive = false,
  onSimulationNodeClick,
  onSimulationNodeContextMenu,
  simulationBreakpoint = false,
  runtime,
}: Readonly<NodeCardProps>) {
  const info = getNodeInfo(node.type);
  const color = NODE_COLOR_MAP[node.type] ?? '#999';
  const Icon = info?.icon;

  const bodyText = getBodySummary(node);
  const tags = getNodeTags(node);
  const simulationInteractive = !!onSimulationNodeClick || !!onSimulationNodeContextMenu;
  const clickable = !readOnly || readOnlyInteractive || simulationInteractive;
  const handleClick = () => {
    if (onSimulationNodeClick) {
      onSimulationNodeClick(node);
      return;
    }
    if (!readOnly || readOnlyInteractive) onEdit(node);
  };

  return (
    <button
      type="button"
      className={`fd-node-card${runtime ? ` fd-node-card--rt fd-node-card--rt-${runtime.status}` : ''}${runtime?.active ? ' fd-node-card--rt-active' : ''}${simulationInteractive ? ' fd-node-card--sim-interactive' : ''}${simulationBreakpoint ? ' fd-node-card--sim-breakpoint' : ''}`}
      data-fd-node-id={node.id}
      data-fd-node-key={node.key ?? node.id}
      onClick={clickable ? handleClick : undefined}
      onContextMenu={onSimulationNodeContextMenu ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSimulationNodeContextMenu(node);
      } : undefined}
      tabIndex={clickable ? 0 : -1}
      title={simulationInteractive ? '点击跳转到仿真步骤；右键切换断点' : undefined}
    >
      {/* 标题栏 */}
      <div className="fd-node-card__header" style={{ background: color }}>
        {Icon && (
          <span className="fd-node-card__header-icon">
            <Icon size={14} />
          </span>
        )}
        <span className="fd-node-card__header-title">{node.name || info?.label || '节点'}</span>
        {runtime && (
          <span className={`fd-node-card__rt-badge fd-node-card__rt-badge--${runtime.status}`}>
            {RT_NODE_STATUS[runtime.status]?.label}
          </span>
        )}
        {!readOnly && (
        <span className="fd-node-card__header-actions">
          {onDuplicate && (
            <Tooltip content="复制节点">
              <span
                role="none"
                className="fd-node-card__delete-btn"
                onClick={(e) => { e.stopPropagation(); onDuplicate(node.id); }}
              >
                <Copy size={12} />
              </span>
            </Tooltip>
          )}
          <Popconfirm
            title="确认删除此节点？"
            content="节点上的配置将一并被删除"
            position="top"
            onConfirm={() => onDelete(node.id)}
          >
            <span
              role="none"
              className="fd-node-card__delete-btn"
              onClick={(e) => e.stopPropagation()}
              title="删除"
            >
              <X size={12} />
            </span>
          </Popconfirm>
        </span>
        )}
      </div>

      {/* 内容区 */}
      {runtime ? (
        <div className="fd-node-card__body fd-node-card__body--rt">
          <div className="fd-node-card__rt-summary">
            {typeof runtime.step === 'number' && typeof runtime.totalSteps === 'number' && (
              <span>第 {runtime.step} / {runtime.totalSteps} 步</span>
            )}
            {(runtime.active || runtime.statusLabel) && <span>{runtime.active ? '当前步骤' : runtime.statusLabel}</span>}
          </div>
          {runtime.approvers.length === 0 ? (
            <span className="fd-node-card__body-text">{bodyText}</span>
          ) : (
            <div className="fd-node-card__rt-list">
              {runtime.approvers.map((a, i) => (
                <div className="fd-node-card__rt-row" key={`${a.name}-${i}`}>
                  <UserAvatar
                    name={a.name || '?'}
                    avatar={a.status === 'skipped' ? null : a.avatar}
                    semiSize="extra-extra-small"
                    size={18}
                  />
                  <div className="fd-node-card__rt-info">
                    <div className="fd-node-card__rt-line">
                      <span className="fd-node-card__rt-name" title={a.name}>{a.name || '未指定'}</span>
                      {(runtime.approvers.length > 1 || node.type === 'cc') && (
                        <span className={`fd-node-card__rt-status fd-node-card__rt-status--${a.status}`}>
                          {approverStatusLabel(node.type, a.status)}
                        </span>
                      )}
                    </div>
                    {a.actionAt && (
                      <span className="fd-node-card__rt-time">{formatDateTime(a.actionAt)}</span>
                    )}
                    {a.comment && (
                      <span className="fd-node-card__rt-comment" title={a.comment}>{a.comment}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(runtime.detail || runtime.reason) && (
            <div className="fd-node-card__rt-note" title={runtime.detail ?? runtime.reason ?? undefined}>
              {runtime.detail ?? runtime.reason}
            </div>
          )}
          {runtime.nextNodeNames && runtime.nextNodeNames.length > 0 && (
            <div className="fd-node-card__rt-next" title={runtime.nextNodeNames.join('、')}>
              下一步：{runtime.nextNodeNames.join('、')}
            </div>
          )}
        </div>
      ) : (
        <div className="fd-node-card__body">
          <div className="fd-node-card__body-content">
            <span className="fd-node-card__body-text">{bodyText}</span>
            {tags.length > 0 && (
              <div className="fd-node-card__body-tags">
                {tags.map(tag => (
                  <span key={tag} className="fd-node-card__tag">{tag}</span>
                ))}
              </div>
            )}
          </div>
          <ChevronRight size={16} className="fd-node-card__body-arrow" />
        </div>
      )}
    </button>
  );
}
