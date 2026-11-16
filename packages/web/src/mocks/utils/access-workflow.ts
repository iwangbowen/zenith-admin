import { ACCESS_REQUEST_BIZ_TYPE, accessPolicyBaseline, aggregateAccessPolicies, buildAccessApprovalFlow, effectiveAccessPolicy, mergeAccessPermissionItems, type AccessGrant, type AccessRequest, type AccessWorkflowPreview, type PermissionPolicy, type AccessWorkflowOptions } from '@zenith/shared/identity';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import type { WorkflowDefinition, WorkflowInstance } from '@zenith/shared/workflow';
import { mockUsers } from '../data/users';
import { mockRoles } from '../data/roles';
import { mockMenus } from '../data/menus';
import { mockWorkflowInstances } from '../data/workflow';
import { mockDateTime } from './date';
import { currentMockSession } from './auth';
import { MockHttpError } from './contract';
import { badRequest } from './handlers';

export const mockAccessPolicies = new Map<string, PermissionPolicy>();
export const mockAccessGrants = new Map<number, AccessGrant>();
export function mockAccessPolicy(code: string) { return effectiveAccessPolicy(accessPolicyBaseline(code, ALL_PERMISSIONS[code]), mockAccessPolicies.get(code)); }

export function mockAccessOptions(): AccessWorkflowOptions {
  return {
    roles: mockRoles.filter(role => !['super_admin', 'tenant_admin', 'security_admin'].includes(role.code) && (role.permissionCodes ?? []).length).map(role => ({
      id: role.id, name: role.name, code: role.code, dataScope: role.dataScope ?? 'self', version: role.permissionVersion ?? 1,
      permissionCount: (role.permissionCodes ?? []).length, permissionCodes: role.permissionCodes ?? [], ...aggregateAccessPolicies((role.permissionCodes ?? []).map(mockAccessPolicy)),
    })),
    menus: mockMenus.map(menu => {
      const policy = menu.permission && ALL_PERMISSIONS[menu.permission] ? mockAccessPolicy(menu.permission) : null;
      return { id: menu.id, parentId: menu.parentId, name: menu.name, title: menu.title, type: menu.type, permission: menu.permission,
        permissionLabel: menu.permission ? ALL_PERMISSIONS[menu.permission]?.label ?? menu.title : null,
        requestable: policy?.enabled ?? false, path: [menu.title], riskLevel: policy?.riskLevel ?? 'low', approvalPolicy: policy?.approvalPolicy ?? 'none',
        maxDurationMinutes: policy?.maxDurationMinutes ?? null, mfaRequired: policy?.mfaRequired ?? false,
        permanentAllowed: policy?.permanentAllowed ?? false, emergencyAllowed: policy?.emergencyAllowed ?? false, maxEmergencyMinutes: policy?.maxEmergencyMinutes ?? 60 };
    }),
  };
}

export function evaluateMockAccess(raw: Record<string, unknown>, actorId: number): AccessWorkflowPreview {
  const roles = Array.isArray(raw.roleSelections) ? raw.roleSelections as { roleId: number }[] : [];
  const codes = [...new Set([...(Array.isArray(raw.permissionCodes) ? raw.permissionCodes as string[] : []), ...roles.flatMap(selection => mockRoles.find(role => role.id === selection.roleId)?.permissionCodes ?? [])])];
  if (!codes.length) return { status: 'selection_required', message: '请选择角色包或操作权限' };
  if (codes.some(code => !ALL_PERMISSIONS[code] || !mockAccessPolicy(code).enabled)) return { status: 'blocked', message: '所选权限不可自助申请' };
  const policies = codes.map(mockAccessPolicy);
  const policy = aggregateAccessPolicies(policies);
  const people = mockUsers.filter(user => user.id !== actorId && user.status === 'enabled');
  const keys = ['approve_manager', 'approve_security', 'approve_second_security'] as const;
  const count = policy.approvalPolicy === 'none' ? 0 : policy.approvalPolicy === 'manager' ? 1 : policy.approvalPolicy === 'manager_security' ? 2 : 3;
  if (people.length < count) return { status: 'blocked', message: '演示审批人不足' };
  return { status: 'ready', fingerprint: JSON.stringify([codes.sort(), policies.map(item => item.version), raw.startMode, raw.expiresAt]),
    permissionCount: codes.length, grantItemCount: codes.length, policies,
    approvalPlan: { approvalPolicy: policy.approvalPolicy, mfaRequired: policy.mfaRequired, steps: people.slice(0, count).map((person, index) => ({ nodeKey: keys[index], label: index ? '独立安全审批' : '部门负责人审批', userId: person.id, userName: person.nickname || person.username, reason: '演示策略审批人' })) } };
}

export function prepareMockAccess(def: WorkflowDefinition, raw: Record<string, unknown>, actorId: number) {
  if (def.customForm?.businessType !== ACCESS_REQUEST_BIZ_TYPE) return { formData: raw, flowData: def.flowData };
  const preview = evaluateMockAccess(raw, actorId);
  if (preview.status !== 'ready') throw new MockHttpError(badRequest(preview.message));
  const selections = Array.isArray(raw.roleSelections) ? raw.roleSelections as { roleId: number }[] : [];
  const roleItems = selections.flatMap(selection => {
    const role = mockRoles.find(item => item.id === selection.roleId);
    return (role?.permissionCodes ?? []).map(permissionCode => ({ permissionCode, permissionLabel: ALL_PERMISSIONS[permissionCode]?.label ?? permissionCode, dataScope: role?.dataScope ?? 'self' as const,
      deptScopeIds: [], sourceRefs: [{ kind: 'role' as const, roleId: role!.id, roleVersion: role!.permissionVersion ?? 1, label: role!.name }] }));
  });
  const directItems = (Array.isArray(raw.permissionCodes) ? raw.permissionCodes as string[] : []).map(permissionCode => ({ permissionCode, permissionLabel: ALL_PERMISSIONS[permissionCode]?.label ?? permissionCode, dataScope: 'self' as const, deptScopeIds: [], sourceRefs: [{ kind: 'direct' as const, label: '直接申请' }] }));
  return { flowData: buildAccessApprovalFlow(preview.approvalPlan, def.flowData?.settings), formData: { ...raw,
    startsAt: raw.startMode === 'scheduled' ? raw.startsAt : mockDateTime(), targetUserId: actorId,
    targetUserName: mockUsers.find(user => user.id === actorId)?.nickname ?? String(actorId),
    policySnapshot: preview.policies, approvalPlan: preview.approvalPlan, mfaRequired: preview.approvalPlan.mfaRequired,
    riskLevel: aggregateAccessPolicies(preview.policies).riskLevel, approvalPolicy: preview.approvalPlan.approvalPolicy,
    permissionItems: mergeAccessPermissionItems([...roleItems, ...directItems]).map((item, index) => ({ ...item, id: index + 1, itemType: 'permission', snapshot: {} })),
  } };
}

export function syncMockAccess(instance: WorkflowInstance): void {
  if (instance.bizType !== ACCESS_REQUEST_BIZ_TYPE || instance.status !== 'approved' || mockAccessGrants.has(instance.id)) return;
  const value = instance.formData ?? {};
  const policies = value.policySnapshot as ReturnType<typeof mockAccessPolicy>[];
  const items = value.permissionItems as AccessRequest['items'];
  mockAccessGrants.set(instance.id, { id: instance.id, userId: instance.initiatorId, userName: instance.initiatorName, requestId: instance.id, workflowInstanceId: instance.id,
    sourceType: value.requestType === 'emergency' ? 'emergency' : 'request', status: 'active', riskLevel: value.riskLevel as AccessRequest['riskLevel'], startsAt: String(value.startsAt), expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    items: items.map(item => ({ id: instance.id * 1000 + item.id, scopeKey: item.scopeKey, sourceRefs: item.sourceRefs, permissionCode: item.permissionCode, permissionLabel: item.permissionLabel ?? null, status: 'active', dataScope: item.dataScope ?? 'self', deptScopeIds: item.deptScopeIds,
      startsAt: String(value.startsAt), expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null, nextReviewAt: null, revokedAt: null, revokedBy: null, revokeReason: null, policySnapshot: policies.find(policy => policy.permissionCode === item.permissionCode)! })),
    createdAt: mockDateTime(), updatedAt: mockDateTime(), tenantId: instance.tenantId,
  });
}

export function mockAccessResult(instance: WorkflowInstance) {
  syncMockAccess(instance);
  const value = instance.formData ?? {};
  const request: AccessRequest = { id: instance.id, workflowInstanceId: instance.id, workflowTitle: instance.title, workflowSerialNo: instance.serialNo, tenantId: instance.tenantId,
    applicantUserId: instance.initiatorId, targetUserId: instance.initiatorId, applicantName: instance.initiatorName, targetUserName: instance.initiatorName,
    status: instance.status === 'approved' ? 'approved' : instance.status === 'rejected' ? 'rejected' : ['withdrawn', 'cancelled'].includes(instance.status) ? 'cancelled' : 'pending',
    provisionStatus: instance.status === 'approved' ? 'succeeded' : ['rejected', 'withdrawn', 'cancelled'].includes(instance.status) ? 'terminated' : 'not_started',
    reason: String(value.reason ?? ''), startsAt: String(value.startsAt ?? instance.createdAt), expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    riskLevel: value.riskLevel as AccessRequest['riskLevel'], requestType: value.requestType === 'emergency' ? 'emergency' : 'temporary',
    policySnapshot: value.policySnapshot as AccessRequest['policySnapshot'], approvalPlan: value.approvalPlan as AccessRequest['approvalPlan'], approvalEvidence: [],
    items: value.permissionItems as AccessRequest['items'], appliedAt: instance.status === 'approved' ? instance.updatedAt : null, createdAt: instance.createdAt, updatedAt: instance.updatedAt,
  };
  const grant = mockAccessGrants.get(instance.id) ?? null;
  if (grant) for (const item of grant.items) if (item.status !== 'revoked') item.status = item.expiresAt && item.expiresAt <= mockDateTime() ? 'expired' : item.startsAt > mockDateTime() ? 'scheduled' : 'active';
  return { request, grant };
}
export function mockAccessInstances() { return mockWorkflowInstances.filter(instance => instance.bizType === ACCESS_REQUEST_BIZ_TYPE); }
export function mockAccessActor(request: Request) { return currentMockSession(request)?.user.id ?? 1; }
