/**
 * 权限治理枚举：独立成模块，避免随 `./constants` 进入会员端关键路径。
 *
 * `@zenith/shared/member` 的 contracts/members.ts 会运行时引用 `./constants` 的 LOGIN_STATUSES，
 * 该模块被整体保留；治理枚举若与其同模块，就会一并进入 member 入口的关键路径。
 */
export const ACCESS_REQUEST_BIZ_TYPE = 'identity.access_request' as const;

export const ACCESS_RISK_LEVELS = ['low', 'high', 'critical'] as const;
export type AccessRiskLevel = (typeof ACCESS_RISK_LEVELS)[number];

export const ACCESS_APPROVAL_POLICIES = ['none', 'manager', 'manager_security', 'two_person'] as const;
export type AccessApprovalPolicy = (typeof ACCESS_APPROVAL_POLICIES)[number];

export const ACCESS_APPROVAL_POLICY_LABELS: Record<AccessApprovalPolicy, string> = {
  none: '策略自动批准', manager: '部门负责人', manager_security: '部门负责人 + 安全审批', two_person: '部门负责人 + 两名独立安全审批',
};
export const ACCESS_APPROVAL_NODE_KEYS = ['approve_manager', 'approve_security_manager', 'approve_security', 'approve_second_manager', 'approve_first_security', 'approve_second_security'] as const;
export type AccessApprovalNodeKey = (typeof ACCESS_APPROVAL_NODE_KEYS)[number];
export const ACCESS_APPROVAL_STEPS: Record<AccessApprovalPolicy, ReadonlyArray<{ nodeKey: AccessApprovalNodeKey; kind: 'manager' | 'security'; label: string; userField: string }>> = {
  none: [],
  manager: [{ nodeKey: 'approve_manager', kind: 'manager', label: '部门负责人审批', userField: 'managerId' }],
  manager_security: [
    { nodeKey: 'approve_security_manager', kind: 'manager', label: '部门负责人审批', userField: 'managerId' },
    { nodeKey: 'approve_security', kind: 'security', label: '独立安全审批', userField: 'securityApproverId' },
  ],
  two_person: [
    { nodeKey: 'approve_second_manager', kind: 'manager', label: '部门负责人审批', userField: 'managerId' },
    { nodeKey: 'approve_first_security', kind: 'security', label: '第一独立安全审批', userField: 'securityApproverId' },
    { nodeKey: 'approve_second_security', kind: 'security', label: '第二独立安全审批', userField: 'secondSecurityApproverId' },
  ],
};
export const ACCESS_START_MODES = ['immediate', 'scheduled'] as const;
export const ACCESS_VALIDITY_MODES = ['limited', 'permanent'] as const;
export const ACCESS_VALIDITY_MODE_LABELS: Record<(typeof ACCESS_VALIDITY_MODES)[number], string> = { limited: '限时有效', permanent: '永久有效' };

export const ACCESS_REQUEST_TYPES = ['temporary', 'emergency'] as const;
export type AccessRequestType = (typeof ACCESS_REQUEST_TYPES)[number];

export const ACCESS_REQUEST_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'cancelled'] as const;
export const ACCESS_PROVISION_STATUSES = ['not_started', 'pending', 'running', 'succeeded', 'failed', 'terminated'] as const;
export type AccessProvisionStatus = (typeof ACCESS_PROVISION_STATUSES)[number];
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const ACCESS_REQUEST_ITEM_TYPES = ['role', 'permission'] as const;
export type AccessRequestItemType = (typeof ACCESS_REQUEST_ITEM_TYPES)[number];

export const ACCESS_GRANT_STATUSES = ['scheduled', 'active', 'expired', 'revoked'] as const;
export type AccessGrantStatus = (typeof ACCESS_GRANT_STATUSES)[number];

export const ACCESS_GRANT_SOURCES = ['request', 'emergency', 'admin'] as const;
export type AccessGrantSource = (typeof ACCESS_GRANT_SOURCES)[number];

export const ACCESS_REVIEW_SCOPE_TYPES = ['tenant', 'department', 'role', 'group', 'user', 'high_risk', 'temporary'] as const;
export type AccessReviewScopeType = (typeof ACCESS_REVIEW_SCOPE_TYPES)[number];

export const ACCESS_REVIEW_STATUSES = ['preparing', 'open', 'in_progress', 'completed', 'overdue', 'failed'] as const;
export type AccessReviewStatus = (typeof ACCESS_REVIEW_STATUSES)[number];

export const ACCESS_REVIEW_DECISIONS = ['pending', 'keep', 'revoke', 'extend', 'exception', 'escalate'] as const;
export type AccessReviewDecision = (typeof ACCESS_REVIEW_DECISIONS)[number];

export const ACCESS_REVIEW_SOURCE_TYPES = ['role', 'group_membership', 'direct_permission', 'temporary_grant'] as const;
export type AccessReviewSourceType = (typeof ACCESS_REVIEW_SOURCE_TYPES)[number];

export const ACCESS_RISK_LABELS: Record<AccessRiskLevel, string> = { low: '普通', high: '高危', critical: '极高危' };
export const ACCESS_REQUEST_TYPE_LABELS: Record<AccessRequestType, string> = { temporary: '常规授权', emergency: '紧急授权' };
export const ACCESS_START_MODE_LABELS: Record<(typeof ACCESS_START_MODES)[number], string> = { immediate: '审批通过后立即生效', scheduled: '预约生效' };
export const ACCESS_REQUEST_STATUS_LABELS: Record<AccessRequestStatus, string> = { draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', cancelled: '已取消' };
export const ACCESS_PROVISION_STATUS_LABELS: Record<AccessProvisionStatus, string> = { not_started: '未开始', pending: '等待发放', running: '正在发放', succeeded: '发放成功', failed: '发放失败', terminated: '已终止' };
export const ACCESS_GRANT_STATUS_LABELS: Record<AccessGrantStatus, string> = { scheduled: '待生效', active: '生效中', expired: '已过期', revoked: '已撤销' };
export const ACCESS_GRANT_SOURCE_LABELS: Record<AccessGrantSource, string> = { request: '授权申请', emergency: '紧急授权', admin: '管理员直授' };
export const ACCESS_REVIEW_SCOPE_LABELS: Record<AccessReviewScopeType, string> = { tenant: '当前租户全部用户', department: '指定部门及子部门', role: '指定角色', group: '指定用户组', user: '指定用户', high_risk: '高危权限', temporary: '临时授权' };
export const ACCESS_REVIEW_STATUS_LABELS: Record<AccessReviewStatus, string> = { preparing: '准备中', open: '待复核', in_progress: '复核中', completed: '已完成', overdue: '已逾期', failed: '准备失败' };
export const ACCESS_REVIEW_DECISION_LABELS: Record<AccessReviewDecision, string> = { pending: '待处理', keep: '保留', revoke: '撤销', extend: '延期', exception: '限时例外', escalate: '升级处理' };
export const ACCESS_REVIEW_SOURCE_LABELS: Record<AccessReviewSourceType, string> = { role: '角色绑定', group_membership: '用户组成员资格', direct_permission: '直接菜单权限', temporary_grant: '单项临时授权' };
export const ACCESS_REQUEST_ITEM_LABELS: Record<AccessRequestItemType, string> = { role: '角色', permission: '操作权限' };
