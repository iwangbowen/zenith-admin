/**
 * 用户组访问的共享内核：统一「启用组 ∩ 启用角色 / 启用用户」的口径。
 *
 * 此前四处各自手写组继承查询（permissions / data-scope / users.service 诊断×2），
 * 且 workflow 审批人解析与报表 ACL 漏掉了组状态过滤——禁用组仍参与审批路由与资源授权。
 * 本模块把查询片段、运行时过滤与两类展开查询收敛为唯一实现：
 *
 * - {@link enabledGroupRolesWith}：RQB `with` 片段工厂，强制携带组/角色 status 列；
 * - {@link extractEnabledGroupRoles}：统一过滤禁用组与禁用角色；
 * - {@link resolveGroupMemberUserIds}：组 → 成员展开（启用组 ∩ 启用用户）；
 * - {@link getUserEnabledGroupIds}：用户 → 所属启用组（ACL 主体加载用）。
 *
 * 动态用户组的成员由规则物化到同一张 user_group_members 表，全部消费方经由
 * 本模块读取即可对静态/动态组保持无感知。
 */
import { uniquePositiveInts } from '@zenith/shared/core';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { userGroupMembers, userGroups, users } from '../db/schema';
import type { DbExecutor } from '../db/types';

interface RoleSelection {
  /** 必须包含 status: true——extract 依赖它过滤禁用角色 */
  columns: { status: true } & Record<string, boolean>;
  with?: Record<string, unknown>;
}

/**
 * 生成 `users` RQB 查询里 `userGroupMembers` 的 `with` 片段：
 * 组固定取 id/name/status，角色列由调用方按需声明（菜单链路取 roleMenus，
 * 数据权限取 deptScopes，诊断两者都取），避免热路径过度取数。
 */
export function enabledGroupRolesWith<const TRole extends RoleSelection>(role: TRole) {
  return {
    columns: {},
    with: {
      group: {
        columns: { id: true, name: true, status: true },
        with: {
          groupRoles: {
            columns: {},
            with: { role },
          },
        },
      },
    },
  } as const;
}

interface GroupRoleMembership<TRole> {
  group: {
    id: number;
    name: string;
    status: string;
    groupRoles: Array<{ role: TRole }>;
  };
}

/**
 * 从 RQB 结果中提取有效的组继承角色：仅启用组的启用角色生效。
 * `groups` 返回绑定了角色的启用组（诊断页展示「继承自哪些组」）。
 */
export function extractEnabledGroupRoles<TRole extends { status: string }>(
  memberships: ReadonlyArray<GroupRoleMembership<TRole>> | undefined | null,
): { roles: TRole[]; groups: Array<{ id: number; name: string }> } {
  const enabled = (memberships ?? []).filter((m) => m.group.status === 'enabled');
  const roles = enabled
    .flatMap((m) => m.group.groupRoles.map((gr) => gr.role))
    .filter((r) => r.status === 'enabled');
  const groups = enabled
    .filter((m) => m.group.groupRoles.length > 0)
    .map((m) => ({ id: m.group.id, name: m.group.name }));
  return { roles, groups };
}

/**
 * 用户组 → 成员用户 ID 展开：只返回**启用组**里的**启用用户**。
 * 工作流审批人解析、缓存失效范围计算等场景共用。
 */
export async function resolveGroupMemberUserIds(
  groupIds: readonly number[],
  exec: DbExecutor = db,
): Promise<number[]> {
  const uniq = uniquePositiveInts(groupIds);
  if (uniq.length === 0) return [];
  const rows = await exec
    .select({ id: users.id })
    .from(userGroupMembers)
    .innerJoin(users, eq(users.id, userGroupMembers.userId))
    .innerJoin(userGroups, eq(userGroups.id, userGroupMembers.groupId))
    .where(and(
      inArray(userGroupMembers.groupId, uniq),
      eq(users.status, 'enabled'),
      eq(userGroups.status, 'enabled'),
    ));
  return [...new Set(rows.map((r) => r.id))];
}

/** 用户 → 所属**启用**用户组 ID（报表 ACL 等按组授权的主体加载用）。 */
export async function getUserEnabledGroupIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: userGroupMembers.groupId })
    .from(userGroupMembers)
    .innerJoin(userGroups, eq(userGroups.id, userGroupMembers.groupId))
    .where(and(eq(userGroupMembers.userId, userId), eq(userGroups.status, 'enabled')));
  return rows.map((r) => r.groupId);
}
