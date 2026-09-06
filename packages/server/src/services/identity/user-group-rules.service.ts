import { uniquePositiveInts } from '@zenith/shared/core';
import { requireRow } from '../../lib/db-assert';
/**
 * 动态用户组规则引擎：把 memberRule 物化为 user_group_members 行。
 *
 * 设计要点：
 * - 成员表是唯一事实源，全部消费方（权限/数据权限/工作流/报表 ACL/成员预览）零感知；
 * - 两种同步粒度：整组重算（规则保存/夜间校准）与按用户重算（用户属性变化的热路径）；
 * - 同步与组状态无关：成员始终镜像规则，status 只门控授权效果（口径统一、少一类边界）；
 * - 隐含条件：仅启用用户、与组同租户；exclude 优先级最高，include 是规则外例外；
 * - 写入后清理受影响用户的权限缓存（组可能绑定角色，进出即授/撤权）。
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { UserGroupMemberRule } from '@zenith/shared/identity';
import { db } from '../../db';
import { departments, userGroupMembers, userGroups, userPositions, users } from '../../db/schema';
import { clearUserPermissionCache } from '../../lib/permissions';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { exactTenantCondition } from '../../lib/tenant';

interface DynamicGroupRow {
  id: number;
  tenantId: number | null;
  memberRule: UserGroupMemberRule | null;
}

function hasRuleConditions(rule: UserGroupMemberRule): boolean {
  return (rule.departmentIds?.length ?? 0) > 0 || (rule.positionIds?.length ?? 0) > 0;
}

/** 展开部门子树：一次全量拉取后内存 BFS（与 data-scope 同款策略），支持多根 */
async function expandDepartmentIds(rootIds: number[], includeSub: boolean): Promise<number[]> {
  if (!includeSub || rootIds.length === 0) return rootIds;
  const all = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments);
  const children = new Map<number, number[]>();
  for (const d of all) {
    const list = children.get(d.parentId) ?? [];
    list.push(d.id);
    children.set(d.parentId, list);
  }
  const seen = new Set<number>(rootIds);
  const queue = [...rootIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

/** 集合式计算规则命中的用户 ID（启用用户 ∩ 同租户；条件组间 AND；含 include/exclude） */
async function computeRuleTargetUserIds(group: DynamicGroupRow): Promise<Set<number>> {
  const rule = group.memberRule;
  if (!rule) return new Set();
  const tenantCond = exactTenantCondition(users.tenantId, group.tenantId);

  const target = new Set<number>();
  if (hasRuleConditions(rule)) {
    const conditions = [eq(users.status, 'enabled' as const), tenantCond];
    if (rule.departmentIds?.length) {
      const deptIds = await expandDepartmentIds(rule.departmentIds, rule.includeSubDepartments ?? false);
      conditions.push(inArray(users.departmentId, deptIds));
    }
    if (rule.positionIds?.length) {
      conditions.push(inArray(
        users.id,
        db.select({ id: userPositions.userId }).from(userPositions).where(inArray(userPositions.positionId, rule.positionIds)),
      ));
    }
    const rows = await db.select({ id: users.id }).from(users).where(and(...conditions));
    rows.forEach((r) => target.add(r.id));
  }

  if (rule.includeUserIds?.length) {
    // 强制包含同样必须是启用的同租户用户，防止跨租户塞人
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, rule.includeUserIds), eq(users.status, 'enabled'), tenantCond));
    rows.forEach((r) => target.add(r.id));
  }
  for (const id of rule.excludeUserIds ?? []) target.delete(id);
  return target;
}

async function applyMembershipDiff(groupId: number, toAdd: number[], toRemove: number[]): Promise<void> {
  await db.transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.delete(userGroupMembers)
        .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.userId, toRemove)));
    }
    if (toAdd.length > 0) {
      await tx.insert(userGroupMembers)
        .values(toAdd.map((userId) => ({ groupId, userId })))
        .onConflictDoNothing();
    }
    await tx.update(userGroups).set({ ruleSyncedAt: new Date() }).where(eq(userGroups.id, groupId));
  });
  // 组可能绑定角色：进出成员即授/撤权，前后都清缓存
  await Promise.all([...new Set([...toAdd, ...toRemove])].map((uid) => clearUserPermissionCache(uid)));
}

/** 整组重算：规则保存、模式切换、手动同步、夜间校准共用 */
export async function syncDynamicGroup(groupId: number): Promise<{ added: number; removed: number }> {
  const [group] = await db
    .select({ id: userGroups.id, tenantId: userGroups.tenantId, memberMode: userGroups.memberMode, memberRule: userGroups.memberRule })
    .from(userGroups)
    .where(eq(userGroups.id, groupId))
    .limit(1);
  if (!group || group.memberMode !== 'dynamic' || !group.memberRule) return { added: 0, removed: 0 };

  const target = await computeRuleTargetUserIds(group);
  const current = await db
    .select({ userId: userGroupMembers.userId })
    .from(userGroupMembers)
    .where(eq(userGroupMembers.groupId, groupId));
  const currentSet = new Set(current.map((r) => r.userId));

  const toAdd = [...target].filter((id) => !currentSet.has(id));
  const toRemove = [...currentSet].filter((id) => !target.has(id));
  await applyMembershipDiff(groupId, toAdd, toRemove);
  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * 按用户重算全部动态组归属（用户创建/更新/导入/状态变化/身份源同步后的热路径）。
 * 调用点须 catch 记日志不阻断业务主流程；漂移由夜间校准兜底。
 */
export async function syncUserDynamicMemberships(userIds: number[]): Promise<void> {
  const uniq = uniquePositiveInts(userIds);
  if (uniq.length === 0) return;
  const groups = await db
    .select({ id: userGroups.id, tenantId: userGroups.tenantId, memberRule: userGroups.memberRule })
    .from(userGroups)
    .where(eq(userGroups.memberMode, 'dynamic'));
  const dynamicGroups = groups.filter((g): g is DynamicGroupRow & { memberRule: UserGroupMemberRule } => g.memberRule != null);
  if (dynamicGroups.length === 0) return;

  const [userRows, positionRows, currentRows] = await Promise.all([
    db.select({ id: users.id, tenantId: users.tenantId, departmentId: users.departmentId, status: users.status })
      .from(users).where(inArray(users.id, uniq)),
    db.select({ userId: userPositions.userId, positionId: userPositions.positionId })
      .from(userPositions).where(inArray(userPositions.userId, uniq)),
    db.select({ groupId: userGroupMembers.groupId, userId: userGroupMembers.userId })
      .from(userGroupMembers)
      .where(and(inArray(userGroupMembers.groupId, dynamicGroups.map((g) => g.id)), inArray(userGroupMembers.userId, uniq))),
  ]);
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const positionMap = new Map<number, Set<number>>();
  for (const row of positionRows) {
    const set = positionMap.get(row.userId) ?? new Set<number>();
    set.add(row.positionId);
    positionMap.set(row.userId, set);
  }
  const currentByGroup = new Map<number, Set<number>>();
  for (const row of currentRows) {
    const set = currentByGroup.get(row.groupId) ?? new Set<number>();
    set.add(row.userId);
    currentByGroup.set(row.groupId, set);
  }

  // 子树展开按 (roots, includeSub) 缓存，同一批多组共享一次部门表拉取
  const expansionCache = new Map<string, Set<number>>();
  async function expandedSet(rule: UserGroupMemberRule): Promise<Set<number> | null> {
    if (!rule.departmentIds?.length) return null;
    const key = `${rule.includeSubDepartments ? '1' : '0'}:${[...rule.departmentIds].sort((a, b) => a - b).join(',')}`;
    let cached = expansionCache.get(key);
    if (!cached) {
      cached = new Set(await expandDepartmentIds(rule.departmentIds, rule.includeSubDepartments ?? false));
      expansionCache.set(key, cached);
    }
    return cached;
  }

  for (const group of dynamicGroups) {
    const rule = group.memberRule;
    const deptSet = await expandedSet(rule);
    const current = currentByGroup.get(group.id) ?? new Set<number>();
    const toAdd: number[] = [];
    const toRemove: number[] = [];

    for (const userId of uniq) {
      const user = userMap.get(userId);
      let matched = false;
      if (user && user.status === 'enabled' && (user.tenantId ?? null) === (group.tenantId ?? null)) {
        if (rule.excludeUserIds?.includes(userId)) {
          matched = false;
        } else if (rule.includeUserIds?.includes(userId)) {
          matched = true;
        } else if (hasRuleConditions(rule)) {
          const deptOk = !deptSet || (user.departmentId != null && deptSet.has(user.departmentId));
          const positionOk = !rule.positionIds?.length
            || [...(positionMap.get(userId) ?? [])].some((pid) => rule.positionIds!.includes(pid));
          matched = deptOk && positionOk;
        }
      }
      const isMember = current.has(userId);
      if (matched && !isMember) toAdd.push(userId);
      if (!matched && isMember) toRemove.push(userId);
    }
    if (toAdd.length > 0 || toRemove.length > 0) {
      await applyMembershipDiff(group.id, toAdd, toRemove);
    }
  }
}

/** 全量校准：夜间任务与部门树变化（移动/删除影响子树展开）时调用 */
export async function syncAllDynamicGroups(): Promise<{ groups: number; added: number; removed: number }> {
  const groups = await db
    .select({ id: userGroups.id })
    .from(userGroups)
    .where(eq(userGroups.memberMode, 'dynamic'));
  let added = 0;
  let removed = 0;
  for (const group of groups) {
    const result = await syncDynamicGroup(group.id);
    added += result.added;
    removed += result.removed;
  }
  return { groups: groups.length, added, removed };
}

/** 触发点专用：失败只记日志，不得阻断业务主流程 */
export function syncUserDynamicMembershipsSafe(userIds: number[], context: string): void {
  syncUserDynamicMemberships(userIds).catch((err) => {
    logger.warn(`动态用户组同步失败（${context}）: ${err}`);
  });
}

export function syncAllDynamicGroupsSafe(context: string): void {
  syncAllDynamicGroups().catch((err) => {
    logger.warn(`动态用户组全量同步失败（${context}）: ${err}`);
  });
}

export interface RulePreviewUser {
  id: number;
  username: string;
  nickname: string;
}

export interface RulePreviewResult {
  total: number;
  joiningCount: number;
  leavingCount: number;
  joining: RulePreviewUser[];
  leaving: RulePreviewUser[];
}

const PREVIEW_LIMIT = 50;

/**
 * 规则 dry-run：返回按规则计算的目标成员与当前成员的 diff（各限 50 条明细）。
 * groupId 为空 = 新建组预览（当前成员视为空集）。
 */
export async function previewDynamicGroupRule(
  rule: UserGroupMemberRule,
  options: { groupId?: number; tenantId: number | null },
): Promise<RulePreviewResult> {
  let tenantId = options.tenantId;
  let currentSet = new Set<number>();
  if (options.groupId != null) {
    const [group] = await db
      .select({ id: userGroups.id, tenantId: userGroups.tenantId })
      .from(userGroups)
      .where(eq(userGroups.id, options.groupId))
      .limit(1);
    requireRow(group, '用户组不存在');
    tenantId = group.tenantId;
    const current = await db
      .select({ userId: userGroupMembers.userId })
      .from(userGroupMembers)
      .where(eq(userGroupMembers.groupId, options.groupId));
    currentSet = new Set(current.map((r) => r.userId));
  }

  const target = await computeRuleTargetUserIds({ id: options.groupId ?? 0, tenantId, memberRule: rule });
  const joiningIds = [...target].filter((id) => !currentSet.has(id));
  const leavingIds = [...currentSet].filter((id) => !target.has(id));

  const detailIds = [...joiningIds.slice(0, PREVIEW_LIMIT), ...leavingIds.slice(0, PREVIEW_LIMIT)];
  const detailRows = detailIds.length > 0
    ? await db.select({ id: users.id, username: users.username, nickname: users.nickname })
      .from(users).where(inArray(users.id, detailIds))
    : [];
  const detailMap = new Map(detailRows.map((u) => [u.id, u]));
  const toPreview = (ids: number[]): RulePreviewUser[] =>
    ids.slice(0, PREVIEW_LIMIT).map((id) => detailMap.get(id) ?? { id, username: `#${id}`, nickname: `#${id}` });

  return {
    total: target.size,
    joiningCount: joiningIds.length,
    leavingCount: leavingIds.length,
    joining: toPreview(joiningIds),
    leaving: toPreview(leavingIds),
  };
}

/** 巡检任务入口：夜间全量校准并输出摘要 */
export async function runUserGroupRuleSync(): Promise<string> {
  const started = Date.now();
  const { groups, added, removed } = await syncAllDynamicGroups();
  if (groups === 0) return '无动态用户组，跳过';
  return `校准 ${groups} 个动态组：加入 ${added} 人，移除 ${removed} 人（耗时 ${Date.now() - started}ms，${formatDateTime(new Date())}）`;
}
