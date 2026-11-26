import { permissionPolicySchema, accessPolicyBaseline, type AccessPolicySnapshot, accessRequestSchema, accessRequestItemSchema, accessGrantSchema, accessGrantItemSchema, accessReviewCampaignSchema, accessReviewItemSchema } from '@zenith/shared/identity';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import type { identityPermissionPolicies, identityAccessRequests, identityAccessRequestItems, identityAccessGrants, identityAccessGrantItems, identityAccessReviewCampaigns, identityAccessReviewItems, users } from '../../db/schema';
import { entityMapper, pickEntity } from '../../lib/entity-map';

type DisplayUser = Pick<typeof users.$inferSelect, 'id' | 'username' | 'nickname'>;
type RequestRow = typeof identityAccessRequests.$inferSelect & { applicant?: DisplayUser; target?: DisplayUser; workflowInstance?: { title: string; serialNo: string | null } | null; items?: (typeof identityAccessRequestItems.$inferSelect)[] };
type GrantRow = typeof identityAccessGrants.$inferSelect & { user?: DisplayUser; request?: { workflowInstanceId: number | null } | null; approver?: DisplayUser | null; revoker?: DisplayUser | null; items?: (typeof identityAccessGrantItems.$inferSelect)[] };
type CampaignRow = typeof identityAccessReviewCampaigns.$inferSelect & { reviewer?: DisplayUser; itemCount?: number; pendingCount?: number };
type ReviewRow = typeof identityAccessReviewItems.$inferSelect & { user?: DisplayUser; reviewer?: DisplayUser };

function effectiveStatus(row: { status: string; startsAt: Date; expiresAt: Date | null }) {
  if (row.status === 'revoked') return 'revoked' as const;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return 'expired' as const;
  return row.startsAt.getTime() > Date.now() ? 'scheduled' as const : 'active' as const;
}

function pageRefs(items: RequestRow['items'] | GrantRow['items']) {
  return [...new Map((items ?? []).flatMap(({ menuId, pageTitle, pagePath }) => menuId == null
    ? []
    : [[menuId, { menuId, title: pageTitle ?? `#${menuId}`, path: pagePath }] as const])).values()];
}

export function formatPermissionPolicy(policy: AccessPolicySnapshot, record: typeof identityPermissionPolicies.$inferSelect | undefined, tenantId: number | null) {
  const baseline = accessPolicyBaseline(policy.permissionCode, ALL_PERMISSIONS[policy.permissionCode]);
  return pickEntity(permissionPolicySchema, {
    ...record, ...policy, permissionLabel: ALL_PERMISSIONS[policy.permissionCode]?.label ?? null, id: record?.id ?? 0, tenantId, createdAt: record?.createdAt ?? null, updatedAt: record?.updatedAt ?? null, createdBy: record?.createdBy ?? null, updatedBy: record?.updatedBy ?? null,
    inherited: record?.tenantId !== tenantId || !record, minimumRiskLevel: baseline.riskLevel, selfRequestable: baseline.enabled,
  });
}

export const formatAccessRequest = entityMapper(accessRequestSchema, (row: RequestRow) => ({
  workflowTitle: row.workflowInstance?.title ?? null,
  workflowSerialNo: row.workflowInstance?.serialNo ?? null,
  applicantName: row.applicant ? row.applicant.nickname || row.applicant.username : null,
  targetUserName: row.target ? row.target.nickname || row.target.username : null,
  items: (row.items ?? []).map(item => pickEntity(accessRequestItemSchema, item)),
  menus: pageRefs(row.items),
}));

export const formatAccessGrant = entityMapper(accessGrantSchema, (row: GrantRow) => ({
  workflowInstanceId: row.request?.workflowInstanceId ?? null,
  userName: row.user ? row.user.nickname || row.user.username : null,
  approvedByName: row.approver ? row.approver.nickname || row.approver.username : null,
  status: effectiveStatus(row),
  items: (row.items ?? []).map(item => pickEntity(accessGrantItemSchema, item, { status: effectiveStatus(item) })),
  menus: pageRefs(row.items),
}));

export const formatReviewCampaign = entityMapper(accessReviewCampaignSchema, (row: CampaignRow) => ({
  reviewerName: row.reviewer ? row.reviewer.nickname || row.reviewer.username : null,
  itemCount: row.itemCount ?? 0,
  pendingCount: row.pendingCount ?? 0,
  status: ['open', 'in_progress', 'overdue'].includes(row.status) && row.dueAt.getTime() < Date.now() ? 'overdue' : row.status,
}));

export const formatReviewItem = entityMapper(accessReviewItemSchema, (row: ReviewRow) => ({
  userName: row.user ? row.user.nickname || row.user.username : null,
  reviewerName: row.reviewer ? row.reviewer.nickname || row.reviewer.username : null,
}));
