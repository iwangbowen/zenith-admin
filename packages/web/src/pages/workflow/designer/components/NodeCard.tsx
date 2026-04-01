/**
 * 通用节点卡片 — 审批人 / 办理人 / 抄送 / 延迟器 / 触发器 / 子流程
 *
 * Body 区域根据节点属性显示丰富的配置摘要
 */
import { ChevronRight, X } from 'lucide-react';
import type { FlowNode, AssigneeType, ApproveMethod, OperationPermission, FieldPermission } from '../types';
import { NODE_COLOR_MAP, ADDABLE_NODE_TYPES, ASSIGNEE_TYPE_OPTIONS, APPROVE_METHOD_OPTIONS } from '../constants';

interface NodeCardProps {
  node: FlowNode;
  onEdit: (node: FlowNode) => void;
  onDelete: (nodeId: string) => void;
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
      if (assigneeType === 'user') {
        const names = p.assigneeNames as string[] | undefined;
        return names?.length ? names.join('、') : '请选择抄送人';
      }
      return ASSIGNEE_TYPE_OPTIONS.find(o => o.value === assigneeType)?.label ?? '请设置';
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
      const isAsync = p.isAsync as boolean | undefined;
      const parts: string[] = [];
      const idStr = typeof p.subProcessId === 'number' ? String(p.subProcessId) : '';
      parts.push(subName ?? `流程#${idStr}`);
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
    const ops = p.operations as OperationPermission[] | undefined;
    if (ops && !ops.includes('reject')) tags.push('不可拒绝');
    if (ops?.includes('transfer')) tags.push('可转办');
    if (ops?.includes('addSign')) tags.push('可加签');

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

export default function NodeCard({ node, onEdit, onDelete }: Readonly<NodeCardProps>) {
  const info = getNodeInfo(node.type);
  const color = NODE_COLOR_MAP[node.type] ?? '#999';
  const Icon = info?.icon;

  const bodyText = getBodySummary(node);
  const tags = getNodeTags(node);

  return (
    <button
      type="button"
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
          <span
            role="none"
            className="fd-node-card__delete-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
            title="删除"
          >
            <X size={12} />
          </span>
        </span>
      </div>

      {/* 内容区 */}
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
    </button>
  );
}
