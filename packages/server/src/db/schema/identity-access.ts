import { pgEnum, pgTable, integer, varchar, boolean, jsonb, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ACCESS_PROVISION_STATUSES, ACCESS_APPROVAL_POLICIES, ACCESS_GRANT_SOURCES, ACCESS_GRANT_STATUSES, ACCESS_REQUEST_ITEM_TYPES, ACCESS_REQUEST_STATUSES, ACCESS_REQUEST_TYPES, ACCESS_REVIEW_DECISIONS, ACCESS_REVIEW_SCOPE_TYPES, ACCESS_REVIEW_STATUSES, ACCESS_REVIEW_SOURCE_TYPES, ACCESS_RISK_LEVELS } from '@zenith/shared/identity';
import { auditColumns, dataScopeEnum, roles, tenantIdColumn, users } from './core';
import { idColumn, timestamptz, timestampColumns } from './common';
import { workflowInstances } from './workflow';
import type { AccessPolicySnapshot, AccessApprovalPlan, AccessApprovalEvidence, AccessReviewHistory } from '@zenith/shared/identity';

export const accessRiskLevelEnum = pgEnum('identity_access_risk_level', ACCESS_RISK_LEVELS);
export const accessApprovalPolicyEnum = pgEnum('identity_access_approval_policy', ACCESS_APPROVAL_POLICIES);
export const accessRequestTypeEnum = pgEnum('identity_access_request_type', ACCESS_REQUEST_TYPES);
export const accessRequestStatusEnum = pgEnum('identity_access_request_status', ACCESS_REQUEST_STATUSES);
export const accessProvisionStatusEnum = pgEnum('identity_access_provision_status', ACCESS_PROVISION_STATUSES);
export const accessRequestItemTypeEnum = pgEnum('identity_access_request_item_type', ACCESS_REQUEST_ITEM_TYPES);
export const accessGrantStatusEnum = pgEnum('identity_access_grant_status', ACCESS_GRANT_STATUSES);
export const accessGrantSourceEnum = pgEnum('identity_access_grant_source', ACCESS_GRANT_SOURCES);
export const accessReviewScopeTypeEnum = pgEnum('identity_access_review_scope_type', ACCESS_REVIEW_SCOPE_TYPES);
export const accessReviewStatusEnum = pgEnum('identity_access_review_status', ACCESS_REVIEW_STATUSES);
export const accessReviewDecisionEnum = pgEnum('identity_access_review_decision', ACCESS_REVIEW_DECISIONS);
export const accessReviewSourceTypeEnum = pgEnum('identity_access_review_source_type', ACCESS_REVIEW_SOURCE_TYPES);

export const identityPermissionPolicies = pgTable('identity_permission_policies', {
  id: idColumn(),
  permissionCode: varchar({ length: 128 }).notNull(),
  version: integer().notNull().default(1),
  riskLevel: accessRiskLevelEnum().notNull().default('low'),
  approvalPolicy: accessApprovalPolicyEnum().notNull().default('none'),
  maxDurationMinutes: integer(),
  reviewIntervalDays: integer().notNull().default(0),
  mfaRequired: boolean().notNull().default(false),
  enabled: boolean().notNull().default(true),
  permanentAllowed: boolean().notNull().default(false),
  emergencyAllowed: boolean().notNull().default(false),
  maxEmergencyMinutes: integer().notNull().default(60),
  tenantId: tenantIdColumn(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('identity_permission_policies_code_tenant_unique').on(t.permissionCode, t.tenantId).nullsNotDistinct(),
  index('identity_permission_policies_tenant_idx').on(t.tenantId),
  index('identity_permission_policies_risk_idx').on(t.riskLevel),
]);

export type IdentityPermissionPolicyRow = typeof identityPermissionPolicies.$inferSelect;
export type NewIdentityPermissionPolicy = typeof identityPermissionPolicies.$inferInsert;

export const identityAccessRequests = pgTable('identity_access_requests', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  applicantUserId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetUserId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestType: accessRequestTypeEnum().notNull().default('temporary'),
  status: accessRequestStatusEnum().notNull().default('draft'),
  provisionStatus: accessProvisionStatusEnum().notNull().default('not_started'),
  reason: varchar({ length: 1000 }).notNull(),
  startsAt: timestamptz().notNull(),
  expiresAt: timestamptz(),
  riskLevel: accessRiskLevelEnum().notNull().default('low'),
  workflowInstanceId: integer().references(() => workflowInstances.id, { onDelete: 'set null' }),
  approvedAt: timestamptz(),
  rejectedAt: timestamptz(),
  appliedAt: timestamptz(),
  failureReason: varchar({ length: 1000 }),
  policySnapshot: jsonb().$type<AccessPolicySnapshot[]>().notNull().default([]),
  approvalPlan: jsonb().$type<AccessApprovalPlan>().notNull().default({ approvalPolicy: 'none', mfaRequired: false, steps: [] }),
  approvalEvidence: jsonb().$type<AccessApprovalEvidence[]>().notNull().default([]),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('identity_access_requests_tenant_created_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
  index('identity_access_requests_applicant_idx').on(t.applicantUserId, t.createdAt.desc()),
  index('identity_access_requests_target_idx').on(t.targetUserId, t.createdAt.desc()),
  index('identity_access_requests_status_idx').on(t.status, t.createdAt.desc()),
  unique('identity_access_requests_workflow_unique').on(t.workflowInstanceId),
  index('identity_access_requests_workflow_idx').on(t.workflowInstanceId),
]);

export type IdentityAccessRequestRow = typeof identityAccessRequests.$inferSelect;
export type NewIdentityAccessRequest = typeof identityAccessRequests.$inferInsert;

export const identityAccessRequestItems = pgTable('identity_access_request_items', {
  id: idColumn(),
  requestId: integer().notNull().references(() => identityAccessRequests.id, { onDelete: 'cascade' }),
  itemType: accessRequestItemTypeEnum().notNull(),
  roleId: integer().references(() => roles.id, { onDelete: 'set null' }),
  permissionCode: varchar({ length: 128 }).notNull(),
  permissionLabel: varchar({ length: 128 }),
  // The approved page identity and display snapshot outlive changes to navigation.
  menuId: integer(),
  pageTitle: varchar({ length: 64 }),
  pagePath: varchar({ length: 256 }),
  dataScope: dataScopeEnum(),
  deptScopeIds: jsonb().$type<number[]>().notNull().default([]),
  scopeKey: varchar({ length: 2048 }).notNull(),
  sourceRefs: jsonb().$type<Array<{ kind: 'direct' | 'role'; roleId?: number; roleVersion?: number; label: string }>>().notNull().default([]),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamptz().defaultNow().notNull(),
}, (t) => [
  index('identity_access_request_items_request_idx').on(t.requestId),
  index('identity_access_request_items_role_idx').on(t.roleId),
]);

export type IdentityAccessRequestItemRow = typeof identityAccessRequestItems.$inferSelect;
export type NewIdentityAccessRequestItem = typeof identityAccessRequestItems.$inferInsert;

export const identityAccessGrants = pgTable('identity_access_grants', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestId: integer().references(() => identityAccessRequests.id, { onDelete: 'set null' }),
  sourceType: accessGrantSourceEnum().notNull().default('request'),
  status: accessGrantStatusEnum().notNull().default('scheduled'),
  riskLevel: accessRiskLevelEnum().notNull().default('low'),
  startsAt: timestamptz().notNull(),
  expiresAt: timestamptz(),
  approvedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamptz(),
  revokedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  revokedAt: timestamptz(),
  revokeReason: varchar({ length: 1000 }),
  expiringNotifiedAt: timestamptz(),
  expiredNotifiedAt: timestamptz(),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('identity_access_grants_tenant_status_idx').on(t.tenantId, t.status, t.expiresAt),
  index('identity_access_grants_user_status_idx').on(t.userId, t.status, t.startsAt, t.expiresAt),
  unique('identity_access_grants_request_unique').on(t.requestId),
  index('identity_access_grants_expiry_idx').on(t.status, t.expiresAt),
]);

export type IdentityAccessGrantRow = typeof identityAccessGrants.$inferSelect;
export type NewIdentityAccessGrant = typeof identityAccessGrants.$inferInsert;

export const identityAccessGrantItems = pgTable('identity_access_grant_items', {
  id: idColumn(),
  grantId: integer().notNull().references(() => identityAccessGrants.id, { onDelete: 'cascade' }),
  permissionCode: varchar({ length: 128 }).notNull(),
  permissionLabel: varchar({ length: 128 }),
  menuId: integer(),
  pageTitle: varchar({ length: 64 }),
  pagePath: varchar({ length: 256 }),
  status: accessGrantStatusEnum().notNull().default('scheduled'),
  scopeKey: varchar({ length: 2048 }).notNull(),
  sourceRefs: jsonb().$type<Array<{ kind: 'direct' | 'role'; roleId?: number; roleVersion?: number; label: string }>>().notNull().default([]),
  dataScope: dataScopeEnum().notNull().default('self'),
  deptScopeIds: jsonb().$type<number[]>().notNull().default([]),
  startsAt: timestamptz().notNull(),
  expiresAt: timestamptz(),
  nextReviewAt: timestamptz(),
  policySnapshot: jsonb().$type<AccessPolicySnapshot>().notNull(),
  revokedAt: timestamptz(),
  revokedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  revokeReason: varchar({ length: 1000 }),
}, (t) => [
  unique('identity_access_grant_items_target_scope_unique').on(t.grantId, t.menuId, t.permissionCode, t.scopeKey).nullsNotDistinct(),
  index('identity_access_grant_items_permission_idx').on(t.permissionCode),
  index('identity_access_grant_items_lifecycle_idx').on(t.status, t.expiresAt),
]);

export type IdentityAccessGrantItemRow = typeof identityAccessGrantItems.$inferSelect;
export type NewIdentityAccessGrantItem = typeof identityAccessGrantItems.$inferInsert;

export const identityAccessReviewCampaigns = pgTable('identity_access_review_campaigns', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  name: varchar({ length: 128 }).notNull(),
  scopeType: accessReviewScopeTypeEnum().notNull(),
  scopeIds: jsonb().$type<number[]>().notNull().default([]),
  reviewerId: integer().notNull().references(() => users.id, { onDelete: 'restrict' }),
  dueAt: timestamptz().notNull(),
  status: accessReviewStatusEnum().notNull().default('preparing'),
  buildCursorUserId: integer().notNull().default(0),
  dueOnly: boolean().notNull().default(false),
  failureReason: varchar({ length: 1000 }),
  startedAt: timestamptz().defaultNow().notNull(),
  completedAt: timestamptz(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('identity_access_review_campaigns_tenant_status_idx').on(t.tenantId, t.status, t.dueAt),
  index('identity_access_review_campaigns_reviewer_idx').on(t.reviewerId, t.status),
]);

export type IdentityAccessReviewCampaignRow = typeof identityAccessReviewCampaigns.$inferSelect;
export type NewIdentityAccessReviewCampaign = typeof identityAccessReviewCampaigns.$inferInsert;

export const identityAccessReviewItems = pgTable('identity_access_review_items', {
  id: idColumn(),
  campaignId: integer().notNull().references(() => identityAccessReviewCampaigns.id, { onDelete: 'cascade' }),
  reviewerId: integer().notNull().references(() => users.id, { onDelete: 'restrict' }),
  dueAt: timestamptz().notNull(),
  exceptionOwnerId: integer().references(() => users.id, { onDelete: 'set null' }),
  exceptionUntil: timestamptz(),
  nextReviewAt: timestamptz(),
  history: jsonb().$type<AccessReviewHistory[]>().notNull().default([]),
  tenantId: tenantIdColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceType: accessReviewSourceTypeEnum().notNull(),
  sourceId: integer(),
  sourceLabel: varchar({ length: 128 }),
  permissionCode: varchar({ length: 128 }),
  permissionLabel: varchar({ length: 128 }),
  riskLevel: accessRiskLevelEnum().notNull().default('low'),
  decision: accessReviewDecisionEnum().notNull().default('pending'),
  decidedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamptz(),
  remark: varchar({ length: 1000 }),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamptz().defaultNow().notNull(),
  updatedAt: timestamptz().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('identity_access_review_items_campaign_idx').on(t.campaignId, t.decision),
  unique('identity_access_review_items_source_unique').on(t.campaignId, t.userId, t.sourceType, t.sourceId).nullsNotDistinct(),
  uniqueIndex('identity_access_review_items_pending_source_unique').on(sql`coalesce(${t.tenantId}, 0)`, t.userId, t.sourceType, t.sourceId).where(sql`${t.decision} = 'pending'`),
  index('identity_access_review_items_source_history_idx').on(t.userId, t.sourceType, t.sourceId, t.createdAt.desc()),
  index('identity_access_review_items_tenant_user_idx').on(t.tenantId, t.userId),
  index('identity_access_review_items_risk_idx').on(t.riskLevel, t.decision),
]);

export type IdentityAccessReviewItemRow = typeof identityAccessReviewItems.$inferSelect;
export type NewIdentityAccessReviewItem = typeof identityAccessReviewItems.$inferInsert;

/** Direct permissions are independent from navigation and have stable review source IDs. */
export const identityUserPermissions = pgTable('identity_user_permissions', {
  id: idColumn(), userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  permissionCode: varchar({ length: 128 }).notNull(),
  dataScope: dataScopeEnum().notNull().default('self'),
  deptScopeIds: jsonb().$type<number[]>().notNull().default([]),
  scopeKey: varchar({ length: 2048 }).notNull(),
  ...auditColumns(), ...timestampColumns(),
}, t => [unique('identity_user_permissions_scope_unique').on(t.userId, t.permissionCode, t.scopeKey)]);

/** Immutable published role content; bindings read the role's current published version. */
export const identityRoleVersions = pgTable('identity_role_versions', {
  id: idColumn(), roleId: integer().notNull().references(() => roles.id, { onDelete: 'cascade' }),
  version: integer().notNull(), permissionCodes: jsonb().$type<string[]>().notNull(),
  /** 角色页面访问包：审批角色包必须固定页面范围，不能只看权限码 */
  menuIds: jsonb().$type<number[]>().notNull().default([]),
  dataScope: dataScopeEnum().notNull(), deptScopeIds: jsonb().$type<number[]>().notNull().default([]),
  ...auditColumns(), createdAt: timestamptz().defaultNow().notNull(),
}, t => [unique('identity_role_versions_number_unique').on(t.roleId, t.version)]);
