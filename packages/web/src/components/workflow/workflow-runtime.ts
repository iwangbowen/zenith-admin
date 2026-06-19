/**
 * 流程实例运行态聚合工具 —— 由 tasks 计算每个节点的状态与处理人。
 * 供「流程图」「节点列表」共用。
 */
import type { WorkflowTask } from '@zenith/shared';
import type { NodeRuntimeInfo } from '@/pages/workflow/designer/types';

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
