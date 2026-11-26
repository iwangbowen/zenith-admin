import { ACCESS_REQUEST_BIZ_TYPE, ACCESS_APPROVAL_STEPS, accessPolicyBaseline, aggregateAccessPolicies, buildAccessApprovalFlow, effectiveAccessPolicy, mergeAccessPermissionItems, type AccessGrant, type AccessRequest, type AccessWorkflowPreview, type PermissionPolicy, type AccessWorkflowOptions, type AccessScopeOptions } from '@zenith/shared/identity';
import { buildPermissionDirectory } from '@zenith/shared/permission-features';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import type { WorkflowDefinition, WorkflowInstance } from '@zenith/shared/workflow';
import { mockUsers } from '../data/users';
import { mockRoles } from '../data/roles';
import { buildMenuTree, mockMenus } from '../data/menus';
import { mockAccessGrants } from '../data/access';
import { mockWorkflowInstances } from '../data/workflow';
import { mockDateTime } from './date';
import { currentMockSession } from './auth';
import { MockHttpError } from './contract';
import { badRequest } from './handlers';

export const mockAccessPolicies = new Map<string, PermissionPolicy>();
export { mockAccessGrants } from '../data/access';
export function mockAccessPolicy(code: string) { return effectiveAccessPolicy(accessPolicyBaseline(code, ALL_PERMISSIONS[code]), mockAccessPolicies.get(code)); }

export function mockAccessScope(assignment = false): AccessScopeOptions {
  const pages = mockMenus.filter(menu => menu.status === 'enabled');
  const permissions = buildPermissionDirectory(pages).items.map(item => {
    const policy = mockAccessPolicy(item.code);
    return { ...item, selectable: assignment || policy.enabled, policy };
  });
  return {
    pages: buildMenuTree(pages),
    selectablePageIds: pages.flatMap(page => page.type === 'menu' &&
      (assignment || (page.permission && mockAccessPolicy(page.permission).enabled)) ? [page.id] : []),
    permissions,
  };
}

export function mockAccessOptions(): AccessWorkflowOptions {
  const scope = mockAccessScope();
  const selectable = new Set(scope.selectablePageIds);
  const roles = mockRoles.flatMap(role => {
    if (role.status !== 'enabled' || ['super_admin', 'tenant_admin', 'security_admin'].includes(role.code)) return [];
    const menuIds = role.menuIds ?? [];
    if (menuIds.some(id => !selectable.has(id))) return [];
    const readCodes = mockMenus.flatMap(menu => menuIds.includes(menu.id) && menu.permission ? [menu.permission] : []);
    const permissionCodes = [...new Set([...(role.permissionCodes ?? []), ...readCodes])];
    const policies = permissionCodes.map(mockAccessPolicy);
    if (!policies.length || policies.some(policy => !policy.enabled)) return [];
    return [{
      id: role.id, name: role.name, code: role.code, dataScope: role.dataScope ?? 'self', version: role.permissionVersion ?? 1,
      permissionCount: permissionCodes.length, permissionCodes, menuIds, ...aggregateAccessPolicies(policies),
    }];
  });
  return { roles, scope };
}

export function evaluateMockAccess(raw: Record<string, unknown>, actorId: number): AccessWorkflowPreview {
  const roles = Array.isArray(raw.roleSelections) ? raw.roleSelections as { roleId: number }[] : [];
  const menuIds = Array.isArray(raw.menuIds) ? raw.menuIds as number[] : [];
  const roleMenuIds = roles.flatMap(selection => mockRoles.find(role => role.id === selection.roleId)?.menuIds ?? []);
  const pageIds = [...new Set([...menuIds, ...roleMenuIds])];
  if (pageIds.some(id => !mockMenus.some(page => page.id === id && page.type === 'menu' && page.status === 'enabled' && page.permission))) return { status: 'blocked', message: '所选页面不可申请' };
  const pageCodes = pageIds.flatMap(id => {
    const menu = mockMenus.find(item => item.id === id);
    return menu?.permission ? [menu.permission] : [];
  });
  const codes = [...new Set([...(Array.isArray(raw.permissionCodes) ? raw.permissionCodes as string[] : []), ...pageCodes, ...roles.flatMap(selection => mockRoles.find(role => role.id === selection.roleId)?.permissionCodes ?? [])])];
  if (!codes.length && !pageIds.length) return { status: 'selection_required', message: '请选择页面、角色包或操作权限' };
  if (codes.some(code => !ALL_PERMISSIONS[code] || !mockAccessPolicy(code).enabled)) return { status: 'blocked', message: '所选权限不可自助申请' };
  const policies = codes.map(mockAccessPolicy);
  const policy = aggregateAccessPolicies(policies);
  const people = mockUsers.filter(user => user.id !== actorId && user.status === 'enabled');
  const definitions = ACCESS_APPROVAL_STEPS[policy.approvalPolicy];
  const count = definitions.length;
  if (people.length < count) return { status: 'blocked', message: '演示审批人不足' };
  return { status: 'ready', fingerprint: JSON.stringify([codes.sort(), pageIds.sort((a, b) => a - b), policies.map(item => item.version), raw.startMode, raw.expiresAt]),
    permissionCount: codes.length, grantItemCount: codes.length, menuCount: pageIds.length, policies,
    approvalPlan: { approvalPolicy: policy.approvalPolicy, mfaRequired: policy.mfaRequired, steps: people.slice(0, count).map((person, index) => ({ nodeKey: definitions[index].nodeKey, label: definitions[index].label, userId: person.id, userName: person.nickname || person.username, reason: '演示策略审批人' })) } };
}

export function prepareMockAccess(def: WorkflowDefinition, raw: Record<string, unknown>, actorId: number) {
  if (def.customForm?.businessType !== ACCESS_REQUEST_BIZ_TYPE) return { formData: raw, flowData: def.flowData };
  const preview = evaluateMockAccess(raw, actorId);
  if (preview.status !== 'ready') throw new MockHttpError(badRequest(preview.message));
  const selections = Array.isArray(raw.roleSelections) ? raw.roleSelections as { roleId: number }[] : [];
  const pageItems = (ids: number[]) => mockMenus.flatMap(page => ids.includes(page.id) && page.permission ? [{
    menuId: page.id, pageTitle: page.title, pagePath: page.path ?? null,
    permissionCode: page.permission, permissionLabel: ALL_PERMISSIONS[page.permission]?.label ?? page.permission,
  }] : []);
  const capabilityItems = (codes: string[]) => codes.map(permissionCode => ({
    permissionCode, permissionLabel: ALL_PERMISSIONS[permissionCode]?.label ?? permissionCode,
  }));
  const selectedRoles = selections.flatMap(selection => mockRoles.find(role => role.id === selection.roleId) ?? []);
  const roleItems = selectedRoles.flatMap(role => {
    const scope = { dataScope: role.dataScope ?? 'self' as const, deptScopeIds: role.deptScopeIds ?? [],
      sourceRefs: [{ kind: 'role' as const, roleId: role.id, roleVersion: role.permissionVersion ?? 1, label: role.name }] };
    return [...capabilityItems(role.permissionCodes ?? []), ...pageItems(role.menuIds ?? [])].map(item => ({ ...item, ...scope }));
  });
  const directPageIds = Array.isArray(raw.menuIds) ? raw.menuIds as number[] : [];
  const menuIds = [...new Set([...directPageIds, ...selectedRoles.flatMap(role => role.menuIds ?? [])])];
  const menus = pageItems(menuIds).map(item => ({ menuId: item.menuId, title: item.pageTitle, path: item.pagePath }));
  const directItems = [...pageItems(directPageIds), ...capabilityItems(Array.isArray(raw.permissionCodes) ? raw.permissionCodes as string[] : [])]
    .map(item => ({ ...item, dataScope: 'self' as const, deptScopeIds: [], sourceRefs: [{ kind: 'direct' as const, label: '直接申请' }] }));
  return { flowData: buildAccessApprovalFlow(preview.approvalPlan, def.flowData?.settings), formData: { ...raw, menuIds, menus,
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
    items: items.map(item => ({ id: instance.id * 1000 + item.id, scopeKey: item.scopeKey, sourceRefs: item.sourceRefs, permissionCode: item.permissionCode, permissionLabel: item.permissionLabel ?? null, menuId: item.menuId, pageTitle: item.pageTitle, pagePath: item.pagePath, status: 'active', dataScope: item.dataScope ?? 'self', deptScopeIds: item.deptScopeIds,
      startsAt: String(value.startsAt), expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null, nextReviewAt: null, revokedAt: null, revokedBy: null, revokeReason: null, policySnapshot: policies.find(policy => policy.permissionCode === item.permissionCode)! })),
    menus: Array.isArray(value.menus) ? value.menus as AccessGrant['menus'] : [],
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
    items: value.permissionItems as AccessRequest['items'],
    menus: Array.isArray(value.menus) ? value.menus as AccessRequest['menus'] : [],
    appliedAt: instance.status === 'approved' ? instance.updatedAt : null, createdAt: instance.createdAt, updatedAt: instance.updatedAt,
  };
  const grant = mockAccessGrants.get(instance.id) ?? null;
  if (grant) for (const item of grant.items) if (item.status !== 'revoked') item.status = item.expiresAt && item.expiresAt <= mockDateTime() ? 'expired' : item.startsAt > mockDateTime() ? 'scheduled' : 'active';
  return { request, grant };
}
export function mockAccessInstances() { return mockWorkflowInstances.filter(instance => instance.bizType === ACCESS_REQUEST_BIZ_TYPE); }
export function mockAccessActor(request: Request) { return currentMockSession(request)?.user.id ?? 1; }
