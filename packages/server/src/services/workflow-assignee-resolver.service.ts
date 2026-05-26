/**
 * 工作流审批人解析器
 *
 * 将节点配置中的 assigneeType + 多源 IDs 解析为具体的用户 ID 列表，
 * 用于在创建审批任务时展开为多个 workflow_tasks 行。
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { WorkflowAssigneeType, WorkflowNodeConfig } from '@zenith/shared';
import { db } from '../db';
import {
  departments,
  userGroupMembers,
  userPositions,
  userRoles,
  users,
  workflowTasks,
} from '../db/schema';
import type { DbExecutor } from '../db/types';

export interface ResolveAssigneeContext {
  /** 流程发起人 ID（用于 initiator / initiatorLeader / initiatorDept / manager） */
  initiatorId: number;
  /** 数据库执行器，未指定时使用全局 db */
  executor?: DbExecutor;
  /** 表单数据（formUser / formDepartment 等策略使用） */
  formData?: Record<string, unknown>;
  /** 当前流程实例 ID（nodeApprover 策略使用） */
  instanceId?: number;
  /** 上一节点审批人在审批时为本次创建的 approverSelect 节点选择的用户 ID 列表 */
  selectedNextApprovers?: number[];
}

/** 从给定部门开始向上走 levels 层，返回最终所在的部门 ID（找不到则返回 null） */
async function walkDeptUp(exec: DbExecutor, startDeptId: number, levels: number): Promise<number | null> {
  let current: number | null = startDeptId;
  for (let i = 0; i < levels && current !== null; i++) {
    const [parent] = await exec.select({ parentId: departments.parentId })
      .from(departments).where(eq(departments.id, current)).limit(1);
    if (!parent || parent.parentId === 0 || parent.parentId === null) return null;
    current = parent.parentId;
  }
  return current;
}

/** 取得用户所在部门 */
async function getUserDept(exec: DbExecutor, userId: number): Promise<number | null> {
  const [row] = await exec.select({ deptId: users.departmentId })
    .from(users).where(eq(users.id, userId)).limit(1);
  return row?.deptId ?? null;
}

/** 取部门负责人 */
async function getDeptLeader(exec: DbExecutor, deptId: number): Promise<number | null> {
  const [row] = await exec.select({ leaderId: departments.leaderId })
    .from(departments).where(eq(departments.id, deptId)).limit(1);
  return row?.leaderId ?? null;
}

/** 递归收集部门及其所有子部门 ID（含起始部门）。 */
async function collectDeptWithChildren(exec: DbExecutor, rootIds: number[]): Promise<number[]> {
  const all = new Set<number>(rootIds);
  let frontier = [...rootIds];
  while (frontier.length > 0) {
    const rows = await exec.select({ id: departments.id })
      .from(departments).where(inArray(departments.parentId, frontier));
    const next: number[] = [];
    for (const r of rows) {
      if (!all.has(r.id)) {
        all.add(r.id);
        next.push(r.id);
      }
    }
    frontier = next;
  }
  return [...all];
}

/**
 * 安全表达式求值器，限制作用域在 form / starter / context，返回 user ID 数组。
 * 例如： `form.managerId`, `[form.a, form.b]`, `starter.id`
 */
function evalAssigneeExpression(
  expr: string,
  ctx: { form: Record<string, unknown>; starter: { id: number }; },
): number[] {
  try {
    // 仅允许表达式体、禁止 import/require/global/process
    const fn = new Function('form', 'starter', `"use strict"; return (${expr});`);
    const v = fn(ctx.form, ctx.starter);
    if (typeof v === 'number' && Number.isFinite(v)) return [v];
    if (Array.isArray(v)) {
      return v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    }
    return [];
  } catch {
    return [];
  }
}

/** 将节点配置解析为去重后的用户 ID 数组 */
export async function resolveAssigneeIds(
  node: WorkflowNodeConfig,
  ctx: ResolveAssigneeContext,
): Promise<number[]> {
  const exec = ctx.executor ?? db;
  const type: WorkflowAssigneeType | undefined = node.assigneeType;

  // 兼容旧数据：未声明 assigneeType 时，回退 assigneeId / assigneeIds
  if (!type) {
    const fallback = new Set<number>();
    if (typeof node.assigneeId === 'number') fallback.add(node.assigneeId);
    if (node.assigneeIds?.length) node.assigneeIds.forEach((id) => fallback.add(id));
    return [...fallback];
  }

  const result = new Set<number>();

  switch (type) {
    case 'user':
    case 'initiatorSelect':
    case 'initiatorSelectScope': {
      // initiatorSelectScope 运行时依赖发起人在发起时选择的具体人员（已写回 userIds / assigneeIds）
      (node.userIds ?? []).forEach((id) => result.add(id));
      (node.assigneeIds ?? []).forEach((id) => result.add(id));
      if (typeof node.assigneeId === 'number') result.add(node.assigneeId);
      break;
    }
    case 'approverSelect': {
      // 由上一节点审批人在审批时选定
      const picked = ctx.selectedNextApprovers ?? [];
      if (picked.length === 0) break;
      // 若设计器限定了可选范围（selectScopeIds + selectScopeType==='user'），进行交集过滤
      const scopeType = node.selectScopeType;
      const scopeIds = node.selectScopeIds ?? [];
      if (scopeType === 'user' && scopeIds.length > 0) {
        const allow = new Set(scopeIds);
        picked.filter((id) => allow.has(id)).forEach((id) => result.add(id));
      } else {
        picked.forEach((id) => result.add(id));
      }
      break;
    }
    case 'role': {
      const roleIds = node.roleIds ?? [];
      if (roleIds.length > 0) {
        const rows = await exec
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(inArray(userRoles.roleId, roleIds));
        rows.forEach((r) => result.add(r.userId));
      }
      break;
    }
    case 'department': {
      // 已指定部门 IDs：取这些部门下所有启用用户
      const deptIds = node.deptIds ?? [];
      if (deptIds.length > 0) {
        const rows = await exec
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.departmentId, deptIds), eq(users.status, 'enabled')));
        rows.forEach((r) => result.add(r.id));
        break;
      }
      // 未指定：取发起人部门的负责人
      const deptId = await getUserDept(exec, ctx.initiatorId);
      if (deptId) {
        const leader = await getDeptLeader(exec, deptId);
        if (leader) result.add(leader);
      }
      break;
    }
    case 'userGroup': {
      const groupIds = node.userGroupIds ?? [];
      if (groupIds.length > 0) {
        const rows = await exec
          .select({ userId: userGroupMembers.userId })
          .from(userGroupMembers)
          .where(inArray(userGroupMembers.groupId, groupIds));
        rows.forEach((r) => result.add(r.userId));
      }
      break;
    }
    case 'initiator': {
      result.add(ctx.initiatorId);
      break;
    }
    case 'initiatorLeader':
    case 'manager': {
      // 直属主管：发起人所在部门的负责人；managerLevel > 1 时往上走 deptParent 链
      const startDeptId = await getUserDept(exec, ctx.initiatorId);
      if (!startDeptId) break;
      const level = Math.max(1, node.managerLevel ?? 1);
      const targetDeptId = level === 1
        ? startDeptId
        : await walkDeptUp(exec, startDeptId, level - 1);
      if (targetDeptId) {
        const leader = await getDeptLeader(exec, targetDeptId);
        if (leader) result.add(leader);
      }
      break;
    }
    case 'initiatorDept': {
      // 发起人部门主管/全员（兼容旧字段语义：取整个部门的启用用户）
      const deptId = await getUserDept(exec, ctx.initiatorId);
      if (deptId) {
        const rows = await exec
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.departmentId, deptId),
            eq(users.status, 'enabled'),
            isNotNull(users.id),
          ));
        rows.forEach((r) => result.add(r.id));
      }
      break;
    }
    case 'multiLevelManager':
    case 'multiLevelDeptHead': {
      // 从发起人直属部门开始，逐级向上收集每一级的负责人
      // endType=topLevel  → 一直到没有上级
      // endType=level     → 走到第 multiLevelEndLevel 层为止
      // endType=role      → 一直走，遇到具备 multiLevelEndRoleId 角色的负责人即停
      const startDeptId = await getUserDept(exec, ctx.initiatorId);
      if (!startDeptId) break;
      const endType = node.multiLevelEndType ?? 'topLevel';
      const endLevel = node.multiLevelEndLevel ?? 99;
      const endRoleId = node.multiLevelEndRoleId;
      let currentDept: number | null = startDeptId;
      const visited = new Set<number>();
      for (let i = 0; i < 50 && currentDept !== null; i++) {
        if (visited.has(currentDept)) break;
        visited.add(currentDept);
        const leader = await getDeptLeader(exec, currentDept);
        if (leader) {
          result.add(leader);
          if (endType === 'role' && endRoleId) {
            const [hit] = await exec.select({ id: userRoles.userId }).from(userRoles)
              .where(and(eq(userRoles.userId, leader), eq(userRoles.roleId, endRoleId)))
              .limit(1);
            if (hit) break;
          }
        }
        if (endType === 'level' && i + 1 >= endLevel) break;
        const [parent] = await exec.select({ parentId: departments.parentId })
          .from(departments).where(eq(departments.id, currentDept)).limit(1);
        if (!parent?.parentId || parent.parentId === 0) break;
        currentDept = parent.parentId;
      }
      break;
    }
    case 'formUser': {
      const key = node.formUserField;
      if (!key || !ctx.formData) break;
      const v = ctx.formData[key];
      if (typeof v === 'number') result.add(v);
      else if (Array.isArray(v)) v.forEach((x) => typeof x === 'number' && result.add(x));
      break;
    }
    case 'formDepartment': {
      const key = node.formDeptField;
      if (!key || !ctx.formData) break;
      const v = ctx.formData[key];
      const deptIds: number[] = [];
      if (typeof v === 'number') deptIds.push(v);
      else if (Array.isArray(v)) v.forEach((x) => typeof x === 'number' && deptIds.push(x));
      if (deptIds.length === 0) break;
      const level = Math.max(1, node.formDeptHeadLevel ?? 1);
      for (const startDeptId of deptIds) {
        const targetDeptId = level === 1
          ? startDeptId
          : await walkDeptUp(exec, startDeptId, level - 1);
        if (targetDeptId) {
          const leader = await getDeptLeader(exec, targetDeptId);
          if (leader) result.add(leader);
        }
      }
      break;
    }
    case 'nodeApprover': {
      const nodeKey = node.nodeApproverNodeId;
      if (!nodeKey || !ctx.instanceId) break;
      const rows = await exec.select({ userId: workflowTasks.assigneeId }).from(workflowTasks)
        .where(and(
          eq(workflowTasks.instanceId, ctx.instanceId),
          eq(workflowTasks.nodeKey, nodeKey),
          eq(workflowTasks.status, 'approved'),
        ));
      rows.forEach((r) => { if (r.userId) result.add(r.userId); });
      break;
    }
    case 'post': {
      const postIds = node.postIds ?? [];
      if (postIds.length === 0) break;
      const rows = await exec
        .select({ userId: userPositions.userId })
        .from(userPositions)
        .innerJoin(users, eq(users.id, userPositions.userId))
        .where(and(
          inArray(userPositions.positionId, postIds),
          eq(users.status, 'enabled'),
        ));
      rows.forEach((r) => result.add(r.userId));
      break;
    }
    case 'deptMember': {
      const seedIds = node.deptMemberDeptIds ?? [];
      if (seedIds.length === 0) break;
      const deptIds = node.deptMemberIncludeChildren
        ? await collectDeptWithChildren(exec, seedIds)
        : seedIds;
      const rows = await exec
        .select({ id: users.id })
        .from(users)
        .where(and(
          inArray(users.departmentId, deptIds),
          eq(users.status, 'enabled'),
        ));
      rows.forEach((r) => result.add(r.id));
      break;
    }
    case 'startUserDeptResponsible': {
      // 发起人部门的分管领导 → 取上一级部门的负责人
      const startDeptId = await getUserDept(exec, ctx.initiatorId);
      if (!startDeptId) break;
      const [parent] = await exec.select({ parentId: departments.parentId })
        .from(departments).where(eq(departments.id, startDeptId)).limit(1);
      const parentDeptId = parent?.parentId;
      if (!parentDeptId || parentDeptId === 0) break;
      const leader = await getDeptLeader(exec, parentDeptId);
      if (leader) result.add(leader);
      break;
    }
    case 'expression': {
      const expr = node.assigneeExpression;
      if (!expr) break;
      const ids = evalAssigneeExpression(expr, {
        form: ctx.formData ?? {},
        starter: { id: ctx.initiatorId },
      });
      ids.forEach((id) => result.add(id));
      break;
    }
  }

  return [...result];
}
