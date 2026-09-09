/**
 * 工作流审批人解析器
 *
 * 将节点配置中的 assigneeType + 多源 IDs 解析为具体的用户 ID 列表，
 * 用于在创建审批任务时展开为多个 workflow_tasks 行。
 */
import { uniquePositiveInts } from '@zenith/shared/core';
import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import type { WorkflowAssigneeType, WorkflowNodeConfig, WorkflowStarterContext } from '@zenith/shared/workflow';
import { db } from '../../db';
import {
  departments,
  roleDeptScopes,
  userPositions,
  userRoles,
  users,
  workflowTasks,
} from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import logger from '../../lib/logger';
import { resolveGroupMemberUserIds } from '../../lib/user-group-access';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { evaluateExpression, ExpressionError } from '../../lib/workflow-expression';
import { decide } from '../platform/rules-runtime.service';

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
  /**
   * 可跨多次解析共享的惰性部门树。批量场景（一次实例化里逐节点解析审批人）
   * 应由调用方创建并传入，避免每个节点各拉一次部门表；未传入时按次创建，
   * 且只有真正走到部门相关分支才会触发查询。
   */
  deptTree?: DeptTree;
}

export interface WorkflowSelectableUser {
  id: number;
  name: string;
}

// ─── 部门访问：单跳走索引查询，多跳/展开走惰性部门树 ─────────────────────────
//
// 取舍依据：单跳（取某个部门的负责人 / 上级）是主键等值查询，成本远低于全表拉取；
// 而「逐级向上直到顶层」「递归展开子部门」这类循环才是真正的 N+1，值得用一次
// 全量拉取换掉 O(深度) 次往返。因此两种策略并存，按调用形态选择。

interface DeptNode {
  parentId: number | null;
  leaderId: number | null;
}

/** 单点查部门负责人（单跳路径专用；多跳请走 DeptTree） */
async function fetchDeptLeader(exec: DbExecutor, deptId: number): Promise<number | null> {
  const [row] = await exec.select({ leaderId: departments.leaderId })
    .from(departments).where(eq(departments.id, deptId)).limit(1);
  return row?.leaderId ?? null;
}

/** 批量查多个部门的负责人（一次 IN 查询替代逐部门查询） */
async function fetchDeptLeaders(exec: DbExecutor, deptIds: readonly number[]): Promise<number[]> {
  const uniq = uniquePositiveIds(deptIds);
  if (uniq.length === 0) return [];
  const rows = await exec.select({ leaderId: departments.leaderId })
    .from(departments).where(inArray(departments.id, uniq));
  return rows.map((r) => r.leaderId).filter((id): id is number => id !== null);
}

/** 单点查上级部门 ID；已到顶层（parentId 为 0/null）或部门不存在时返回 null */
async function fetchDeptParent(exec: DbExecutor, deptId: number): Promise<number | null> {
  const [row] = await exec.select({ parentId: departments.parentId })
    .from(departments).where(eq(departments.id, deptId)).limit(1);
  const parentId = row?.parentId ?? null;
  return parentId === 0 ? null : parentId;
}

/**
 * 惰性部门树：首次访问时拉取一次全量部门，之后在同一实例内复用。
 *
 * 关键在「惰性」——未命中部门相关分支的审批人类型（user / initiator / formUser /
 * post / userGroup / expression 等）不会产生任何查询。批量场景（如一次实例化里
 * 解析多个节点）可通过 ResolveAssigneeContext.deptTree 复用同一实例，避免逐节点重复拉取。
 */
export function createDeptTree(exec: DbExecutor) {
  let nodesPromise: Promise<Map<number, DeptNode>> | null = null;
  let childrenIndex: Map<number, number[]> | null = null;

  function nodes(): Promise<Map<number, DeptNode>> {
    nodesPromise ??= (async () => {
      const rows = await exec
        .select({ id: departments.id, parentId: departments.parentId, leaderId: departments.leaderId })
        .from(departments);
      const map = new Map<number, DeptNode>();
      for (const r of rows) map.set(r.id, { parentId: r.parentId, leaderId: r.leaderId });
      return map;
    })();
    return nodesPromise;
  }

  /** parentId → 子部门 ID 列表；只在首次展开子树时构建一次 */
  async function children(): Promise<Map<number, number[]>> {
    if (childrenIndex) return childrenIndex;
    const map = await nodes();
    const index = new Map<number, number[]>();
    for (const [id, node] of map) {
      const pid = node.parentId;
      if (pid === null || pid === 0) continue;
      const siblings = index.get(pid);
      if (siblings) siblings.push(id);
      else index.set(pid, [id]);
    }
    childrenIndex = index;
    return index;
  }

  return {
    /** 部门负责人；部门不存在或未设置负责人返回 null */
    async leaderOf(deptId: number): Promise<number | null> {
      return (await nodes()).get(deptId)?.leaderId ?? null;
    },

    /** 上级部门 ID；已到顶层或部门不存在返回 null */
    async parentOf(deptId: number): Promise<number | null> {
      const parentId = (await nodes()).get(deptId)?.parentId ?? null;
      return parentId === 0 ? null : parentId;
    },

    /** 从给定部门向上走 levels 层；中途到顶或断链返回 null */
    async walkUp(startDeptId: number, levels: number): Promise<number | null> {
      const map = await nodes();
      let current: number | null = startDeptId;
      for (let i = 0; i < levels && current !== null; i++) {
        const parentId: number | null = map.get(current)?.parentId ?? null;
        if (parentId === null || parentId === 0) return null;
        current = parentId;
      }
      return current;
    },

    /** 部门及其所有上级部门 ID（含自身）；用于发起人维度条件「选父部门覆盖子部门」语义 */
    async ancestors(deptId: number): Promise<number[]> {
      const map = await nodes();
      const chain: number[] = [];
      const seen = new Set<number>();
      let current: number | null = deptId;
      while (current !== null && current !== 0 && !seen.has(current)) {
        seen.add(current);
        chain.push(current);
        current = map.get(current)?.parentId ?? null;
      }
      return chain;
    },

    /** 部门及其所有子部门 ID（含起始部门） */
    async withChildren(rootIds: readonly number[]): Promise<number[]> {
      const index = await children();
      const all = new Set<number>(rootIds);
      let frontier = [...rootIds];
      while (frontier.length > 0) {
        const next: number[] = [];
        for (const parentId of frontier) {
          for (const childId of index.get(parentId) ?? []) {
            if (!all.has(childId)) {
              all.add(childId);
              next.push(childId);
            }
          }
        }
        frontier = next;
      }
      return [...all];
    },
  };
}

export type DeptTree = ReturnType<typeof createDeptTree>;

/** 取得用户所在部门 */
async function getUserDept(exec: DbExecutor, userId: number): Promise<number | null> {
  const [row] = await exec.select({ deptId: users.departmentId })
    .from(users).where(eq(users.id, userId)).limit(1);
  return row?.deptId ?? null;
}

function uniquePositiveIds(ids: readonly number[] | null | undefined): number[] {
  return uniquePositiveInts(ids);
}

async function enabledUserIds(exec: DbExecutor, ids: readonly number[]): Promise<number[]> {
  const uniq = uniquePositiveIds(ids);
  if (uniq.length === 0) return [];
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, uniq), eq(users.status, 'enabled')));
  return rows.map((row) => row.id);
}

async function userIdsByRoleIds(exec: DbExecutor, roleIds: readonly number[]): Promise<number[]> {
  const uniq = uniquePositiveIds(roleIds);
  if (uniq.length === 0) return [];
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(inArray(userRoles.roleId, uniq), eq(users.status, 'enabled')));
  return rows.map((row) => row.id);
}

async function userIdsByDepartmentIds(exec: DbExecutor, deptIds: readonly number[]): Promise<number[]> {
  const uniq = uniquePositiveIds(deptIds);
  if (uniq.length === 0) return [];
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.departmentId, uniq), eq(users.status, 'enabled')));
  return rows.map((row) => row.id);
}

export async function resolveSelectScopeUserIds(
  node: WorkflowNodeConfig,
  executor?: DbExecutor,
): Promise<number[] | null> {
  const exec = executor ?? db;
  const scopeIds = uniquePositiveIds(node.selectScopeIds ?? []);
  if (scopeIds.length === 0) return null;
  switch (node.selectScopeType ?? 'user') {
    case 'user':
      return enabledUserIds(exec, scopeIds);
    case 'role':
      return userIdsByRoleIds(exec, scopeIds);
    case 'department':
      return userIdsByDepartmentIds(exec, scopeIds);
    case 'userGroup':
      return resolveGroupMemberUserIds(scopeIds, exec);
    default:
      return null;
  }
}

/** 候选审批人的公共条件：启用用户 ∩ 节点 selectScope；scope 已解析但为空时返回 null（不必查库） */
async function selectableApproverWhere(
  node: WorkflowNodeConfig,
  exec: DbExecutor,
  keyword?: string,
): Promise<SQL | undefined | null> {
  const scopeUserIds = await resolveSelectScopeUserIds(node, exec);
  if (scopeUserIds && scopeUserIds.length === 0) return null;
  return buildWhere(
    eq(users.status, 'enabled'),
    scopeUserIds ? inArray(users.id, scopeUserIds) : undefined,
    keywordCondition(keyword, [users.nickname, users.username], 'ilike'),
  );
}

const selectableUserColumns = { id: users.id, nickname: users.nickname, username: users.username };
const toSelectableUser = (row: { id: number; nickname: string | null; username: string }): WorkflowSelectableUser =>
  ({ id: row.id, name: row.nickname ?? row.username });

export async function listSelectableApprovers(
  node: WorkflowNodeConfig,
  executor?: DbExecutor,
): Promise<WorkflowSelectableUser[]> {
  const exec = executor ?? db;
  const where = await selectableApproverWhere(node, exec);
  if (where === null) return [];
  const rows = await exec.select(selectableUserColumns).from(users).where(where).orderBy(users.id);
  return rows.map(toSelectableUser);
}

export interface SelectableApproverSearch {
  keyword?: string;
  /** 每次最多返回的候选数；超出即 `truncated`，前端据此切换为关键词搜索 */
  limit: number;
}

/**
 * 限量 / 按关键词检索候选审批人。未配置 selectScope 的节点候选是全部启用用户，
 * 大组织下不能整表下发到审批面板，这里以 limit + 1 探测是否截断。
 */
export async function searchSelectableApprovers(
  node: WorkflowNodeConfig,
  search: SelectableApproverSearch,
  executor?: DbExecutor,
): Promise<{ items: WorkflowSelectableUser[]; truncated: boolean }> {
  const exec = executor ?? db;
  const where = await selectableApproverWhere(node, exec, search.keyword);
  if (where === null) return { items: [], truncated: false };
  const rows = await exec.select(selectableUserColumns).from(users).where(where).orderBy(users.id).limit(search.limit + 1);
  return { items: rows.slice(0, search.limit).map(toSelectableUser), truncated: rows.length > search.limit };
}

export async function filterSelectedApproverIds(
  node: WorkflowNodeConfig,
  selectedIds: readonly number[] | null | undefined,
  executor?: DbExecutor,
): Promise<number[]> {
  const picked = await enabledUserIds(executor ?? db, selectedIds ?? []);
  if (picked.length === 0) return [];
  const scopeUserIds = await resolveSelectScopeUserIds(node, executor);
  if (!scopeUserIds) return picked;
  const allow = new Set(scopeUserIds);
  return picked.filter((id) => allow.has(id));
}

/**
 * 构建发起人运行时上下文快照（部门祖先链 + 角色 + 岗位），
 * 供条件分支「发起人维度」（user/dept/role/post）求值。
 */
export async function buildStarterContext(
  initiatorId: number,
  executor?: DbExecutor,
): Promise<WorkflowStarterContext> {
  const exec = executor ?? db;
  const deptTree = createDeptTree(exec);
  const deptId = await getUserDept(exec, initiatorId);
  // 祖先链与角色/岗位三路并行；发起人无部门时完全不触碰部门表
  const [deptIds, roleRows, postRows] = await Promise.all([
    deptId ? deptTree.ancestors(deptId) : Promise.resolve<number[]>([]),
    exec.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, initiatorId)),
    exec.select({ positionId: userPositions.positionId }).from(userPositions).where(eq(userPositions.userId, initiatorId)),
  ]);
  return {
    userId: initiatorId,
    deptIds,
    roleIds: roleRows.map((r) => r.roleId),
    postIds: postRows.map((r) => r.positionId),
  };
}

/**
 * 解析指定用户的上级（部门负责人）。level=1 取所在部门负责人，level>1 沿部门链向上。
 * 用于超时升级「转交给上级」。找不到返回 null。
 */
export async function resolveUserManagerId(
  userId: number,
  level = 1,
  executor?: DbExecutor,
): Promise<number | null> {
  const exec = executor ?? db;
  const startDeptId = await getUserDept(exec, userId);
  if (!startDeptId) return null;
  const lv = Math.max(1, level);
  // level=1（超时升级的默认配置）只需一次索引查询；更深才值得走部门树
  if (lv === 1) return fetchDeptLeader(exec, startDeptId);
  const deptTree = createDeptTree(exec);
  const targetDeptId = await deptTree.walkUp(startDeptId, lv - 1);
  if (targetDeptId === null) return null;
  return deptTree.leaderOf(targetDeptId);
}

export async function resolveUserDeptHeadId(
  userId: number,
  executor?: DbExecutor,
): Promise<number | null> {
  const exec = executor ?? db;
  const deptId = await getUserDept(exec, userId);
  if (!deptId) return null;
  const leaderId = await fetchDeptLeader(exec, deptId);
  if (!leaderId || leaderId === userId) return null;
  const [leader] = await exec.select({ id: users.id }).from(users)
    .where(and(eq(users.id, leaderId), eq(users.status, 'enabled')))
    .limit(1);
  return leader?.id ?? null;
}

export async function resolveAdminUserId(executor?: DbExecutor): Promise<number | null> {
  const exec = executor ?? db;
  const [admin] = await exec.select({ id: users.id }).from(users)
    .where(and(eq(users.username, 'admin'), eq(users.status, 'enabled')))
    .limit(1);
  if (admin) return admin.id;
  const [firstEnabled] = await exec.select({ id: users.id }).from(users)
    .where(eq(users.status, 'enabled'))
    .limit(1);
  return firstEnabled?.id ?? null;
}

/** 审批人表达式可引用的根变量 */
export const ASSIGNEE_EXPR_ROOTS = ['form', 'starter'] as const;

/**
 * 安全表达式求值器，作用域限定在 form / starter，返回 user ID 数组。
 * 例如： `form.managerId`, `[form.a, form.b]`, `starter.id`, `form.amount > 1000 ? form.vp : form.lead`
 * 求值经 workflow-expression 的 AST 解释器（无 new Function / 无全局可达），从根本上杜绝 RCE。
 */
function evalAssigneeExpression(
  expr: string,
  ctx: { form: Record<string, unknown>; starter: { id: number }; },
): number[] {
  try {
    const v = evaluateExpression(expr, { form: ctx.form, starter: ctx.starter });
    if (typeof v === 'number' && Number.isFinite(v)) return [v];
    if (Array.isArray(v)) {
      return v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    }
    return [];
  } catch (err) {
    if (err instanceof ExpressionError) {
      logger.warn('[assignee-resolver] 拒绝执行非法的审批人表达式', { expr, error: err.message });
    } else {
      logger.warn('[assignee-resolver] 审批人表达式求值失败', { expr });
    }
    return [];
  }
}

/** 将节点配置解析为去重后的用户 ID 数组 */
export async function resolveAssigneeIds(
  node: WorkflowNodeConfig,
  ctx: ResolveAssigneeContext,
): Promise<number[]> {
  const exec = ctx.executor ?? db;
  const type = node.assigneeType;
  if (!type) return [];

  const result = new Set<number>();
  // 惰性部门树：仅在走到部门相关分支时才真正查询；批量解析可由调用方通过 ctx 复用
  const deptTree = ctx.deptTree ?? createDeptTree(exec);

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
      const picked = await filterSelectedApproverIds(node, ctx.selectedNextApprovers ?? [], exec);
      picked.forEach((id) => result.add(id));
      break;
    }
    case 'role': {
      const roleIds = node.roleIds ?? [];
      if (roleIds.length > 0) {
        // 1) 查角色管理范围（按角色聚合部门）
        const scopeRows = await exec
          .select({ roleId: roleDeptScopes.roleId, deptId: roleDeptScopes.deptId })
          .from(roleDeptScopes)
          .where(inArray(roleDeptScopes.roleId, roleIds));
        const scopeByRole = new Map<number, number[]>();
        for (const r of scopeRows) {
          const arr = scopeByRole.get(r.roleId) ?? [];
          arr.push(r.deptId);
          scopeByRole.set(r.roleId, arr);
        }
        // 2) 查角色成员
        const memberRows = await exec
          .select({ userId: userRoles.userId, roleId: userRoles.roleId })
          .from(userRoles)
          .where(inArray(userRoles.roleId, roleIds));
        const hasScoped = scopeByRole.size > 0;
        // 3) 若存在管理范围，预取所有相关用户的部门信息
        const userDeptMap = new Map<number, number | null>();
        if (hasScoped) {
          const userIds = [...new Set(memberRows.map((r) => r.userId))];
          if (userIds.length > 0) {
            const rows = await exec.select({ id: users.id, deptId: users.departmentId })
              .from(users).where(inArray(users.id, userIds));
            rows.forEach((r) => userDeptMap.set(r.id, r.deptId));
          }
        }
        // 4) 展开每个角色的范围部门（含子部门）
        //    子部门索引在 deptTree 内只构建一次，逐角色展开是纯内存 BFS
        const expandedScopeByRole = new Map<number, Set<number>>();
        for (const [roleId, deptIds] of scopeByRole) {
          expandedScopeByRole.set(roleId, new Set(await deptTree.withChildren(deptIds)));
        }
        // 5) 按角色判定成员
        for (const m of memberRows) {
          const scopeSet = expandedScopeByRole.get(m.roleId);
          if (!scopeSet) {
            // 该角色无管理范围 → 全员
            result.add(m.userId);
            continue;
          }
          const dept = userDeptMap.get(m.userId);
          if (dept !== null && dept !== undefined && scopeSet.has(dept)) {
            result.add(m.userId);
          }
        }
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
      // 未指定：取发起人部门的负责人（单跳，走索引查询）
      const deptId = await getUserDept(exec, ctx.initiatorId);
      if (deptId) {
        const leader = await fetchDeptLeader(exec, deptId);
        if (leader) result.add(leader);
      }
      break;
    }
    case 'userGroup': {
      // 统一口径：仅启用组的启用成员参与审批（禁用组/禁用用户不再被路由到）
      const ids = await resolveGroupMemberUserIds(node.userGroupIds ?? [], exec);
      ids.forEach((id) => result.add(id));
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
      if (level === 1) {
        // 单跳：一次索引查询即可，不值得拉整棵树
        const leader = await fetchDeptLeader(exec, startDeptId);
        if (leader) result.add(leader);
        break;
      }
      const targetDeptId = await deptTree.walkUp(startDeptId, level - 1);
      if (targetDeptId !== null) {
        const leader = await deptTree.leaderOf(targetDeptId);
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
        const leader = await deptTree.leaderOf(currentDept);
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
        currentDept = await deptTree.parentOf(currentDept);
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
      if (level === 1) {
        // 单跳：一次 IN 查询批量取负责人，替代逐部门查询
        (await fetchDeptLeaders(exec, deptIds)).forEach((id) => result.add(id));
        break;
      }
      for (const startDeptId of deptIds) {
        const targetDeptId = await deptTree.walkUp(startDeptId, level - 1);
        if (targetDeptId !== null) {
          const leader = await deptTree.leaderOf(targetDeptId);
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
        ? await deptTree.withChildren(seedIds)
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
      // 发起人部门的分管领导 → 取上一级部门的负责人（两次单跳索引查询）
      const startDeptId = await getUserDept(exec, ctx.initiatorId);
      if (!startDeptId) break;
      const parentDeptId = await fetchDeptParent(exec, startDeptId);
      if (parentDeptId === null) break;
      const leader = await fetchDeptLeader(exec, parentDeptId);
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
    case 'decision': {
      // 审批人矩阵：查决策表得「来源类型 + id 列表」，复用现有 role/dept/post/user 解析
      if (!node.decisionRuleKey) break;
      const { outputs: out } = await decide(
        { kind: 'table', key: node.decisionRuleKey },
        { form: ctx.formData ?? {}, starter: { id: ctx.initiatorId } },
        { caller: 'workflow.assignee', bizRef: ctx.instanceId ? `workflow:${ctx.instanceId}` : null },
      );
      const srcType = String(out.type ?? out.assigneeType ?? 'user') as WorkflowAssigneeType;
      const raw = out.ids ?? out.id ?? '';
      const ids = (Array.isArray(raw) ? raw : String(raw).split(',')).map((x) => Number(x)).filter((n) => Number.isFinite(n));
      if (ids.length === 0) break;
      const sub: WorkflowNodeConfig = { ...node, assigneeType: srcType, userIds: srcType === 'user' ? ids : undefined, roleIds: srcType === 'role' ? ids : undefined, deptIds: srcType === 'department' ? ids : undefined, postIds: srcType === 'post' ? ids : undefined, decisionRuleKey: undefined };
      (await resolveAssigneeIds(sub, ctx)).forEach((id) => result.add(id));
      break;
    }
  }

  return [...result];
}
