import { resolveWorkflowActionButton } from './action-buttons';
import type { WorkflowActionButtonConfig, WorkflowActionButtonKey, WorkflowNodeConfig } from './types';

/** Read projections and write guards share the same base-seat predicate. */
export function isWorkflowBaseApprovalTask(task: { taskKind: string; slotId: number | null }, slot?: { id: number; origin: string; currentTaskId: number | null; status: string }, taskId?: number): boolean {
  return task.taskKind === 'approval' && task.slotId != null && slot?.id === task.slotId
    && slot.origin === 'base' && slot.status === 'pending' && (taskId === undefined || slot.currentTaskId === taskId);
}

export function workflowApprovalRequirements(node: Pick<WorkflowNodeConfig, 'actionButtons' | 'operations' | 'signaturePolicy'> | null | undefined, individual = false) {
  const approve = resolveWorkflowActionButton(node?.actionButtons as Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>>, 'approve');
  const signaturePolicy = node?.signaturePolicy ?? 'none';
  const opinionRequired = node?.operations?.includes('opinionRequired') ?? false;
  const canBatchApprove = approve.enabled && !individual && signaturePolicy !== 'handwritten' && approve.uploadMode !== 'required';
  return { opinionRequired, signaturePolicy, attachmentMode: approve.uploadMode ?? 'hidden', canBatchApprove, canQuickApprove: canBatchApprove && signaturePolicy === 'none' && !opinionRequired };
}
