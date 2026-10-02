import type { WorkflowNodeActivation, WorkflowApprovalSlot } from './contracts/approval-state';
import type { WORKFLOW_TASK_WAIT_REASONS } from './constants';

export type WorkflowApprovalWaitReason = (typeof WORKFLOW_TASK_WAIT_REASONS)[number];

/** 纯评估器：只处理正式席位，不读取任务事实、意见文字或历史轮。Server 与 Demo 共用。 */
export function evaluateWorkflowApprovalActivation(input: WorkflowNodeActivation): {
  activation: WorkflowNodeActivation;
  waitReasons: Record<number, WorkflowApprovalWaitReason | null>;
  completed: boolean;
  failed: boolean;
} {
  const slots = input.slots.map((slot) => ({ ...slot }));
  const groups = input.signGroups.map((group) => ({ ...group, slots: [] as WorkflowApprovalSlot[] }));
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  for (const slot of slots) {
    if (slot.origin === 'base') slot.mandatory = groups.some((group) => group.anchorSlotId === slot.id && group.position !== 'parallel' && group.status !== 'cancelled');
  }
  for (const group of groups) {
    group.slots = slots.filter((slot) => slot.groupId === group.id);
    if (group.status === 'cancelled') continue;
    const members = group.slots.filter((slot) => slot.status !== 'cancelled');
    const anchor = byId.get(group.anchorSlotId);
    if (!anchor || anchor.origin !== 'base') throw new Error('加签组必须锚定本轮基础席位');
    if (members.length === 0) group.status = 'cancelled';
    else if (group.position === 'after' && anchor.status === 'rejected') group.status = 'rejected';
    else if (group.position === 'after' && anchor.status !== 'approved') group.status = 'waiting';
    else if (group.signMode === 'and') {
      group.status = members.some((slot) => slot.status === 'rejected') ? 'rejected'
        : members.every((slot) => slot.status === 'approved') ? 'approved' : 'active';
    } else {
      group.status = members.some((slot) => slot.status === 'approved') ? 'approved'
        : members.every((slot) => slot.status === 'rejected') ? 'rejected' : 'active';
      if (group.status === 'approved') for (const member of members) if (member.status === 'pending') member.status = 'cancelled';
    }
  }
  // 全减解除附加强制。已通过的前签仍要求锚定人给出正式意见。
  for (const slot of slots) if (slot.origin === 'base') {
    slot.mandatory = groups.some((group) => group.anchorSlotId === slot.id && group.position !== 'parallel' && group.status !== 'cancelled');
  }
  const base = slots.filter((slot) => slot.origin === 'base');
  const baseApproved = base.filter((slot) => slot.status === 'approved').length;
  const baseRejected = base.filter((slot) => slot.status === 'rejected').length;
  const baseSatisfied = baseApproved >= input.baseRequired;
  const failed = groups.some((group) => group.status === 'rejected')
    || base.some((slot) => slot.mandatory && slot.status === 'rejected')
    || (input.approveMethod === 'ratio'
      ? baseApproved + base.filter((slot) => slot.status === 'pending').length < input.baseRequired
      : baseRejected > 0);
  // 达基础阈值只取消无关候选；补充组及前/后锚定席位不能被吞掉。
  if (baseSatisfied && !failed) for (const slot of base) {
    if (slot.status === 'pending' && !slot.mandatory) slot.status = 'cancelled';
  }
  const completed = !failed && baseSatisfied
    && base.every((slot) => !slot.mandatory || slot.status === 'approved')
    && groups.every((group) => group.status === 'approved' || group.status === 'cancelled');
  const waitReasons: Record<number, WorkflowApprovalWaitReason | null> = {};
  const nextSequential = base.filter((slot) => slot.status === 'pending').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const sequentialAfterBarrier = nextSequential != null && base.some((slot) => (slot.order ?? 0) < (nextSequential.order ?? 0)
    && groups.some((group) => group.anchorSlotId === slot.id && group.position === 'after' && group.status !== 'approved' && group.status !== 'cancelled'));
  for (const slot of slots) {
    let reason: WorkflowApprovalWaitReason | null = null;
    if (slot.status === 'pending') {
      if (slot.origin === 'addSign') {
        const group = groups.find((entry) => entry.id === slot.groupId);
        if (!group) throw new Error('加签席位缺少所属组');
        if (group.status === 'waiting') reason = 'afterSign';
      } else if (groups.some((group) => group.anchorSlotId === slot.id && group.position === 'before' && group.status !== 'approved' && group.status !== 'cancelled')) reason = 'beforeSign';
      else if (input.approveMethod === 'sequential' && (slot.id !== nextSequential?.id || sequentialAfterBarrier)) reason = 'sequence';
    }
    waitReasons[slot.id] = reason;
  }
  return {
    activation: { ...input, slots, signGroups: groups, baseApproved, baseRejected, baseSatisfied,
      status: failed ? 'rejected' : completed ? 'approved' : input.status },
    waitReasons, completed, failed,
  };
}
