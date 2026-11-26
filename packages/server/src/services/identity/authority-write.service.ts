import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { Permission } from '@zenith/shared/core';
import { accessScopeKey } from '@zenith/shared/identity';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { users, roles, userRoles, roleMenus, userGroups, userGroupRoles, userGroupMembers, identityRoleVersions, identityUserPermissions } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { exactTenantCondition } from '../../lib/tenant';
import { getUserEffectiveAccess, runWithFreshUserPermissions } from '../../lib/permissions';
import { loadEffectiveAccessPolicies } from './access-policy.service';
import { getDataScopeCondition } from '../../lib/data-scope';
import { availableNavigation, getPageReadCode, isPermissionAvailable, readPageAccessRows } from '../../lib/page-access';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';

/** All authority writers use the same tenant lock, including automatic provisioning. */
export async function lockIdentityAuthority(tx: DbExecutor, tenantId: number | null) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-authority:${tenantId ?? 'platform'}`}, 0))`);
}

export async function assertAuthorityActor(tx: DbExecutor, tenantId: number | null, permission: Permission, beneficiaryIds: readonly number[] = []) {
  await lockIdentityAuthority(tx, tenantId);
  const actor = currentUser();
  const account = await tx.query.users.findFirst({
    where: and(eq(users.id, actor.userId), eq(users.status, 'enabled')),
    columns: { id: true, tenantId: true },
    with: { userRoles: { with: { role: { columns: { code: true, status: true, tenantId: true } } } } },
  });
  if (!account) throw new HTTPException(403, { message: '当前身份已失效，不能修改权限' });
  const platform = account.tenantId === null && account.userRoles.some(({ role }) => role.code === 'super_admin' && role.tenantId === null && role.status === 'enabled');
  if (!platform && account.tenantId !== tenantId) throw new HTTPException(403, { message: '不能跨租户修改身份权限' });
  const access = await runWithFreshUserPermissions(actor.userId, () => getUserEffectiveAccess(actor.userId), tx);
  const owned = access.permissions;
  if (!platform && !owned.includes(permission)) throw new HTTPException(403, { message: '没有当前权限变更的管理能力' });
  if (beneficiaryIds.length) {
    const scope = platform ? undefined : await getDataScopeCondition({ currentUserId: actor.userId, permissions: [permission], executor: tx, deptColumn: users.departmentId, ownerColumn: users.id });
    const ids = [...new Set(beneficiaryIds)];
    const targets = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), exactTenantCondition(users.tenantId, tenantId), scope));
    if (targets.length !== ids.length) throw new HTTPException(403, { message: '受益用户超出当前管理范围' });
  }
  return { platform, owned, pageIds: access.menuIds };
}

/** Profile changes permit self editing, but still require a live, current capability. */
export async function assertProfileActor(tx: DbExecutor, tenantId: number | null, userId: number) {
  return assertAuthorityActor(tx, tenantId, 'system:user:update', [userId]);
}

export async function assertGrantableRoles(tx: DbExecutor, roleIds: readonly number[], tenantId: number | null) {
  const ids = [...new Set(roleIds)];
  if (!ids.length) return [];
  const rows = await tx.query.roles.findMany({ where: and(inArray(roles.id, ids), exactTenantCondition(roles.tenantId, tenantId), eq(roles.status, 'enabled')),
    with: { roleMenus: { columns: { menuId: true } } } });
  if (rows.length !== ids.length) throw new HTTPException(400, { message: '角色不存在、已停用或不属于目标租户' });
  return rows;
}

/** A role code alone is never sufficient to authorize automated onboarding. */
export async function assertAutomaticRolesAllowed(tx: DbExecutor, roleIds: readonly number[], tenantId: number | null) {
  await lockIdentityAuthority(tx, tenantId);
  const rows = await assertGrantableRoles(tx, roleIds, tenantId);
  if (rows.some(role => ['super_admin', 'tenant_admin', 'security_admin'].includes(role.code))) throw new HTTPException(403, { message: '自动配置不允许授予管理身份' });
  const { codes } = await validateGrantScope(tx, tenantId, rows.flatMap(role => role.roleMenus.map(page => page.menuId)), rows.flatMap(role => role.permissionCodes));
  const policies = await loadEffectiveAccessPolicies(codes, tenantId, tx);
  if (policies.some(policy => policy.riskLevel !== 'low' || !policy.enabled || policy.mfaRequired)) throw new HTTPException(403, { message: '自动配置仅允许审定的基础权限，高危或治理能力须独立授予' });
  return rows;
}

/** Validate both sides of a grant against the same target tenant. */
export async function validateGrantScope(tx: DbExecutor, tenantId: number | null, menuIds: readonly number[], explicitCodes: readonly string[]) {
  const ids = [...new Set(menuIds)];
  const [features, navigation] = await Promise.all([
    getTenantPackageFeatureSet(tenantId, tx),
    ids.length ? readPageAccessRows(tx) : [],
  ]);
  const candidates = new Map(availableNavigation(navigation, features, tenantId === null).map(page => [page.id, page]));
  const pages = ids.map(id => {
    const page = candidates.get(id);
    if (page?.type !== 'menu') throw new HTTPException(400, { message: '页面不存在、已停用或超出租户套餐范围' });
    return page;
  });
  const codes = [...new Set([...explicitCodes, ...pages.flatMap(page => getPageReadCode(page) ?? [])])];
  for (const code of codes) {
    if (!Object.hasOwn(ALL_PERMISSIONS, code)) throw new HTTPException(400, { message: `权限目录未登记 ${code}` });
    if (!isPermissionAvailable(code, features)) throw new HTTPException(400, { message: `权限 ${code} 超出租户套餐范围` });
  }
  return { pages, codes };
}

export async function assertAuthorityGrant(tx: DbExecutor, input: { tenantId: number | null; permission: Permission; beneficiaryIds?: readonly number[]; roleIds?: readonly number[]; menuIds?: readonly number[]; permissionCodes?: readonly string[] }) {
  const actor = await assertAuthorityActor(tx, input.tenantId, input.permission, input.beneficiaryIds);
  const roleRows = await assertGrantableRoles(tx, input.roleIds ?? [], input.tenantId);
  const { pages, codes } = await validateGrantScope(tx, input.tenantId,
    [...(input.menuIds ?? []), ...roleRows.flatMap(role => role.roleMenus.map(page => page.menuId))],
    [...(input.permissionCodes ?? []), ...roleRows.flatMap(role => role.permissionCodes)]);
  if (!actor.platform) {
    const policies = await loadEffectiveAccessPolicies(codes, input.tenantId, tx);
    if (roleRows.some(role => ['super_admin', 'tenant_admin', 'security_admin'].includes(role.code))) throw new HTTPException(403, { message: '管理身份只能由平台管理员任命' });
    if (policies.some(policy => policy.riskLevel !== 'low' || !policy.enabled)) throw new HTTPException(409, { message: '高危或治理能力不能通过普通直授获得，请使用独立审批或管理员任命' });
    if (codes.some(code => !actor.owned.includes(code))) throw new HTTPException(403, { message: '所授予的能力超出当前管理员可委派范围' });
    if (pages.some(page => !actor.pageIds.includes(page.id))) throw new HTTPException(403, { message: '所授予的页面超出当前管理员可委派范围' });
  }
}

export async function roleBeneficiaries(tx: DbExecutor, roleId: number): Promise<number[]> {
  const direct = await tx.select({ id: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, roleId));
  const grouped = await tx.select({ id: userGroupMembers.userId }).from(userGroupRoles)
    .innerJoin(userGroupMembers, eq(userGroupMembers.groupId, userGroupRoles.groupId)).where(eq(userGroupRoles.roleId, roleId));
  return [...new Set([...direct, ...grouped].map(row => row.id))];
}

/** The built-in platform admin must retain its direct super-admin binding. */
export async function assertUserRolesRemovable(tx: DbExecutor, userIds: readonly number[], roleIds: readonly number[]) {
  if (!userIds.length || !roleIds.length) return;
  const protectedBindings = await tx.select({ userId: users.id }).from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(inArray(userRoles.userId, [...userIds]), inArray(userRoles.roleId, [...roleIds]),
      isNull(users.tenantId), sql`lower(btrim(${users.username})) = 'admin'`,
      isNull(roles.tenantId), eq(roles.code, 'super_admin'))).limit(1);
  if (protectedBindings.length) throw new HTTPException(409, { message: '不能移除 admin 管理员用户的超级管理员角色' });
}

export async function replaceUserRoles(tx: DbExecutor, userId: number, roleIds: readonly number[], tenantId: number | null) {
  await lockIdentityAuthority(tx, tenantId);
  const previous = await tx.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, userId));
  const added = roleIds.filter(id => !previous.some(row => row.roleId === id));
  const removed = previous.map(row => row.roleId).filter(id => !roleIds.includes(id));
  await assertAuthorityGrant(tx, { tenantId, permission: 'system:user:assign', beneficiaryIds: [userId], roleIds: added });
  await assertUserRolesRemovable(tx, [userId], removed);
  if (removed.length) await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, removed)));
  if (added.length) await tx.insert(userRoles).values([...new Set(added)].map(roleId => ({ userId, roleId })));
}

export async function replaceRolePermissions(tx: DbExecutor, roleId: number, menuIds: readonly number[], permissionCodes: readonly string[], tenantId: number | null) {
  await lockIdentityAuthority(tx, tenantId);
  await assertAuthorityGrant(tx, { tenantId, permission: 'system:role:assign', beneficiaryIds: await roleBeneficiaries(tx, roleId), menuIds, permissionCodes });
  await tx.delete(roleMenus).where(eq(roleMenus.roleId, roleId));
  if (menuIds.length) await tx.insert(roleMenus).values([...new Set(menuIds)].map(menuId => ({ roleId, menuId })));
  await publishRoleVersion(tx, roleId, tenantId, permissionCodes, menuIds);
}

export async function publishRoleVersion(tx: DbExecutor, roleId: number, tenantId: number | null, codes?: readonly string[], menuIds?: readonly number[]) {
  await lockIdentityAuthority(tx, tenantId);
  const where = and(eq(roles.id, roleId), exactTenantCondition(roles.tenantId, tenantId));
  const role = await tx.query.roles.findFirst({ where, with: { deptScopes: true, roleMenus: { columns: { menuId: true } } } });
  if (!role) throw new HTTPException(404, { message: '角色不存在' });
  const permissionCodes = [...new Set(codes ?? role.permissionCodes)].sort();
  const navigation = [...new Set(menuIds ?? role.roleMenus.map(item => item.menuId))].sort((a, b) => a - b);
  const deptScopeIds = role.deptScopes.map(item => item.deptId).sort((a, b) => a - b);
  accessScopeKey(role.dataScope, deptScopeIds);
  const old = await tx.query.identityRoleVersions.findFirst({ where: and(eq(identityRoleVersions.roleId, roleId), eq(identityRoleVersions.version, role.permissionVersion)) });
  const snapshot = { permissionCodes, menuIds: navigation, dataScope: role.dataScope, deptScopeIds };
  const changed = old && JSON.stringify({ permissionCodes: old.permissionCodes, menuIds: old.menuIds, dataScope: old.dataScope, deptScopeIds: old.deptScopeIds }) !== JSON.stringify(snapshot);
  const version = role.permissionVersion + (changed ? 1 : 0);
  await tx.insert(identityRoleVersions).values({ roleId, version, ...snapshot }).onConflictDoNothing();
  const [published] = await tx.update(roles).set({ permissionCodes, permissionVersion: version }).where(where).returning();
  return published;
}

export async function replaceDirectPermissions(tx: DbExecutor, userId: number, menuIds: readonly number[], permissionCodes: readonly string[], tenantId: number | null) {
  await assertAuthorityGrant(tx, { tenantId, permission: 'system:user:assign', beneficiaryIds: [userId], menuIds, permissionCodes });
  const codes = [...new Set(permissionCodes)];
  const existing = await tx.query.identityUserPermissions.findMany({ where: eq(identityUserPermissions.userId, userId) });
  const removed = existing.filter(item => !codes.includes(item.permissionCode)).map(item => item.id);
  const added = codes.filter(code => !existing.some(item => item.permissionCode === code));
  if (removed.length) await tx.delete(identityUserPermissions).where(and(eq(identityUserPermissions.userId, userId), inArray(identityUserPermissions.id, removed)));
  if (added.length) await tx.insert(identityUserPermissions).values(added.map(permissionCode => ({ userId, permissionCode, dataScope: 'self' as const, deptScopeIds: [], scopeKey: accessScopeKey('self', []) })));
}

export async function replaceRoleMembers(tx: DbExecutor, roleId: number, userIds: readonly number[], tenantId: number | null) {
  await lockIdentityAuthority(tx, tenantId);
  const previous = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, roleId));
  const added = userIds.filter(id => !previous.some(row => row.userId === id));
  const removed = previous.map(row => row.userId).filter(id => !userIds.includes(id));
  await assertAuthorityGrant(tx, { tenantId, permission: 'system:role:assign', beneficiaryIds: [...added, ...removed], roleIds: added.length ? [roleId] : [] });
  await assertUserRolesRemovable(tx, removed, [roleId]);
  if (removed.length) await tx.delete(userRoles).where(and(eq(userRoles.roleId, roleId), inArray(userRoles.userId, removed)));
  if (added.length) await tx.insert(userRoles).values([...new Set(added)].map(userId => ({ roleId, userId })));
}

export async function replaceGroupRoleBindings(tx: DbExecutor, groupId: number, roleIds: readonly number[], tenantId: number | null) {
  await lockIdentityAuthority(tx, tenantId);
  const group = await tx.query.userGroups.findFirst({ where: and(eq(userGroups.id, groupId), exactTenantCondition(userGroups.tenantId, tenantId)), columns: { memberMode: true } });
  if (!group) throw new HTTPException(404, { message: '用户组不存在' });
  const members = await tx.select({ id: userGroupMembers.userId }).from(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
  await assertAuthorityGrant(tx, { tenantId, permission: 'system:user-groups:assign', beneficiaryIds: members.map(row => row.id), roleIds });
  if (group.memberMode === 'dynamic') await assertAutomaticRolesAllowed(tx, roleIds, tenantId);
  await tx.delete(userGroupRoles).where(eq(userGroupRoles.groupId, groupId));
  if (roleIds.length) await tx.insert(userGroupRoles).values([...new Set(roleIds)].map(roleId => ({ groupId, roleId })));
}

export async function replaceGroupMemberBindings(tx: DbExecutor, groupId: number, userIds: readonly number[], tenantId: number | null) {
  await lockIdentityAuthority(tx, tenantId);
  const before = await tx.select({ id: userGroupMembers.userId }).from(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
  const added = userIds.filter(id => !before.some(row => row.id === id));
  const bindings = await tx.select({ roleId: userGroupRoles.roleId }).from(userGroupRoles).where(eq(userGroupRoles.groupId, groupId));
  await assertAuthorityGrant(tx, { tenantId, permission: 'system:user-groups:assign', beneficiaryIds: added, roleIds: added.length ? bindings.map(row => row.roleId) : [] });
  await tx.delete(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
  if (userIds.length) await tx.insert(userGroupMembers).values([...new Set(userIds)].map(userId => ({ groupId, userId })));
}

export async function provisionUserRoles(tx: DbExecutor, userId: number, roleIds: readonly number[], tenantId: number | null) {
  await assertAutomaticRolesAllowed(tx, roleIds, tenantId);
  if (roleIds.length) await tx.insert(userRoles).values([...new Set(roleIds)].map(roleId => ({ userId, roleId }))).onConflictDoNothing();
}

export async function provisionBasicUser(tx: DbExecutor, userId: number, tenantId: number | null) {
  const role = await tx.query.roles.findFirst({ where: and(eq(roles.code, 'user'), exactTenantCondition(roles.tenantId, tenantId), eq(roles.status, 'enabled')), columns: { id: true } });
  if (role) await provisionUserRoles(tx, userId, [role.id], tenantId);
}

export async function assertAutomaticGroupMembership(tx: DbExecutor, groupId: number, tenantId: number | null) {
  const bindings = await tx.select({ roleId: userGroupRoles.roleId }).from(userGroupRoles).where(eq(userGroupRoles.groupId, groupId));
  await assertAutomaticRolesAllowed(tx, bindings.map(row => row.roleId), tenantId);
}

/** A read helper for the command UI; all writes recheck inside their transaction. */
export async function getRoleBeneficiaries(roleId: number) {
  return roleBeneficiaries(db, roleId);
}
