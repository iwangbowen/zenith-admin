import { DRIVE_ROLES, DRIVE_ROLE_RANK, driveRoleAtLeast, maxDriveRole, type DriveRole, type DriveSubjectType } from '@zenith/shared/drive';

/**
 * 企业网盘 ACL 纯函数（无 DB 依赖，可直接单测）。
 *
 * 模型：有效角色 = spaceRole === 'manager' ? manager : max(aclOpen ? spaceRole : ∅, 自身授权, 生效链上授权)
 * - `aclChainIds`：从最近一个断开继承的祖先（含）到父节点的祖先 id，自身断开继承时为空；
 * - `aclOpen`：从根到自身链上没有任何断点，空间角色才透传。
 * 两列由 drive-nodes.service 在新建 / 移动 / 复制 / 还原 / 切换继承时物化维护。
 */

export interface DriveSubjectSet {
  userId: number;
  user: Set<number>;
  /** 本部门 + 全部上级部门（授权给部门即覆盖其子部门成员） */
  department: Set<number>;
  /** 直接角色 + 启用用户组继承的启用角色 */
  role: Set<number>;
  user_group: Set<number>;
  /** 用户直属部门 */
  departmentId: number | null;
  /** 平台超管或网盘管理员：全局 manager */
  isAdmin: boolean;
}

export const EMPTY_SUBJECTS: DriveSubjectSet = {
  userId: 0, user: new Set(), department: new Set(), role: new Set(), user_group: new Set(), departmentId: null, isAdmin: false,
};

export interface SpaceLike {
  id: number;
  type: 'personal' | 'department' | 'team';
  ownerId: number | null;
  departmentId: number | null;
  defaultMemberRole: DriveRole | null;
  status: 'enabled' | 'disabled';
  /** 归档时间；非空即只读（角色计算不受影响，写操作在 ensure* 处拒绝） */
  archivedAt?: Date | null;
}

export interface SpaceMemberLike {
  spaceId: number;
  subjectType: DriveSubjectType;
  subjectId: number;
  role: DriveRole;
}

export interface SpaceRoleContext {
  members: SpaceMemberLike[];
  /** 当前用户担任负责人的部门 id */
  leaderDeptIds: Set<number>;
}

export function subjectMatches(entry: { subjectType: DriveSubjectType; subjectId: number }, subjects: DriveSubjectSet): boolean {
  return subjects[entry.subjectType].has(entry.subjectId);
}

/** 当前用户在某空间的角色（不含节点授权） */
export function computeSpaceRole(space: SpaceLike, subjects: DriveSubjectSet, ctx: SpaceRoleContext): DriveRole | null {
  if (subjects.userId <= 0) return null;
  if (subjects.isAdmin) return 'manager';
  if (space.status !== 'enabled') return null;
  let role: DriveRole | null = null;
  if (space.type === 'personal') {
    if (space.ownerId === subjects.userId) return 'manager';
  } else if (space.type === 'department') {
    if (space.departmentId && ctx.leaderDeptIds.has(space.departmentId)) return 'manager';
    if (space.departmentId && subjects.department.has(space.departmentId)) role = space.defaultMemberRole;
  } else {
    if (space.ownerId === subjects.userId) return 'manager';
    // 公开协作空间：defaultMemberRole 非空即全员可访问
    role = space.defaultMemberRole;
  }
  for (const m of ctx.members) {
    if (m.spaceId === space.id && subjectMatches(m, subjects)) role = maxDriveRole(role, m.role);
  }
  return role;
}

export interface NodeAclLike {
  id: number;
  aclChainIds: number[];
  aclOpen: boolean;
}

/**
 * 节点有效角色：空间 manager 不受断点影响；否则空间角色仅在 aclOpen 时参与，
 * 再与自身 + 生效链上命中的授权取最大。
 */
export function computeNodeRole(node: NodeAclLike, spaceRole: DriveRole | null, grantRoles: Iterable<DriveRole>): DriveRole | null {
  if (spaceRole === 'manager') return 'manager';
  return maxDriveRole(node.aclOpen ? spaceRole : null, ...grantRoles);
}

/** 节点授权命中的 nodeId 集合：自身 + 生效链 */
export function effectiveGrantNodeIds(node: NodeAclLike): number[] {
  return [...node.aclChainIds, node.id];
}

export interface ParentAclLike {
  id: number;
  aclChainIds: number[];
  aclOpen: boolean;
}

/**
 * 子节点（inheritPermissions=true）应有的 ACL 列。
 * 父节点自身断开继承时其 aclChainIds=[]、aclOpen=false，公式自然退化为 chain=[parent]、open=false。
 */
export function childAclOf(parent: ParentAclLike | null): { aclChainIds: number[]; aclOpen: boolean } {
  if (!parent) return { aclChainIds: [], aclOpen: true };
  return { aclChainIds: [...parent.aclChainIds, parent.id], aclOpen: parent.aclOpen };
}

/** 节点自身应有的 ACL 列：断开继承 → 空链且不透传；否则等于 childAclOf(parent) */
export function ownAclOf(inheritPermissions: boolean, parent: ParentAclLike | null): { aclChainIds: number[]; aclOpen: boolean } {
  if (!inheritPermissions) return { aclChainIds: [], aclOpen: false };
  return childAclOf(parent);
}

/** 等级 ≥ minRole 的全部角色（供 SQL `IN (...)` 使用） */
export function rolesAtLeast(minRole: DriveRole): DriveRole[] {
  return DRIVE_ROLES.filter((r) => DRIVE_ROLE_RANK[r] >= DRIVE_ROLE_RANK[minRole]);
}

/** 授权条目按主体过滤后取角色 */
export function matchedGrantRoles(
  grants: Iterable<{ subjectType: DriveSubjectType; subjectId: number; role: DriveRole }>,
  subjects: DriveSubjectSet,
): DriveRole[] {
  const roles: DriveRole[] = [];
  for (const g of grants) if (subjectMatches(g, subjects)) roles.push(g.role);
  return roles;
}

export { driveRoleAtLeast, maxDriveRole };
