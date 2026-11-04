import { and, asc, desc, eq, exists, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';
import { type AccessRequest, type AccessGrant, type PermissionPolicy, accessGovernanceContract } from '@zenith/shared/identity';
import type { AccessSourceRef, AccessWorkflowInput, AccessWorkflowPreview } from '@zenith/shared/identity';
import { availablePermissionCodes } from './permission-catalog.service';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { identityAccessGrantItems, identityAccessGrants, identityAccessRequests, identityAccessReviewItems, identityPermissionPolicies, menus, roles, users } from '../../db/schema';
import { currentUser, setAuditBefore } from '../../lib/context';
import { exactTenantCondition, getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { requireTenantUser, resolveUserNames } from '../../lib/user-nicknames';
import { parseDateTimeInput, formatDateTime } from '../../lib/datetime';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { pageOffset } from '../../lib/pagination';
import { effectiveAccessPolicy } from '@zenith/shared/identity';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { notifyUserPermissionsChanged } from '../../lib/permissions';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { ACCESS_REQUEST_BIZ_TYPE, accessWorkflowInputSchema, type DataScope } from '@zenith/shared/identity';
import { taskTransaction } from '../../lib/task-center';
import { requireApprovedBusiness } from '../workflow/public/access-approval';
import { aggregateAccessPolicies, accessPolicyBaseline, mergeAccessPermissionItems } from '@zenith/shared/identity';
import { loadEffectiveAccessPolicies, readAccessPolicySet, assertPermissionPolicyUpdate, assertAccessSnapshotDuration, lockAccessPolicies } from './access-policy.service';
import { resolveAccessApprovalPlan, assertAccessGrantApproversCurrent } from './access-approval.service';
import { formatAccessRequest, formatAccessGrant, formatPermissionPolicy, formatReviewItem } from './access-formatters';
import { assertNoOverlappingAccessRequest } from './access-reservations.service';
export { assertNoOverlappingAccessRequest } from './access-reservations.service';
export { revokeAccessGrant, revokeAccessGrantItem, retryAccessRequestProvision, runAccessGrantLifecycle } from './access-grants.service';
export { getAccessReviewOptions, createAccessReviewCampaign, listReviewCampaigns, listReviewItems, decideReviewItem, retryAccessReviewCampaign, assignAccessReviewCampaign } from './access-review.service';
import type { UpdatePermissionPolicyInput } from '@zenith/shared/identity';
import { accessPermissionCount } from '@zenith/shared/identity';

function parseRequiredDate(value: string, label: string): Date {
  const parsed = parseDateTimeInput(value);
  if (!parsed) throw new HTTPException(400, { message: `${label}格式不正确` });
  return parsed;
}

async function resolveRequestItems(roleSelections: AccessWorkflowInput['roleSelections'], permissionCodes: string[], tenantId: number | null, executor: DbExecutor = db) {
  const roleIds = [...new Set(roleSelections.map(selection => selection.roleId))];
  const roleRows = roleIds.length ? await executor.query.roles.findMany({
    where: and(inArray(roles.id, roleIds), exactTenantCondition(roles.tenantId, tenantId), eq(roles.status, 'enabled')),
    with: { deptScopes: true },
  }) : [];
  if (roleRows.length !== roleIds.length) throw new HTTPException(400, { message: '存在无效或停用的角色包' });
  const selected: Array<{ permissionCode: string; permissionLabel: string; dataScope: DataScope; deptScopeIds: number[]; sourceRefs: AccessSourceRef[] }> = [];
  for (const role of roleRows) {
    if (['super_admin', 'tenant_admin', 'security_admin'].includes(role.code)) throw new HTTPException(400, { message: '管理身份不能作为自助权限包申请' });
    if (roleSelections.some(selection => selection.roleId === role.id && selection.version !== role.permissionVersion)) throw new HTTPException(409, { message: '角色权限包已发布新版本，请刷新后重新选择' });
    for (const permissionCode of role.permissionCodes) selected.push({ permissionCode, permissionLabel: ALL_PERMISSIONS[permissionCode]?.label ?? permissionCode,
      dataScope: role.dataScope, deptScopeIds: role.deptScopes.map(item => item.deptId), sourceRefs: [{ kind: 'role', roleId: role.id, roleVersion: role.permissionVersion, label: role.name }] });
  }
  for (const permissionCode of [...new Set(permissionCodes)]) selected.push({ permissionCode, permissionLabel: ALL_PERMISSIONS[permissionCode]?.label ?? permissionCode,
    dataScope: 'self', deptScopeIds: [], sourceRefs: [{ kind: 'direct', label: '直接申请' }] });
  const codes = [...new Set(selected.map(item => item.permissionCode))];
  const available = new Set(await availablePermissionCodes(codes, tenantId, executor));
  if (codes.some(code => !available.has(code))) throw new HTTPException(400, { message: '权限不存在或超出当前租户套餐范围' });
  const items = mergeAccessPermissionItems(selected).map(item => ({ ...item,
    itemType: item.sourceRefs.some(source => source.kind === 'direct') ? 'permission' as const : 'role' as const,
    roleId: item.sourceRefs.length === 1 ? item.sourceRefs[0].roleId ?? null : null,
    snapshot: { permissionLabel: item.permissionLabel, sourceRefs: item.sourceRefs },
  }));
  return { items };
}

export async function getAccessWorkflowOptions() {
  const user = currentUser();
  const featureSet = await getTenantPackageFeatureSet(user.tenantId);
  const [roleRows, menuRows] = await Promise.all([
    db.query.roles.findMany({
      where: and(eq(roles.status, 'enabled'), exactTenantCondition(roles.tenantId, user.tenantId)),

      orderBy: [asc(roles.name), asc(roles.id)],
    }),
    db.select({ id: menus.id, parentId: menus.parentId, title: menus.title, name: menus.name, type: menus.type, permission: menus.permission, status: menus.status, featureKey: menus.featureKey })
      .from(menus).where(eq(menus.status, 'enabled')).orderBy(asc(menus.parentId), asc(menus.sort), asc(menus.id)),
  ]);
  const effective = await loadEffectiveAccessPolicies(menuRows.flatMap(menu => menu.permission && ALL_PERMISSIONS[menu.permission] ? [menu.permission] : []), user.tenantId);
  const policies = new Map(effective.map(policy => [policy.permissionCode, policy]));
  const roleOptions = roleRows.flatMap(role => {
    if (['super_admin', 'tenant_admin', 'security_admin'].includes(role.code)) return [];
    const codes = role.permissionCodes;
    const rolePolicies = codes.flatMap(code => { const policy = policies.get(code); return policy ? [policy] : []; });
    if (!rolePolicies.length || rolePolicies.length !== codes.length || rolePolicies.some(policy => !policy.enabled)) return [];
    return [{ id: role.id, name: role.name, code: role.code, description: role.description ?? null, dataScope: role.dataScope, version: role.permissionVersion, permissionCount: codes.length, permissionCodes: codes, ...aggregateAccessPolicies(rolePolicies) }];
  });
  const available = menuRows.filter(menu => !featureSet || !menu.featureKey || featureSet.has(menu.featureKey));
  const menuIndex = new Map(available.map(menu => [menu.id, menu]));
  const included = new Set<number>();
  for (const menu of available) {
    if (!menu.permission || !policies.get(menu.permission)?.enabled) continue;
    let node: typeof menu | undefined = menu;
    const visited = new Set<number>();
    while (node && !visited.has(node.id)) {
      visited.add(node.id);
      included.add(node.id);
      node = menuIndex.get(node.parentId);
    }
  }
  return {
    roles: roleOptions,
    menus: available.filter(menu => included.has(menu.id)).map(menu => {
      const policy = menu.permission ? policies.get(menu.permission) : undefined;
      const path = [menu.title];
      let ancestor = menuIndex.get(menu.parentId);
      const visited = new Set([menu.id]);
      while (ancestor && !visited.has(ancestor.id)) {
        visited.add(ancestor.id);
        path.unshift(ancestor.title);
        ancestor = menuIndex.get(ancestor.parentId);
      }
      return {
        id: menu.id, parentId: menu.parentId, title: menu.title, name: menu.name ?? null, type: menu.type, permission: menu.permission,
        permissionLabel: menu.permission ? ALL_PERMISSIONS[menu.permission]?.label ?? menu.title : null,
        requestable: !!policy?.enabled, path,
        riskLevel: policy?.riskLevel ?? 'low', approvalPolicy: policy?.approvalPolicy ?? 'none',
        maxDurationMinutes: policy?.maxDurationMinutes ?? null, mfaRequired: policy?.mfaRequired ?? false,
        permanentAllowed: policy?.permanentAllowed ?? false, emergencyAllowed: policy?.emergencyAllowed ?? false, maxEmergencyMinutes: policy?.maxEmergencyMinutes ?? 60,
      };
    }),
  };
}

export async function listAccessRequests(q: QueryOutputOf<typeof accessGovernanceContract.requestList>, mine = false) {
  const user = currentUser();
  const where = buildWhere(
    mine ? undefined : tenantCondition(identityAccessRequests, user),
    mine ? eq(identityAccessRequests.applicantUserId, user.userId) : undefined,
    keywordCondition(q.keyword, [identityAccessRequests.reason]),
    q.status ? eq(identityAccessRequests.status, q.status) : undefined,
    q.provisionStatus ? eq(identityAccessRequests.provisionStatus, q.provisionStatus) : undefined,
    q.riskLevel ? eq(identityAccessRequests.riskLevel, q.riskLevel) : undefined,
    q.targetUserId ? eq(identityAccessRequests.targetUserId, q.targetUserId) : undefined,
    ...dateRangeConditions(identityAccessRequests.createdAt, q.startTime, q.endTime),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(identityAccessRequests, where),
    rows: async () => db.query.identityAccessRequests.findMany({
      where,
      with: { applicant: true, target: true, items: true },
      orderBy: [desc(identityAccessRequests.createdAt), desc(identityAccessRequests.id)],
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
    map: formatAccessRequest,
  });
}

export async function getAccessRequest(id: number): Promise<AccessRequest> {
  const row = await db.query.identityAccessRequests.findFirst({
    where: and(eq(identityAccessRequests.id, id), tenantCondition(identityAccessRequests, currentUser())),
    with: { applicant: true, target: true, items: true },
  });
  return formatAccessRequest(requireRow(row, '权限申请不存在'));
}

type AccessWorkflowCaller = { userId: number; username: string; tenantId: number | null; roles?: string[]; viewingTenantId?: number | null };

async function enrichAccessWorkflowFormData(input: AccessWorkflowInput, caller: AccessWorkflowCaller, executor: DbExecutor) {
  if (caller.viewingTenantId != null && caller.viewingTenantId !== caller.tenantId) throw new HTTPException(409, { message: '平台查看模式不能代他人申请，请切换至所属租户的真实账号' });
  const resolved = await resolveRequestItems(input.roleSelections, input.permissionCodes, caller.tenantId, executor);
  if (resolved.items.length === 0) throw new HTTPException(400, { message: '至少申请一项有效权限' });
  const permissionCodes = resolved.items.flatMap(item => item.permissionCode ? [item.permissionCode] : []);
  if (!permissionCodes.length) throw new HTTPException(400, { message: '请选择至少一项实际操作权限' });
  const policySnapshot = await loadEffectiveAccessPolicies(permissionCodes, caller.tenantId, executor);
  const forbidden = policySnapshot.find(policy => !policy.enabled);
  if (forbidden) throw new HTTPException(400, { message: `权限 ${forbidden.permissionCode} 不允许自助申请或已被策略停用` });
  const effective = aggregateAccessPolicies(policySnapshot);
  const approvalPlan = await resolveAccessApprovalPlan(caller.userId, caller.tenantId, effective.approvalPolicy, effective.mfaRequired, executor);
  const target = requireRow(await executor.query.users.findFirst({ where: and(eq(users.id, caller.userId), exactTenantCondition(users.tenantId, caller.tenantId), eq(users.status, 'enabled')), columns: { departmentId: true } }), '申请人不存在或已停用');
  const names = await resolveUserNames([caller.userId], executor);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    userId: caller.userId, tenantId: caller.tenantId, departmentId: target.departmentId,
    requestType: input.requestType, startMode: input.startMode, startsAt: input.startMode === 'scheduled' ? input.startsAt : null,
    validityMode: input.validityMode, expiresAt: input.expiresAt,
    items: [...resolved.items].sort((a, b) => `${a.permissionCode}:${a.scopeKey}`.localeCompare(`${b.permissionCode}:${b.scopeKey}`)).map(item => ({
      permissionCode: item.permissionCode, scopeKey: item.scopeKey,
      sources: item.sourceRefs.map(source => [source.kind, source.roleId ?? null, source.roleVersion ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    })),
    policies: policySnapshot, approvalPlan,
  })).digest('hex');
  return {
    ...input,
    previewFingerprint: fingerprint,
    targetUserId: caller.userId,
    targetUserName: names.get(caller.userId) ?? caller.username,
    riskLevel: effective.riskLevel,
    riskLabel: ({ low: '普通', high: '高危', critical: '极高危' } as const)[effective.riskLevel],
    approvalPolicy: effective.approvalPolicy,
    mfaRequired: effective.mfaRequired,
    maxDurationMinutes: effective.maxDurationMinutes,
    permanentAllowed: effective.permanentAllowed, emergencyAllowed: effective.emergencyAllowed, maxEmergencyMinutes: effective.maxEmergencyMinutes,
    policySnapshot,
    approvalPlan,
    permissionItems: resolved.items,
    permissionSummary: resolved.items.map(item => `${item.permissionLabel ?? item.permissionCode}（${item.permissionCode}）`).join('、'),
    managerId: approvalPlan.steps.find(step => step.nodeKey === 'approve_manager')?.userId,
    securityApproverId: approvalPlan.steps.find(step => step.nodeKey === 'approve_security')?.userId,
    secondSecurityApproverId: approvalPlan.steps.find(step => step.nodeKey === 'approve_second_security')?.userId,
  };
}

export async function previewAccessWorkflowFormData(raw: Record<string, unknown>, caller: AccessWorkflowCaller) {
  if (!Array.isArray(raw.roleSelections) || !raw.roleSelections.length) {
    if (!Array.isArray(raw.permissionCodes) || !raw.permissionCodes.length) throw new HTTPException(409, { message: '请选择权限后查看实际审批计划' });
  }
  return normalizeAccessWorkflowFormData({ ...raw, reason: '预览权限申请' }, caller, db, false);
}

export async function evaluateAccessWorkflow(raw: Record<string, unknown>, caller: AccessWorkflowCaller = currentUser()): Promise<AccessWorkflowPreview> {
  if ((!Array.isArray(raw.roleSelections) || !raw.roleSelections.length) && (!Array.isArray(raw.permissionCodes) || !raw.permissionCodes.length)) {
    return { status: 'selection_required', message: '请选择角色包或操作权限，系统将据此计算实际审批计划' };
  }
  try {
    const form = await previewAccessWorkflowFormData(raw, caller);
    return { status: 'ready', fingerprint: form.previewFingerprint, approvalPlan: form.approvalPlan, policies: form.policySnapshot,
      permissionCount: accessPermissionCount(form.permissionItems), grantItemCount: form.permissionItems.length };
  } catch (error) {
    if (error instanceof HTTPException && error.status < 500) return { status: 'blocked', message: error.message };
    throw error;
  }
}

export async function normalizeAccessWorkflowFormData(raw: Record<string, unknown>, caller: AccessWorkflowCaller, executor: DbExecutor = db, requirePreview = true) {
  if (executor !== db) await lockAccessPolicies(executor);
  const parsed = accessWorkflowInputSchema.safeParse(raw);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? '权限申请表单不完整' });
  const input = parsed.data;
  const now = new Date();
  const startsAt = input.startMode === 'immediate' ? now : parseRequiredDate(input.startsAt!, '生效时间');
  const expiresAt = input.validityMode === 'permanent' ? null : parseRequiredDate(input.expiresAt!, '失效时间');
  if (input.startMode === 'scheduled' && startsAt < now) throw new HTTPException(400, { message: '预约生效时间不能早于当前时间' });
  if (expiresAt && expiresAt <= now) throw new HTTPException(400, { message: '失效时间必须晚于当前时间' });
  if (expiresAt && expiresAt <= startsAt) throw new HTTPException(400, { message: '失效时间必须晚于生效时间' });
  const enriched = await enrichAccessWorkflowFormData(input, caller, executor);
  if (requirePreview && input.previewFingerprint !== enriched.previewFingerprint) throw new HTTPException(409, { message: '权限、策略或审批人已变化，请刷新预览并确认后重新提交' });
  if (input.validityMode === 'permanent' && !enriched.permanentAllowed) throw new HTTPException(400, { message: '所选权限策略不允许永久授权' });
  if (input.requestType === 'emergency' && (!enriched.emergencyAllowed || input.validityMode === 'permanent')) throw new HTTPException(400, { message: '所选权限不支持紧急授权或紧急永久授权' });

  if (input.requestType === 'emergency' && expiresAt && expiresAt.getTime() - startsAt.getTime() > enriched.maxEmergencyMinutes * 60_000) throw new HTTPException(400, { message: `紧急授权最长 ${enriched.maxEmergencyMinutes} 分钟` });
  if (expiresAt && enriched.maxDurationMinutes !== null && expiresAt.getTime() - startsAt.getTime() > enriched.maxDurationMinutes * 60_000) throw new HTTPException(400, { message: `限时申请超过策略配置的 ${enriched.maxDurationMinutes} 分钟，请调整截止时间或选择永久有效` });
  await assertNoOverlappingAccessRequest({
    targetUserId: caller.userId,
    tenantId: caller.tenantId,
    startsAt,
    expiresAt,
    items: enriched.permissionItems,
  }, executor);
  return {
    ...enriched,
    requestInput: input,
    startsAt: formatDateTime(startsAt),
    expiresAt: expiresAt ? formatDateTime(expiresAt) : null,
  };
}


export async function applyApprovedAccessRequest(requestId: number, expected: { workflowInstanceId: number; tenantId: number | null; approvedBy: number | null }): Promise<AccessGrant | null> {
  const result = await taskTransaction(async (tx) => {
    await requireApprovedBusiness(tx, expected.workflowInstanceId, expected.tenantId, ACCESS_REQUEST_BIZ_TYPE, String(requestId));
    const where = buildWhere(eq(identityAccessRequests.id, requestId), exactTenantCondition(identityAccessRequests.tenantId, expected.tenantId));
    const [locked] = await tx.select({ id: identityAccessRequests.id }).from(identityAccessRequests).where(where).for('update').limit(1);
    if (!locked) throw new Error('权限申请不存在或不属于当前作业租户');
    const request = await tx.query.identityAccessRequests.findFirst({ where, with: { items: true } });
    if (!request) return null;
    if (request.provisionStatus === 'succeeded') {
      const existing = await tx.query.identityAccessGrants.findFirst({ where: eq(identityAccessGrants.requestId, requestId), with: { user: true, approver: true, revoker: true, items: true } });
      return existing ? formatAccessGrant(existing) : null;
    }
    if (request.status !== 'approved' || request.provisionStatus === 'terminated') return null;
    if (!request.workflowInstanceId || expected.workflowInstanceId !== request.workflowInstanceId) throw new Error('权限申请流程关联无效');
    await assertAccessSnapshotDuration(request.policySnapshot, request.startsAt, request.expiresAt, request.tenantId, tx);
    const approvers = new Set(request.approvalEvidence.map(evidence => evidence.actorId));
    if (approvers.has(request.targetUserId) || approvers.size !== request.approvalEvidence.length || request.approvalPlan.steps.some(step => !request.approvalEvidence.some(evidence => evidence.nodeKey === step.nodeKey && (!request.approvalPlan.mfaRequired || evidence.mfaVerifiedAt !== null)))) throw new HTTPException(409, { message: '权限审批计划尚未完整履行' });
    await assertAccessGrantApproversCurrent(tx, request);
    const target = await tx.query.users.findFirst({ where: and(eq(users.id, request.targetUserId), exactTenantCondition(users.tenantId, request.tenantId), eq(users.status, 'enabled')), columns: { id: true, nickname: true, username: true } });
    if (!target) throw new HTTPException(409, { message: '权限申请受益用户已经停用' });
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-access:${request.tenantId ?? 'platform'}:${request.targetUserId}`}, 0))`);
    await assertNoOverlappingAccessRequest({ targetUserId: request.targetUserId, tenantId: request.tenantId, startsAt: request.startsAt, expiresAt: request.expiresAt, items: request.items, excludeRequestId: request.id }, tx);
    const now = new Date();
    const status: AccessGrant['status'] = request.startsAt > now ? 'scheduled' : 'active';
    const [grant] = await tx.insert(identityAccessGrants).values({
      tenantId: request.tenantId,
      userId: request.targetUserId,
      requestId: request.id,
      sourceType: request.requestType === 'emergency' ? 'emergency' : 'request',
      status,
      riskLevel: request.riskLevel,
      startsAt: request.startsAt,
      expiresAt: request.expiresAt,
      approvedBy: expected.approvedBy,
      approvedAt: request.approvedAt,
      snapshot: { requestId: request.id, workflowInstanceId: request.workflowInstanceId },
    }).returning();
    const menuItems = mergeAccessPermissionItems(request.items).map(item => {
      const policy = request.policySnapshot.find(snapshot => snapshot.permissionCode === item.permissionCode);
      if (!policy) throw new Error('授权项缺少对应的策略快照');
      return { ...item, grantId: grant.id, status, startsAt: request.startsAt, expiresAt: request.expiresAt, policySnapshot: policy,
        nextReviewAt: policy.reviewIntervalDays > 0 ? new Date(now.getTime() + policy.reviewIntervalDays * 86_400_000) : null };
    });
    if (menuItems.length > 0) await tx.insert(identityAccessGrantItems).values(menuItems).onConflictDoNothing();
    await tx.update(identityAccessRequests).set({ status: 'approved', provisionStatus: 'succeeded', approvedAt: request.approvedAt ?? now, appliedAt: now, failureReason: null }).where(eq(identityAccessRequests.id, request.id));
    await notifyWithin(tx, 'identity.access.approved', { recipients: [{ type: 'user', id: target.id }], vars: { requestId: request.id, targetName: target.nickname || target.username, startsAt: formatDateTime(request.startsAt), expiresAt: request.expiresAt ? formatDateTime(request.expiresAt) : '永久有效', validityText: request.expiresAt ? `${formatDateTime(request.startsAt)} 至 ${formatDateTime(request.expiresAt)}` : `自 ${formatDateTime(request.startsAt)} 起永久有效` }, tenantId: request.tenantId, link: `/workflow/instance/${request.workflowInstanceId}`, dedupeKey: `identity-access-approved:${request.id}` });
    const applied = await tx.query.identityAccessGrants.findFirst({ where: eq(identityAccessGrants.id, grant.id), with: { user: true, approver: true, revoker: true, items: true } });
    return applied ? formatAccessGrant(applied) : null;
  });
  const grantUserId = result?.userId;
  if (grantUserId) await notifyUserPermissionsChanged(grantUserId);
  return result;
}

export async function listAccessGrants(q: QueryOutputOf<typeof accessGovernanceContract.grantList>, mine = false) {
  const user = currentUser();
  const now = new Date();
  const live = inArray(identityAccessGrants.status, ['scheduled', 'active']);
  const statusWhere = q.status === 'revoked' ? eq(identityAccessGrants.status, 'revoked')
    : q.status === 'expired' ? or(eq(identityAccessGrants.status, 'expired'), and(live, lte(identityAccessGrants.expiresAt, now)))
    : q.status === 'scheduled' ? and(live, gt(identityAccessGrants.startsAt, now), or(isNull(identityAccessGrants.expiresAt), gt(identityAccessGrants.expiresAt, now)))
    : q.status === 'active' ? and(live, lte(identityAccessGrants.startsAt, now), or(isNull(identityAccessGrants.expiresAt), gt(identityAccessGrants.expiresAt, now))) : undefined;
  const where = buildWhere(
    mine ? undefined : tenantCondition(identityAccessGrants, user),
    q.keyword ? or(exists(db.select({ id: users.id }).from(users).where(and(eq(users.id, identityAccessGrants.userId), keywordCondition(q.keyword, [users.username, users.nickname])))),
      exists(db.select({ id: identityAccessGrantItems.id }).from(identityAccessGrantItems).where(and(eq(identityAccessGrantItems.grantId, identityAccessGrants.id), keywordCondition(q.keyword, [identityAccessGrantItems.permissionCode, identityAccessGrantItems.permissionLabel]))))) : undefined,
    statusWhere,
    q.riskLevel ? eq(identityAccessGrants.riskLevel, q.riskLevel) : undefined,
    mine ? eq(identityAccessGrants.userId, user.userId) : q.userId ? eq(identityAccessGrants.userId, q.userId) : undefined,
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(identityAccessGrants, where),
    rows: async () => db.query.identityAccessGrants.findMany({
      where,
      with: { user: true, approver: true, revoker: true, items: true },
      orderBy: [desc(identityAccessGrants.createdAt), desc(identityAccessGrants.id)],
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
    map: formatAccessGrant,
  });
}

export async function getAccessGrant(id: number): Promise<AccessGrant> {
  const row = await db.query.identityAccessGrants.findFirst({
    where: and(eq(identityAccessGrants.id, id), tenantCondition(identityAccessGrants, currentUser())),
    with: { user: true, approver: true, revoker: true, items: true },
  });
  return formatAccessGrant(requireRow(row, '临时授权不存在'));
}

export async function listPermissionPolicies(q: QueryOutputOf<typeof accessGovernanceContract.policyList>) {
  const tenantId = getCreateTenantId(currentUser());
  const entries = await readAccessPolicySet(Object.keys(ALL_PERMISSIONS), tenantId);
  const keyword = q.keyword?.toLowerCase();
  // 该视图由有界的代码目录与租户覆盖组合，筛选必须针对最终生效值。
  const rows = entries.map(({ policy, record }) => formatPermissionPolicy(policy, record, tenantId)).filter(row => (!keyword || row.permissionCode.toLowerCase().includes(keyword)) && (!q.riskLevel || row.riskLevel === q.riskLevel) && (!q.approvalPolicy || row.approvalPolicy === q.approvalPolicy));
  return buildListResult({ page: q.page, pageSize: q.pageSize, count: async () => rows.length, rows: async () => rows.slice(pageOffset(q.page, q.pageSize), pageOffset(q.page, q.pageSize) + q.pageSize) });
}

export async function updatePermissionPolicy(permissionCode: string, input: UpdatePermissionPolicyInput): Promise<PermissionPolicy> {
  assertPermissionPolicyUpdate(permissionCode, input);
  const tenantId = getCreateTenantId(currentUser());
  return db.transaction(async tx => {
  await lockAccessPolicies(tx);
  const [previous] = await readAccessPolicySet([permissionCode], tenantId, tx);
  setAuditBefore(formatPermissionPolicy(previous.policy, previous.record, tenantId));
  const [saved] = await tx.insert(identityPermissionPolicies).values({ permissionCode, tenantId, ...input })
    .onConflictDoUpdate({ target: [identityPermissionPolicies.permissionCode, identityPermissionPolicies.tenantId],
      set: { ...input, version: sql`${identityPermissionPolicies.version} + 1`, updatedAt: new Date() },
      setWhere: sql`row(${identityPermissionPolicies.riskLevel}, ${identityPermissionPolicies.approvalPolicy}, ${identityPermissionPolicies.maxDurationMinutes}, ${identityPermissionPolicies.reviewIntervalDays}, ${identityPermissionPolicies.mfaRequired}, ${identityPermissionPolicies.enabled}, ${identityPermissionPolicies.permanentAllowed}, ${identityPermissionPolicies.emergencyAllowed}, ${identityPermissionPolicies.maxEmergencyMinutes}) is distinct from row(${input.riskLevel}::identity_access_risk_level, ${input.approvalPolicy}::identity_access_approval_policy, ${input.maxDurationMinutes}::integer, ${input.reviewIntervalDays}::integer, ${input.mfaRequired}::boolean, ${input.enabled}::boolean, ${input.permanentAllowed}::boolean, ${input.emergencyAllowed}::boolean, ${input.maxEmergencyMinutes}::integer)`,
    }).returning();
  const row = saved ?? requireRow(await tx.query.identityPermissionPolicies.findFirst({ where: and(eq(identityPermissionPolicies.permissionCode, permissionCode), exactTenantCondition(identityPermissionPolicies.tenantId, tenantId)) }), '权限策略不存在');
  const baseline = accessPolicyBaseline(permissionCode, ALL_PERMISSIONS[permissionCode]);
  return formatPermissionPolicy(effectiveAccessPolicy(baseline, row), row, tenantId);
  });
}

export async function getUserAccessOverview(userId: number) {
  await requireTenantUser(userId, '用户不存在');
  const [grants, reviews] = await Promise.all([
    db.query.identityAccessGrants.findMany({ where: and(eq(identityAccessGrants.userId, userId), tenantCondition(identityAccessGrants, currentUser())), with: { user: true, approver: true, revoker: true, items: true }, orderBy: [desc(identityAccessGrants.createdAt)] }),
    db.query.identityAccessReviewItems.findMany({ where: and(eq(identityAccessReviewItems.userId, userId), tenantCondition(identityAccessReviewItems, currentUser())), with: { user: true }, orderBy: [desc(identityAccessReviewItems.createdAt)] }),
  ]);
  return { userId, grants: grants.map(formatAccessGrant), reviews: reviews.map(formatReviewItem) };
}

/** Minimal business references for application-level reconciliation. */
export async function listUnsettledAccessApprovals() {
  return db.select({ workflowInstanceId: identityAccessRequests.workflowInstanceId, tenantId: identityAccessRequests.tenantId }).from(identityAccessRequests)
    .where(and(inArray(identityAccessRequests.status, ['pending', 'approved']), inArray(identityAccessRequests.provisionStatus, ['not_started', 'pending', 'running'])));
}
