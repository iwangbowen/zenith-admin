import { HTTPException } from 'hono/http-exception';
import { and, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DRIVE_SUBJECT_TYPES, driveRoleAtLeast, type DriveRole, type DriveSubjectType } from '@zenith/shared/drive';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  departments,
  driveNodePermissions,
  driveNodes,
  driveSpaceMembers,
  driveSpaces,
  roles,
  userGroupRoles,
  userGroups,
  userRoles,
  users,
} from '../../db/schema';
import type { JwtPayload } from '../../middleware/auth';
import { currentUserOrNull, hasPermission, isSuperAdmin } from '../../lib/context';
import { getUserPermissions, isSuperAdmin as isSuperAdminUser } from '../../lib/permissions';
import { getUserEnabledGroupIds } from '../../lib/user-group-access';
import {
  EMPTY_SUBJECTS,
  computeNodeRole,
  computeSpaceRole,
  effectiveGrantNodeIds,
  rolesAtLeast,
  type DriveSubjectSet,
  type SpaceLike,
  type SpaceRoleContext,
} from './drive-acl';

export type { DriveSubjectSet } from './drive-acl';

/**
 * 企业网盘访问控制（DB 侧）。
 *
 * 有效角色 = 菜单 RBAC（路由层 guard 已校验）∧ computeNodeRole(空间角色, 节点 ACL)：
 * - 空间角色：personal 所有者 / department 部门（含子部门）成员与负责人 / team 显式成员或公开默认角色；
 * - 节点 ACL：自身 + 物化生效链 `acl_chain_ids` 上四类主体的授权，`acl_open=false` 时空间普通角色不透传；
 * - 空间 manager 与网盘管理员（`drive:admin:space:edit`）不受断点影响。
 *
 * 列表 / 搜索 / 子树操作统一用 {@link visibleNodeCondition} 在 SQL 中精确过滤，不再页内二次筛除。
 */

/** 网盘管理员权限码：持有者对全部空间视为 manager */
export const DRIVE_ADMIN_PERMISSION = 'drive:admin:space:edit';

// 按请求主体对象 memo：同一请求内多次解析只查一次库
const subjectCache = new WeakMap<JwtPayload, Promise<DriveSubjectSet>>();

export async function loadDriveSubjects(): Promise<DriveSubjectSet> {
  const user = currentUserOrNull();
  if (!user) return EMPTY_SUBJECTS;
  let pending = subjectCache.get(user);
  if (!pending) {
    pending = buildSubjects(user.userId, isSuperAdmin() ? Promise.resolve(true) : hasPermission(DRIVE_ADMIN_PERMISSION));
    subjectCache.set(user, pending);
  }
  return pending;
}

/**
 * 以任意用户身份构造主体集合（无需请求上下文）：外链按创建者视角裁剪子树、后台任务复核权限时使用。
 * 用户不存在返回空主体（任何节点都不可见）。
 */
export async function loadDriveSubjectsForUser(userId: number): Promise<DriveSubjectSet> {
  const [row] = await db.select({ id: users.id, tenantId: users.tenantId }).from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'enabled'))).limit(1);
  if (!row) return EMPTY_SUBJECTS;
  const roleCodes = await db.select({ code: roles.code }).from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(roles.status, 'enabled')));
  const isAdmin = isSuperAdminUser({ roles: roleCodes.map((r) => r.code), tenantId: row.tenantId ?? null })
    ? Promise.resolve(true)
    : getUserPermissions(userId).then((perms) => perms.includes(DRIVE_ADMIN_PERMISSION));
  return buildSubjects(userId, isAdmin);
}

async function buildSubjects(userId: number, isAdminPromise: Promise<boolean>): Promise<DriveSubjectSet> {
  const [userRow, directRoles, groupIds, isAdmin] = await Promise.all([
    db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ roleId: userRoles.roleId }).from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.status, 'enabled'))),
    getUserEnabledGroupIds(userId),
    isAdminPromise,
  ]);
  const groupRoles = groupIds.length
    ? await db.select({ roleId: userGroupRoles.roleId }).from(userGroupRoles)
      .innerJoin(roles, eq(roles.id, userGroupRoles.roleId))
      .innerJoin(userGroups, eq(userGroups.id, userGroupRoles.groupId))
      .where(and(inArray(userGroupRoles.groupId, groupIds), eq(roles.status, 'enabled'), eq(userGroups.status, 'enabled')))
    : [];
  const departmentId = userRow[0]?.departmentId ?? null;
  return {
    userId,
    user: new Set([userId]),
    department: new Set(departmentId ? await loadDepartmentChain(departmentId) : []),
    role: new Set([...directRoles.map((r) => r.roleId), ...groupRoles.map((r) => r.roleId)]),
    user_group: new Set(groupIds),
    departmentId,
    isAdmin,
  };
}

/** 部门及其全部上级部门 id（自下而上） */
export async function loadDepartmentChain(departmentId: number): Promise<number[]> {
  const rows = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments);
  const parents = new Map(rows.map((r) => [r.id, r.parentId]));
  const chain: number[] = [];
  const seen = new Set<number>();
  let cursor: number | undefined = departmentId;
  while (cursor && cursor > 0 && !seen.has(cursor) && parents.has(cursor)) {
    chain.push(cursor);
    seen.add(cursor);
    cursor = parents.get(cursor);
  }
  return chain;
}

/** 部门及其全部子部门 id（自上而下），供部门主体展开成员用 */
export async function loadDepartmentDescendants(departmentId: number): Promise<number[]> {
  const rows = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments);
  const result = [departmentId];
  const queue = [departmentId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const r of rows) {
      if (r.parentId === cur && !result.includes(r.id)) {
        result.push(r.id);
        queue.push(r.id);
      }
    }
  }
  return result;
}

/** (subjectType, subjectId) ∈ 当前用户主体集合 的 SQL 条件；无主体时恒 false */
export function subjectPairsCondition(
  table: { subjectType: PgColumn; subjectId: PgColumn },
  subjects: DriveSubjectSet,
): SQL {
  const parts: SQL[] = [];
  for (const type of DRIVE_SUBJECT_TYPES) {
    const ids = [...subjects[type]];
    if (ids.length) parts.push(and(eq(table.subjectType, type), inArray(table.subjectId, ids))!);
  }
  return parts.length ? or(...parts)! : sql`false`;
}

// ─── 空间角色 ─────────────────────────────────────────────────────────────────

async function loadSpaceContext(spaces: SpaceLike[], subjects: DriveSubjectSet, executor: DbExecutor = db): Promise<SpaceRoleContext> {
  const spaceIds = spaces.map((s) => s.id);
  const deptIds = spaces.map((s) => s.departmentId).filter((id): id is number => id != null);
  const [members, leaderDepts] = await Promise.all([
    spaceIds.length
      ? executor.select().from(driveSpaceMembers)
        .where(and(inArray(driveSpaceMembers.spaceId, spaceIds), subjectPairsCondition(driveSpaceMembers, subjects)))
      : Promise.resolve([]),
    deptIds.length
      ? executor.select({ id: departments.id }).from(departments)
        .where(and(inArray(departments.id, deptIds), eq(departments.leaderId, subjects.userId)))
      : Promise.resolve([]),
  ]);
  return { members, leaderDeptIds: new Set(leaderDepts.map((d) => d.id)) };
}

/** 批量解析当前用户在多个空间的角色 */
export async function resolveSpaceRoles(spaces: SpaceLike[], subjectsOverride?: DriveSubjectSet): Promise<Map<number, DriveRole | null>> {
  const subjects = subjectsOverride ?? await loadDriveSubjects();
  const ctx = await loadSpaceContext(spaces, subjects);
  return new Map(spaces.map((s) => [s.id, computeSpaceRole(s, subjects, ctx)]));
}

export async function resolveSpaceRole(space: SpaceLike): Promise<DriveRole | null> {
  return (await resolveSpaceRoles([space])).get(space.id) ?? null;
}

export async function ensureSpaceRole(space: SpaceLike, minRole: DriveRole): Promise<DriveRole> {
  const role = await resolveSpaceRole(space);
  if (!driveRoleAtLeast(role, minRole)) throw new HTTPException(403, { message: '没有该空间的操作权限' });
  return role!;
}

// ─── 节点角色 ─────────────────────────────────────────────────────────────────

export type NodeLike = { id: number; spaceId: number; aclChainIds: number[]; aclOpen: boolean };

export interface NodeRoleResolution {
  role: DriveRole | null;
  spaceRole: DriveRole | null;
  /** 命中的授权明细（自身 + 生效链），供权限面板展示 */
  grants: Array<{ nodeId: number; subjectType: DriveSubjectType; subjectId: number; role: DriveRole }>;
}

/**
 * 批量解析用户对若干节点的有效角色（一次加载空间与命中的授权）。
 * `subjectsOverride` 供外链等以第三方身份复核的场景。
 */
export async function resolveNodeRoles(nodes: NodeLike[], subjectsOverride?: DriveSubjectSet, executor: DbExecutor = db): Promise<Map<number, NodeRoleResolution>> {
  const result = new Map<number, NodeRoleResolution>();
  if (nodes.length === 0) return result;
  const subjects = subjectsOverride ?? await loadDriveSubjects();

  const spaceIds = [...new Set(nodes.map((n) => n.spaceId))];
  const grantNodeIds = [...new Set(nodes.flatMap(effectiveGrantNodeIds))];
  const [spaces, grants] = await Promise.all([
    executor.select({
      id: driveSpaces.id, type: driveSpaces.type, ownerId: driveSpaces.ownerId, departmentId: driveSpaces.departmentId,
      defaultMemberRole: driveSpaces.defaultMemberRole, status: driveSpaces.status,
    }).from(driveSpaces).where(inArray(driveSpaces.id, spaceIds)),
    subjects.isAdmin
      ? Promise.resolve([])
      : executor.select({
        nodeId: driveNodePermissions.nodeId, subjectType: driveNodePermissions.subjectType,
        subjectId: driveNodePermissions.subjectId, role: driveNodePermissions.role,
      }).from(driveNodePermissions).where(and(
        inArray(driveNodePermissions.nodeId, grantNodeIds),
        subjectPairsCondition(driveNodePermissions, subjects),
        or(isNull(driveNodePermissions.expireAt), gt(driveNodePermissions.expireAt, new Date())),
      )),
  ]);
  const ctx = await loadSpaceContext(spaces, subjects, executor);
  const enabledSpaceIds = new Set(spaces.filter((space) => space.status === 'enabled').map((space) => space.id));
  const spaceRoleMap = new Map(spaces.map((s) => [s.id, computeSpaceRole(s, subjects, ctx)]));
  const grantsByNode = new Map<number, typeof grants>();
  for (const g of grants) {
    const list = grantsByNode.get(g.nodeId) ?? [];
    list.push(g);
    grantsByNode.set(g.nodeId, list);
  }

  for (const node of nodes) {
    const spaceRole = spaceRoleMap.get(node.spaceId) ?? null;
    const hitGrants = spaceRole === 'manager' ? [] : effectiveGrantNodeIds(node).flatMap((id) => grantsByNode.get(id) ?? []);
    const role = !subjects.isAdmin && !enabledSpaceIds.has(node.spaceId)
      ? null : computeNodeRole(node, spaceRole, hitGrants.map((g) => g.role));
    result.set(node.id, { role, spaceRole, grants: hitGrants });
  }
  return result;
}

export async function resolveNodeRole(node: NodeLike): Promise<DriveRole | null> {
  return (await resolveNodeRoles([node])).get(node.id)?.role ?? null;
}

export async function ensureNodeRole(
  node: NodeLike,
  minRole: DriveRole,
  message = '没有该文件的操作权限',
  subjects?: DriveSubjectSet,
  executor: DbExecutor = db,
): Promise<DriveRole> {
  const role = (await resolveNodeRoles([node], subjects, executor)).get(node.id)?.role ?? null;
  if (!driveRoleAtLeast(role, minRole)) throw new HTTPException(403, { message });
  return role!;
}

/** 批量校验：任一节点角色不足即 403（消息附节点名）；返回各节点角色 */
export async function ensureNodeRoleOnAll<T extends NodeLike & { name: string }>(rows: T[], minRole: DriveRole, message: string): Promise<Map<number, DriveRole | null>> {
  const roleMap = await resolveNodeRoles(rows);
  for (const row of rows) {
    if (!driveRoleAtLeast(roleMap.get(row.id)?.role, minRole)) throw new HTTPException(403, { message: `${message}：${row.name}` });
  }
  return new Map(rows.map((r) => [r.id, roleMap.get(r.id)?.role ?? null]));
}

// ─── 可见性 SQL 谓词（精确，含继承断点）──────────────────────────────────────

/** 用户空间角色 ≥ minRole 的启用空间 id 子查询（不含 manager 兜底，见 managerSpaceIdsSubquery） */
export function accessibleSpaceIdsSubquery(subjects: DriveSubjectSet, minRole: DriveRole = 'viewer') {
  const deptIds = [...subjects.department];
  const roleSet = rolesAtLeast(minRole);
  const leaderSpaces = db.select({ id: departments.id }).from(departments).where(eq(departments.leaderId, subjects.userId));
  const memberSpaces = db.select({ id: driveSpaceMembers.spaceId }).from(driveSpaceMembers)
    .where(and(subjectPairsCondition(driveSpaceMembers, subjects), inArray(driveSpaceMembers.role, roleSet)));
  return db.select({ id: driveSpaces.id }).from(driveSpaces).where(and(
    eq(driveSpaces.status, 'enabled'),
    or(
      and(eq(driveSpaces.type, 'personal'), eq(driveSpaces.ownerId, subjects.userId)),
      and(eq(driveSpaces.type, 'department'), inArray(driveSpaces.defaultMemberRole, roleSet), deptIds.length ? inArray(driveSpaces.departmentId, deptIds) : sql`false`),
      and(eq(driveSpaces.type, 'department'), inArray(driveSpaces.departmentId, leaderSpaces)),
      and(eq(driveSpaces.type, 'team'), or(eq(driveSpaces.ownerId, subjects.userId), inArray(driveSpaces.defaultMemberRole, roleSet))),
      inArray(driveSpaces.id, memberSpaces),
    ),
  ));
}

/** 用户为 manager 的启用空间 id 子查询：所有者 / 部门负责人 / 成员表 manager */
export function managerSpaceIdsSubquery(subjects: DriveSubjectSet) {
  return accessibleSpaceIdsSubquery(subjects, 'manager');
}

/** 直接授权给当前用户主体、角色 ≥ minRole 的节点 id 子查询（未过期） */
export function grantedNodeIdsSubquery(subjects: DriveSubjectSet, minRole: DriveRole = 'viewer') {
  return db.select({ id: driveNodePermissions.nodeId }).from(driveNodePermissions).where(and(
    subjectPairsCondition(driveNodePermissions, subjects),
    inArray(driveNodePermissions.role, rolesAtLeast(minRole)),
    or(isNull(driveNodePermissions.expireAt), gt(driveNodePermissions.expireAt, new Date())),
  ));
}

/**
 * 节点有效角色 ≥ minRole 的精确 SQL 谓词（与 computeNodeRole 同构）：
 * 空间 manager ∪ (acl_open ∧ 空间角色达标) ∪ 自身被授权 ∪ 生效链上被授权。
 * 网盘管理员返回 undefined（不过滤）。
 */
export function visibleNodeCondition(subjects: DriveSubjectSet, minRole: DriveRole = 'viewer'): SQL | undefined {
  if (subjects.userId <= 0) return sql`false`;
  if (subjects.isAdmin) return undefined;
  const granted = grantedNodeIdsSubquery(subjects, minRole);
  return and(
    inArray(driveNodes.spaceId, db.select({ id: driveSpaces.id }).from(driveSpaces).where(eq(driveSpaces.status, 'enabled'))),
    or(
    inArray(driveNodes.spaceId, managerSpaceIdsSubquery(subjects)),
    and(eq(driveNodes.aclOpen, true), inArray(driveNodes.spaceId, accessibleSpaceIdsSubquery(subjects, minRole))),
    inArray(driveNodes.id, granted),
    sql`${driveNodes.aclChainIds} && ARRAY(${granted})`,
    ),
  );
}

/** 节点行附带 myRole（调用方已用 visibleNodeCondition 过滤，这里只补角色不再剔除） */
export async function attachNodeRoles<T extends NodeLike>(rows: T[], subjectsOverride?: DriveSubjectSet): Promise<Array<T & { myRole: DriveRole | null }>> {
  const roleMap = await resolveNodeRoles(rows, subjectsOverride);
  return rows.map((row) => ({ ...row, myRole: roleMap.get(row.id)?.role ?? null }));
}
