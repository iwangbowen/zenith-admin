// ─── 业务接入示例：请假 ───────────────────────────────────────────────────────
export const BIZ_LEAVE_TYPES = ['annual', 'sick', 'personal', 'marriage', 'other'] as const;
export type BizLeaveType = (typeof BIZ_LEAVE_TYPES)[number];

export const BIZ_LEAVE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'cancelled'] as const;
export type BizLeaveStatus = (typeof BIZ_LEAVE_STATUSES)[number];

// ─── 业务接入示例：支付接入 ───────────────────────────────────────────────────
export const BIZ_PAY_DEMO_STATUSES = ['pending', 'paying', 'paid', 'closed'] as const;
export type BizPayDemoStatus = (typeof BIZ_PAY_DEMO_STATUSES)[number];