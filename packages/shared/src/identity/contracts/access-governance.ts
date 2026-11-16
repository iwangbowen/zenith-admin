import * as z from 'zod';
import { auditFieldsSchema, dateRangeQuery, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { workflowInstanceSchema } from '../../workflow/contracts/instances';
import { DATA_SCOPES } from '../constants';
import { ACCESS_PROVISION_STATUSES, ACCESS_APPROVAL_POLICIES, ACCESS_GRANT_STATUSES, ACCESS_REQUEST_ITEM_TYPES, ACCESS_REQUEST_STATUSES, ACCESS_REQUEST_TYPES, ACCESS_REVIEW_DECISIONS, ACCESS_REVIEW_SCOPE_TYPES, ACCESS_REVIEW_STATUSES, ACCESS_REVIEW_SOURCE_TYPES, ACCESS_RISK_LEVELS } from '../access-governance-constants';
import { accessSourceRefSchema, assignAccessReviewCampaignSchema, accessReviewHistorySchema, accessApprovalEvidenceSchema, accessApprovalPlanSchema, accessPolicySnapshotSchema, createAccessReviewCampaignSchema, decideAccessReviewItemSchema, revokeAccessGrantSchema, updatePermissionPolicySchema } from '../access-governance-validation';
import { accessWorkflowPreviewInputSchema } from '../access-governance-validation';

export const permissionPolicySchema = z.object({
  id: z.int(),
  permissionCode: z.string(),
  permissionLabel: z.string().nullable().optional(),
  version: z.int(),
  riskLevel: z.enum(ACCESS_RISK_LEVELS),
  approvalPolicy: z.enum(ACCESS_APPROVAL_POLICIES),
  maxDurationMinutes: z.int().nullable().optional(),
  reviewIntervalDays: z.int(),
  mfaRequired: z.boolean(),
  enabled: z.boolean(),
  permanentAllowed: z.boolean(), emergencyAllowed: z.boolean(), maxEmergencyMinutes: z.int(),
  tenantId: z.int().nullable().optional(),
  inherited: z.boolean(),
  minimumRiskLevel: z.enum(ACCESS_RISK_LEVELS),
  selfRequestable: z.boolean(),
  ...auditFieldsSchema,
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).meta({ id: 'IdentityPermissionPolicy' });

export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const accessRequestItemSchema = z.object({
  id: z.int(),
  itemType: z.enum(ACCESS_REQUEST_ITEM_TYPES),
  roleId: z.int().nullable().optional(),
  permissionCode: z.string(),
  permissionLabel: z.string().nullable().optional(),
  dataScope: z.enum(DATA_SCOPES).nullable().optional(),
  deptScopeIds: z.array(z.int()),
  scopeKey: z.string(), sourceRefs: z.array(accessSourceRefSchema),
  snapshot: z.record(z.string(), z.unknown()),
}).meta({ id: 'IdentityAccessRequestItem' });

export const accessRequestSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable().optional(),
  applicantUserId: z.int(),
  applicantName: z.string().nullable().optional(),
  targetUserId: z.int(),
  targetUserName: z.string().nullable().optional(),
  requestType: z.enum(ACCESS_REQUEST_TYPES),
  status: z.enum(ACCESS_REQUEST_STATUSES),
  provisionStatus: z.enum(ACCESS_PROVISION_STATUSES),
  reason: z.string(),
  startsAt: z.string(),
  expiresAt: z.string().nullable(),
  riskLevel: z.enum(ACCESS_RISK_LEVELS),
  workflowInstanceId: z.int().nullable().optional(),
  workflowTitle: z.string().nullable().optional(),
  workflowSerialNo: z.string().nullable().optional(),
  provisionTask: z.object({ id: z.int(), status: z.string(), attempts: z.int(), maxAttempts: z.int(), errorMessage: z.string().nullable() }).nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  appliedAt: z.string().nullable().optional(),
  failureReason: z.string().nullable().optional(),
  policySnapshot: z.array(accessPolicySnapshotSchema),
  approvalPlan: accessApprovalPlanSchema,
  approvalEvidence: z.array(accessApprovalEvidenceSchema),
  items: z.array(accessRequestItemSchema),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IdentityAccessRequest' });

export type AccessRequest = z.infer<typeof accessRequestSchema>;

export const accessGrantItemSchema = z.object({
  id: z.int(), scopeKey: z.string(), sourceRefs: z.array(accessSourceRefSchema), permissionCode: z.string(), permissionLabel: z.string().nullable(),
  status: z.enum(ACCESS_GRANT_STATUSES), dataScope: z.enum(DATA_SCOPES), deptScopeIds: z.array(z.int()),
  startsAt: z.string(), expiresAt: z.string().nullable(), nextReviewAt: z.string().nullable(),
  revokedAt: z.string().nullable(), revokedBy: z.int().nullable(), revokeReason: z.string().nullable(),
  policySnapshot: accessPolicySnapshotSchema,
}).meta({ id: 'IdentityAccessGrantItem' });
export type AccessGrantItem = z.infer<typeof accessGrantItemSchema>;

export const accessGrantSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable().optional(),
  userId: z.int(),
  userName: z.string().nullable().optional(),
  requestId: z.int().nullable().optional(),
  workflowInstanceId: z.int().nullable().optional(),
  sourceType: z.enum(['request', 'emergency', 'admin']),
  status: z.enum(ACCESS_GRANT_STATUSES),
  riskLevel: z.enum(ACCESS_RISK_LEVELS),
  startsAt: z.string(),
  expiresAt: z.string().nullable(),
  approvedBy: z.int().nullable().optional(),
  approvedByName: z.string().nullable().optional(),
  revokedBy: z.int().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
  revokeReason: z.string().nullable().optional(),
  items: z.array(accessGrantItemSchema),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IdentityAccessGrant' });

export type AccessGrant = z.infer<typeof accessGrantSchema>;

/** 实例提交内容与当前授权账本分离；审批通过不代表发放成功。 */
export const accessWorkflowResultSchema = z.object({
  request: accessRequestSchema,
  grant: accessGrantSchema.nullable(),
}).meta({ id: 'IdentityAccessWorkflowResult' });
export type AccessWorkflowResult = z.infer<typeof accessWorkflowResultSchema>;

export const accessReviewCampaignSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable().optional(),
  name: z.string(),
  scopeType: z.enum(ACCESS_REVIEW_SCOPE_TYPES),
  scopeIds: z.array(z.int()),
  reviewerId: z.int(),
  reviewerName: z.string().nullable().optional(),
  dueAt: z.string(),
  status: z.enum(ACCESS_REVIEW_STATUSES),
  failureReason: z.string().nullable(),
  itemCount: z.int().optional(),
  pendingCount: z.int().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IdentityAccessReviewCampaign' });

export type AccessReviewCampaign = z.infer<typeof accessReviewCampaignSchema>;

const accessPolicySummaryFields = { riskLevel: z.enum(ACCESS_RISK_LEVELS), approvalPolicy: z.enum(ACCESS_APPROVAL_POLICIES), maxDurationMinutes: z.int().positive().nullable(), mfaRequired: z.boolean(), permanentAllowed: z.boolean(), emergencyAllowed: z.boolean(), maxEmergencyMinutes: z.int() };
export const accessWorkflowOptionsSchema = z.object({
  roles: z.array(z.object({ id: z.int(), name: z.string(), code: z.string(), description: z.string().nullable().optional(), dataScope: z.enum(DATA_SCOPES), version: z.int(), permissionCount: z.int(), permissionCodes: z.array(z.string()), ...accessPolicySummaryFields })),
  menus: z.array(z.object({ id: z.int(), parentId: z.int(), title: z.string(), name: z.string().nullable().optional(), type: z.enum(['directory', 'menu', 'button']), permission: z.string().nullable().optional(), permissionLabel: z.string().nullable().optional(), requestable: z.boolean(), path: z.array(z.string()), ...accessPolicySummaryFields })),
}).meta({ id: 'IdentityAccessWorkflowOptions' });

export type AccessWorkflowOptions = z.infer<typeof accessWorkflowOptionsSchema>;

export const accessWorkflowPreviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('selection_required'), message: z.string() }),
  z.object({ status: z.literal('blocked'), message: z.string() }),
  z.object({ status: z.literal('ready'), fingerprint: z.string(), permissionCount: z.int(), grantItemCount: z.int(), approvalPlan: accessApprovalPlanSchema, policies: z.array(accessPolicySnapshotSchema) }),
]);
export type AccessWorkflowPreview = z.infer<typeof accessWorkflowPreviewSchema>;

export const accessReviewItemSchema = z.object({
  id: z.int(),
  campaignId: z.int(),
  reviewerId: z.int(), reviewerName: z.string().nullable().optional(), dueAt: z.string(),
  exceptionOwnerId: z.int().nullable(), exceptionUntil: z.string().nullable(), nextReviewAt: z.string().nullable(),
  history: z.array(accessReviewHistorySchema),
  tenantId: z.int().nullable().optional(),
  userId: z.int(),
  userName: z.string().nullable().optional(),
  sourceType: z.enum(ACCESS_REVIEW_SOURCE_TYPES),
  sourceId: z.int().nullable().optional(),
  sourceLabel: z.string().nullable().optional(),
  permissionCode: z.string().nullable().optional(),
  permissionLabel: z.string().nullable().optional(),
  riskLevel: z.enum(ACCESS_RISK_LEVELS),
  decision: z.enum(ACCESS_REVIEW_DECISIONS),
  decidedBy: z.int().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  snapshot: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
}).meta({ id: 'IdentityAccessReviewItem' });

export type AccessReviewItem = z.infer<typeof accessReviewItemSchema>;

const requestListQuery = paginationQuery.extend({
  keyword: keywordQuery('申请标题 / 业务编号 / 原因'),
  status: queryEnum(ACCESS_REQUEST_STATUSES, { description: '审批状态' }),
  provisionStatus: queryEnum(ACCESS_PROVISION_STATUSES, { description: '发放状态' }),
  riskLevel: queryEnum(ACCESS_RISK_LEVELS, { description: '风险等级' }),
  targetUserId: idQuery('目标用户'),
  ...dateRangeQuery('申请时间'),
});

const grantListQuery = paginationQuery.extend({
  keyword: keywordQuery('权限码 / 用户'),
  status: queryEnum(ACCESS_GRANT_STATUSES, { description: '授权状态' }),
  riskLevel: queryEnum(ACCESS_RISK_LEVELS, { description: '风险等级' }),
  userId: idQuery('用户'),
});

const reviewListQuery = paginationQuery.extend({
  campaignId: idQuery('复核批次'),
  reviewerId: idQuery('复核负责人'),
  decision: queryEnum(ACCESS_REVIEW_DECISIONS, { description: '复核结果' }),
  riskLevel: queryEnum(ACCESS_RISK_LEVELS, { description: '风险等级' }),
  sourceType: queryEnum(ACCESS_REVIEW_SOURCE_TYPES, { description: '授权来源' }),
  userId: idQuery('用户'),
});

export const accessGovernanceContract = defineContract('/api/access-governance', {
  requestWorkflow: op.get('/requests/{id}/workflow', { access: { permission: 'system:access-governance:view' }, params: idParam, response: workflowInstanceSchema, summary: '治理人员只读查看精确关联的申请流程' }),
  workflowResult: op.get('/workflow/{id}/result', { access: 'authenticated', params: idParam, response: accessWorkflowResultSchema, summary: '按流程参与关系查看权限申请与实时授权结果' }),
  workflowOptions: op.get('/workflow-options', { access: 'authenticated', response: accessWorkflowOptionsSchema, summary: '权限申请工作流选项' }),
  workflowPreview: op.post('/workflow-preview', { access: 'authenticated', body: accessWorkflowPreviewInputSchema, response: accessWorkflowPreviewSchema, summary: '评估权限申请及实际审批计划' }),
  requestList: op.get('/requests', { access: { permission: 'system:access-governance:view' }, query: requestListQuery, response: paginated(accessRequestSchema), summary: '权限申请列表' }),
  requestRetry: op.post('/requests/{id}/retry', { access: { permission: 'system:access-governance:grant' }, params: idParam, response: accessRequestSchema, summary: '重试权限发放', audit: '重试权限发放' }),
  myRequests: op.get('/my/requests', { access: 'authenticated', query: requestListQuery, response: paginated(accessRequestSchema), summary: '本人权限申请' }),
  myGrants: op.get('/my/grants', { access: 'authenticated', query: grantListQuery, response: paginated(accessGrantSchema), summary: '本人临时授权' }),
  requestDetail: op.get('/requests/{id}', { access: { permission: 'system:access-governance:view' }, params: idParam, response: accessRequestSchema, summary: '权限申请详情' }),
  grantList: op.get('/grants', { access: { permission: 'system:access-governance:view' }, query: grantListQuery, response: paginated(accessGrantSchema), summary: '临时授权列表' }),
  grantDetail: op.get('/grants/{id}', { access: { permission: 'system:access-governance:view' }, params: idParam, response: accessGrantSchema, summary: '临时授权详情' }),
  grantRevoke: op.post('/grants/{id}/revoke', { access: { permission: 'system:access-governance:revoke' }, params: idParam, body: revokeAccessGrantSchema, response: accessGrantSchema, summary: '撤销临时授权', audit: '撤销临时授权' }),
  grantItemRevoke: op.post('/grant-items/{id}/revoke', { access: { permission: 'system:access-governance:revoke' }, params: idParam, body: revokeAccessGrantSchema, response: accessGrantSchema, summary: '撤销单项临时授权', audit: '撤销单项临时授权' }),
  reviewOptions: op.get('/review-options', { access: { permission: 'system:access-governance:review' }, response: z.object({ users: z.array(z.object({ id: z.int(), name: z.string() })), reviewers: z.array(z.object({ id: z.int(), name: z.string() })), departments: z.array(z.object({ id: z.int(), name: z.string() })), roles: z.array(z.object({ id: z.int(), name: z.string() })), groups: z.array(z.object({ id: z.int(), name: z.string() })) }), summary: '权限复核范围及可选负责人' }),
  reviewCampaignList: op.get('/review-campaigns', { access: { permission: 'system:access-governance:review' }, query: paginationQuery, response: paginated(accessReviewCampaignSchema), summary: '权限复核批次列表' }),
  reviewCampaignAssign: op.post('/review-campaigns/{id}/assign', { access: { permission: 'system:access-governance:review' }, params: idParam, body: assignAccessReviewCampaignSchema, response: accessReviewCampaignSchema, summary: '调整权限复核负责人', audit: '调整权限复核负责人' }),
  reviewCampaignRetry: op.post('/review-campaigns/{id}/retry', { access: { permission: 'system:access-governance:review' }, params: idParam, response: accessReviewCampaignSchema, summary: '重试准备权限复核批次', audit: '重试权限复核准备' }),
  reviewCampaignCreate: op.post('/review-campaigns', { access: { permission: 'system:access-governance:review' }, body: createAccessReviewCampaignSchema, response: accessReviewCampaignSchema, summary: '创建权限复核批次', audit: '创建权限复核批次' }),
  reviewItemList: op.get('/review-items', { access: { permission: 'system:access-governance:review' }, query: reviewListQuery, response: paginated(accessReviewItemSchema), summary: '权限复核项列表' }),
  reviewItemDecide: op.post('/review-items/{id}/decide', { access: { permission: 'system:access-governance:review' }, params: idParam, body: decideAccessReviewItemSchema, response: accessReviewItemSchema, summary: '处理权限复核项', audit: { description: '处理权限复核项', recordBody: false } }),
  policyList: op.get('/policies', { access: { permission: 'system:access-governance:policy' }, query: paginationQuery.extend({ keyword: keywordQuery('权限码'), riskLevel: queryEnum(ACCESS_RISK_LEVELS, { description: '风险等级' }), approvalPolicy: queryEnum(ACCESS_APPROVAL_POLICIES, { description: '审批策略' }) }), response: paginated(permissionPolicySchema), summary: '权限治理策略列表' }),
  policyUpdate: op.put('/policies/{permissionCode}', { access: { permission: 'system:access-governance:policy' }, params: z.object({ permissionCode: z.string().min(1).max(128) }), body: updatePermissionPolicySchema, response: permissionPolicySchema, summary: '更新权限治理策略', audit: '更新权限治理策略' }),
  userOverview: op.get('/users/{id}/overview', { access: { permission: 'system:access-governance:view' }, params: idParam, response: z.object({ userId: z.int(), grants: z.array(accessGrantSchema), reviews: z.array(accessReviewItemSchema) }), summary: '用户权限治理概览' }),
}, { auditModule: '权限治理', tags: ['AccessGovernance'] });

export type AccessRequestListQuery = z.infer<typeof requestListQuery>;
export type AccessGrantListQuery = z.infer<typeof grantListQuery>;
export type AccessReviewItemListQuery = z.infer<typeof reviewListQuery>;
