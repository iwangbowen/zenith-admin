/**
 * 流程实例运行态聚合工具 —— 由 tasks 计算每个节点的状态与处理人。
 * 供「流程图」「节点列表」共用。
 */
import type { WorkflowTask } from '@zenith/shared';
import { WORKFLOW_INSTANCE_STATUS_LABELS, WORKFLOW_TASK_STATUS_LABELS } from '@zenith/shared';
import type { FlowNode, FlowProcess, NodeRuntimeInfo } from '@/pages/workflow/designer/types';

/** 线性化后的审批节点简要信息（用于展示流程全部节点，含未到达节点） */
export interface FlowNodeBrief {
  key: string;
  name: string;
  type: string;
}

const APPROVAL_NODE_TYPES = new Set(['approver', 'handler', 'cc']);

/** 流程实例状态标签颜色（Semi Tag color 子集） */
export type InstanceStatusTagColor = 'amber' | 'blue' | 'green' | 'grey' | 'orange' | 'purple' | 'red';

/** 流程实例状态 → 标签文案与颜色（我的申请 / 我处理的 / 抄送我的 / 流程监控 / 移动审批共用；文案统一来自 @zenith/shared） */
export const INSTANCE_STATUS_MAP: Record<string, { text: string; color: InstanceStatusTagColor }> = {
  draft: { text: WORKFLOW_INSTANCE_STATUS_LABELS.draft, color: 'grey' },
  running: { text: WORKFLOW_INSTANCE_STATUS_LABELS.running, color: 'blue' },
  suspended: { text: WORKFLOW_INSTANCE_STATUS_LABELS.suspended, color: 'amber' },
  approved: { text: WORKFLOW_INSTANCE_STATUS_LABELS.approved, color: 'green' },
  rejected: { text: WORKFLOW_INSTANCE_STATUS_LABELS.rejected, color: 'red' },
  withdrawn: { text: WORKFLOW_INSTANCE_STATUS_LABELS.withdrawn, color: 'orange' },
  cancelled: { text: WORKFLOW_INSTANCE_STATUS_LABELS.cancelled, color: 'purple' },
};

/** 审批任务状态 → 标签文案与颜色（审批时间线 / 我的申请等任务级展示共用） */
export const TASK_STATUS_MAP: Record<string, { text: string; color: InstanceStatusTagColor }> = {
  pending: { text: WORKFLOW_TASK_STATUS_LABELS.pending, color: 'blue' },
  approved: { text: WORKFLOW_TASK_STATUS_LABELS.approved, color: 'green' },
  rejected: { text: WORKFLOW_TASK_STATUS_LABELS.rejected, color: 'red' },
  skipped: { text: WORKFLOW_TASK_STATUS_LABELS.skipped, color: 'grey' },
  waiting: { text: WORKFLOW_TASK_STATUS_LABELS.waiting, color: 'grey' },
};

/**
 * 线性化流程中的审批相关节点（approve / handler / cc），按流转顺序返回（含尚未到达的后续节点）。
 * 用于审批时间线展示完整链路，而非只展示已创建任务对应的节点。
 */
export function linearizeApprovalNodes(
  flowData: { process?: unknown } | null | undefined,
): FlowNodeBrief[] {
  const process = flowData?.process as FlowProcess | undefined;
  if (!process?.initiator) return [];
  const out: FlowNodeBrief[] = [];
  const visit = (node: FlowNode | undefined) => {
    if (!node) return;
    if (APPROVAL_NODE_TYPES.has(node.type)) {
      out.push({ key: node.key ?? node.id, name: node.name || node.key || node.id, type: node.type });
    }
    node.branches?.forEach((b) => visit(b.children));
    visit(node.children);
  };
  visit(process.initiator.children);
  return out;
}

/** 按 nodeKey 聚合 tasks → 节点运行态（状态 + 处理人列表） */
export function buildNodeRuntimeMap(tasks: WorkflowTask[]): Map<string, NodeRuntimeInfo> {
  const byNode = new Map<string, WorkflowTask[]>();
  for (const t of tasks) {
    const arr = byNode.get(t.nodeKey) ?? [];
    arr.push(t);
    byNode.set(t.nodeKey, arr);
  }
  const map = new Map<string, NodeRuntimeInfo>();
  for (const [nodeKey, group] of byNode) {
    const sorted = [...group].sort((a, b) => a.id - b.id);
    const approvers = sorted.map(t => ({
      name: t.assigneeName ?? '未指定',
      avatar: t.assigneeAvatar,
      status: t.status,
      actionAt: t.actionAt,
      comment: t.comment,
    }));
    let status: NodeRuntimeInfo['status'] = 'skipped';
    if (sorted.some(t => t.status === 'rejected')) status = 'rejected';
    else if (sorted.some(t => t.status === 'pending')) status = 'pending';
    else if (sorted.some(t => t.status === 'waiting')) status = 'waiting';
    else if (sorted.some(t => t.status === 'approved')) status = 'approved';
    map.set(nodeKey, { status, approvers });
  }
  return map;
}

/** 节点级状态文案 */
export const NODE_RT_STATUS_LABEL: Record<NodeRuntimeInfo['status'], string> = {
  approved: '已通过',
  rejected: '已驳回',
  pending: '审批中',
  waiting: '待审批',
  skipped: '已跳过',
};

/** 节点级状态 → Semi Tag 颜色 */
export const NODE_RT_STATUS_COLOR: Record<NodeRuntimeInfo['status'], 'green' | 'red' | 'blue' | 'grey'> = {
  approved: 'green',
  rejected: 'red',
  pending: 'blue',
  waiting: 'grey',
  skipped: 'grey',
};

const APPROVER_ACTION_LABEL: Record<NodeRuntimeInfo['status'], string> = {
  approved: '已同意',
  rejected: '已拒绝',
  pending: '审批中',
  waiting: '待审批',
  skipped: '已跳过',
};

/** 单处理人动作文案（抄送语义不同） */
export function approverActionLabel(status: NodeRuntimeInfo['status'], isCc = false): string {
  if (isCc) return status === 'approved' ? '已抄送' : '待抄送';
  return APPROVER_ACTION_LABEL[status] ?? '';
}
