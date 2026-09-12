import { createLabelOptions } from '../core/enum-options';

// ─── 业务接入示例：请假 ───────────────────────────────────────────────────────
export const BIZ_LEAVE_TYPES = ['annual', 'sick', 'personal', 'marriage', 'other'] as const;
export type BizLeaveType = (typeof BIZ_LEAVE_TYPES)[number];

export const BIZ_LEAVE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'cancelled'] as const;
export type BizLeaveStatus = (typeof BIZ_LEAVE_STATUSES)[number];

export const BIZ_LEAVE_STATUS_LABELS: Record<BizLeaveStatus, string> = {
  draft: '草稿',
  pending: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
};

export const BIZ_LEAVE_STATUS_OPTIONS: Array<{ value: BizLeaveStatus; label: string }> =
  createLabelOptions(BIZ_LEAVE_STATUSES, BIZ_LEAVE_STATUS_LABELS);

// ─── 业务接入示例：支付接入 ───────────────────────────────────────────────────
export const BIZ_PAY_DEMO_STATUSES = ['pending', 'paying', 'paid', 'closed'] as const;
export type BizPayDemoStatus = (typeof BIZ_PAY_DEMO_STATUSES)[number];

export const BIZ_PAY_DEMO_STATUS_LABELS: Record<BizPayDemoStatus, string> = {
  pending: '待支付',
  paying: '支付中',
  paid: '已支付',
  closed: '已关闭',
};

export const BIZ_PAY_DEMO_STATUS_OPTIONS: Array<{ value: BizPayDemoStatus; label: string }> =
  createLabelOptions(BIZ_PAY_DEMO_STATUSES, BIZ_PAY_DEMO_STATUS_LABELS);