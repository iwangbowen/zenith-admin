// ─── 实例/待办/已办/抄送列表查询与详情（拆分自 workflow-instances.service.ts）───
import { formatDateTime } from '../../../lib/datetime';
import { count, countDistinct, eq, and, desc, ilike, or, inArray, sql, type SQL } from 'drizzle-orm';
import { escapeLike, withPagination } from '../../../lib/where-helpers';
import { db } from '../../../db';
import { pageOffset } from '../../../lib/pagination';
import { workflowInstances, workflowTasks, workflowDefinitions, workflowCategories, users } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import { getDataScopeCondition } from '../../../lib/data-scope';
import type { WorkflowFieldPermission, WorkflowFlowData, WorkflowFormField } from '@zenith/shared';
import { buildWorkflowSummaryItems, findNextApproverSelectNodes, resolveNodeFieldPermissions } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { isSuperAdmin, getUserPermissions } from '../../../lib/permissions';
import { loadInstanceCommentsForDetail } from '../workflow-comments.service';
import { loadInstanceConsultsForDetail } from '../workflow-consults.service';
import { loadInstanceTransfersByTask } from './transfers';
import { mapInstance, mapTask } from './mapping';

type InstanceStatus = 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn';

/** 优先级排序：urgent > high > normal > low（用于审批/申请列表置顶加急） */
const priorityRankOrder = sql`CASE ${workflowInstances.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;

/** 实例标题或流程名称模糊匹配条件（需联表 workflowDefinitions） */
function titleOrDefinitionNameLike(keyword: string) {
  const likeValue = `%${escapeLike(keyword)}%`;
  return or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue))!;
}

/** 任务联实例/定义/发起人的行选择（待办/抄送/已办列表共用） */
function selectTaskJoinedInstanceRows() {
  return db
    .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar, task: workflowTasks })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowInstances.initiatorId, users.id));
}

/** 抄送/已办列表共用的 count + 分页双查询（并行执行） */
async function queryTaskJoinedInstancePage(opts: { where: SQL | undefined; orderBy: SQL; page: number; pageSize: number }) {
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .where(opts.where),
    withPagination(
      selectTaskJoinedInstanceRows()
        .where(opts.where)
        .orderBy(opts.orderBy)
        .$dynamic(),
      opts.page, opts.pageSize,
    ),
  ]);
  return { total: Number(total), rows };
}

async function loadActiveNodeKeysByInstance(instanceIds: number[]): Promise<Map<number, string[]>> {  if (instanceIds.length === 0) return new Map();
  const rows = await db.select({
    instanceId: workflowTasks.instanceId,
    nodeKey: workflowTasks.nodeKey,
  }).from(workflowTasks)
    .where(and(
      inArray(workflowTasks.instanceId, [...new Set(instanceIds)]),
      inArray(workflowTasks.status, ['pending', 'waiting']),
    ))
    .orderBy(workflowTasks.id);
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const keys = map.get(row.instanceId) ?? [];
    if (!keys.includes(row.nodeKey)) keys.push(row.nodeKey);
    map.set(row.instanceId, keys);
  }
  return map;
}

export async function listMyInstances(query: { page?: number; pageSize?: number; status?: string; priority?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status, priority } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.initiatorId, user.userId)];
  if (tc) conditions.push(tc);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  if (priority) conditions.push(eq(workflowInstances.priority, priority));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(workflowInstances, where),
    db.query.workflowInstances.findMany({
      where,
      with: {
        definition: { columns: { name: true } },
        initiator: { columns: { nickname: true, avatar: true } },
      },
      orderBy: [priorityRankOrder, desc(workflowInstances.id)],
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.id));
  return {
    list: rows.map((r) => mapInstance(r, {
      definitionName: r.definition?.name ?? null,
      initiatorName: r.initiator?.nickname ?? null,
      initiatorAvatar: r.initiator?.avatar ?? null,
      currentNodeKeys: activeNodeKeys.get(r.id),
    })),
    total, page, pageSize,
  };
}

type SlaTimeoutInput = { enabled?: boolean; duration?: number; unit?: 'minutes' | 'hours' | 'days' } | null | undefined;

/** 根据节点超时配置与任务创建时间，计算待办 SLA：剩余/超时秒数与紧急度。 */
function computeTaskSla(timeout: SlaTimeoutInput, createdAt: Date): { slaLevel: 'none' | 'safe' | 'warning' | 'overdue'; slaDeadline: string | null; slaOverdueSec: number | null } {
  if (!timeout?.enabled || !timeout.duration || timeout.duration <= 0) {
    return { slaLevel: 'none', slaDeadline: null, slaOverdueSec: null };
  }
  const unitMin = timeout.unit === 'minutes' ? 1 : timeout.unit === 'days' ? 1440 : 60;
  const totalSec = timeout.duration * unitMin * 60;
  const deadlineMs = createdAt.getTime() + totalSec * 1000;
  const overdueSec = Math.round((Date.now() - deadlineMs) / 1000);
  let slaLevel: 'safe' | 'warning' | 'overdue';
  if (overdueSec >= 0) slaLevel = 'overdue';
  else if (-overdueSec <= Math.max(3600, totalSec * 0.2)) slaLevel = 'warning';
  else slaLevel = 'safe';
  return { slaLevel, slaDeadline: formatDateTime(new Date(deadlineMs)), slaOverdueSec: overdueSec };
}

/** 从实例的表单快照 + 流程设置 summaryFields 构建列表摘要（未配置返回空数组） */
function resolveInstanceSummary(
  inst: { formSnapshot: unknown; formData: unknown },
  flow: WorkflowFlowData | undefined,
) {
  const summaryKeys = flow?.settings?.summaryFields;
  if (!summaryKeys?.length) return [];
  const snap = inst.formSnapshot as { fields?: WorkflowFormField[] } | WorkflowFormField[] | null;
  const fields = Array.isArray(snap) ? snap : snap?.fields ?? [];
  return buildWorkflowSummaryItems(fields, (inst.formData ?? {}) as Record<string, unknown>, summaryKeys);
}

export async function listPendingMine(query: { page?: number; pageSize?: number; keyword?: string; definitionId?: number }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword, definitionId } = query;
  const tc = tenantCondition(workflowInstances, user);
  const baseConditions = [
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.status, 'pending'),
    eq(workflowInstances.status, 'running'),
  ];
  if (tc) baseConditions.push(tc);
  if (keyword) baseConditions.push(titleOrDefinitionNameLike(keyword));
  if (definitionId !== undefined) baseConditions.push(eq(workflowInstances.definitionId, definitionId));
  const where = and(...baseConditions);
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: countDistinct(workflowInstances.id) })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(where),
    withPagination(
      selectTaskJoinedInstanceRows()
        .where(where)
        .orderBy(priorityRankOrder, desc(workflowTasks.createdAt))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    list: rows.map((r) => {
      const flow = r.inst.definitionSnapshot?.flowData ?? undefined;
      const node = flow?.nodes.find((n) => n.data.key === r.task.nodeKey)?.data;
      const pendingSignatureRequired = node?.operations?.includes('signature') ?? false;
      // 紧邻下一节点为「审批人自选」的任务无法批量审批（需逐个指定下一节点审批人），列表提前标注
      const requiresIndividual = flow ? findNextApproverSelectNodes(flow, r.task.nodeKey).length > 0 : false;
      const sla = computeTaskSla(node?.timeout, r.task.createdAt);
      const summary = resolveInstanceSummary(r.inst, flow);
      return { ...mapInstance(r.inst, { ...r, currentNodeKeys: activeNodeKeys.get(r.inst.id) }), pendingTaskId: r.task.id, pendingSignatureRequired, requiresIndividual, summary, ...sla };
    }),
    total: Number(total),
    page,
    pageSize,
  };
}

/** G1 抄送我的：nodeType=ccNode 且 assigneeId=当前用户的任务对应的实例 */
export async function listMyCc(query: { page?: number; pageSize?: number; keyword?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.nodeType, 'ccNode'),
  ];
  if (tc) conditions.push(tc);
  if (keyword) conditions.push(titleOrDefinitionNameLike(keyword));
  const where = and(...conditions);
  const { total, rows } = await queryTaskJoinedInstancePage({ where, orderBy: desc(workflowTasks.id), page, pageSize });
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    list: rows.map((r) => mapInstance(r.inst, {
      definitionName: r.definitionName,
      initiatorName: r.initiatorName,
      initiatorAvatar: r.initiatorAvatar,
      currentNodeKeys: activeNodeKeys.get(r.inst.id),
      ccTaskId: r.task.id,
      ccReadAt: r.task.ccReadAt,
    })),
    total,
    page,
    pageSize,
  };
}

/** G1/T1-2 抄送未读数：当前用户 ccNode 任务中 ccReadAt 为空的数量 */
export async function countMyCcUnread(): Promise<number> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.nodeType, 'ccNode'),
    sql`${workflowTasks.ccReadAt} is null`,
  ];
  const where = and(...conditions);
  const [{ total }] = await db
    .select({ total: count() })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(tc ? and(where, tc) : where);
  return Number(total);
}

/** 待我审批总数：菜单角标与实时提醒使用（与 listPendingMine 同源过滤条件） */
export async function countPendingMine(): Promise<number> {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.status, 'pending'),
    eq(workflowInstances.status, 'running'),
  ];
  if (tc) conditions.push(tc);
  const [{ total }] = await db
    .select({ total: countDistinct(workflowInstances.id) })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(and(...conditions));
  return Number(total);
}

/** T2-2 关联审批单候选：当前用户可见（本人发起或参与）的非草稿实例，供 relation 字段检索 */
export async function listRelationOptions(query: { definitionId?: number; keyword?: string; limit?: number }) {
  const user = currentUser();
  const { definitionId, keyword, limit = 20 } = query;
  const tc = tenantCondition(workflowInstances, user);
  const participantSub = db.select({ id: workflowTasks.instanceId }).from(workflowTasks)
    .where(eq(workflowTasks.assigneeId, user.userId));
  const conds = [
    sql`${workflowInstances.status} <> 'draft'`,
    or(eq(workflowInstances.initiatorId, user.userId), inArray(workflowInstances.id, participantSub))!,
  ];
  if (tc) conds.push(tc);
  if (definitionId) conds.push(eq(workflowInstances.definitionId, definitionId));
  if (keyword) {
    const v = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(workflowInstances.title, v), ilike(workflowInstances.serialNo, v))!);
  }
  const rows = await db.select({ inst: workflowInstances, definitionName: workflowDefinitions.name })
    .from(workflowInstances)
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .where(and(...conds))
    .orderBy(desc(workflowInstances.id))
    .limit(Math.min(limit, 50));
  return rows.map((r) => ({
    instanceId: r.inst.id,
    title: r.inst.title,
    serialNo: r.inst.serialNo ?? null,
    definitionName: r.definitionName ?? null,
    status: r.inst.status,
    createdAt: formatDateTime(r.inst.createdAt),
  }));
}

/** G2 已办：当前用户处理过（approved/rejected）的任务对应的实例 */
export async function listMyHandled(query: { page?: number; pageSize?: number; keyword?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [
    eq(workflowTasks.assigneeId, user.userId),
    inArray(workflowTasks.status, ['approved', 'rejected']),
  ];
  if (tc) conditions.push(tc);
  if (keyword) conditions.push(titleOrDefinitionNameLike(keyword));
  const where = and(...conditions);
  const { total, rows } = await queryTaskJoinedInstancePage({ where, orderBy: desc(workflowTasks.actionAt), page, pageSize });
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    list: rows.map((r) => mapInstance(r.inst, {
      definitionName: r.definitionName,
      initiatorName: r.initiatorName,
      initiatorAvatar: r.initiatorAvatar,
      currentNodeKeys: activeNodeKeys.get(r.inst.id),
      myTaskStatus: r.task.status,
      myActionAt: r.task.actionAt,
    })),
    total,
    page,
    pageSize,
  };
}

export async function listAllInstances(query: { page?: number; pageSize?: number; status?: string; keyword?: string; categoryId?: number; initiatorKeyword?: string; priority?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status, keyword, categoryId, initiatorKeyword, priority } = query;
  const conditions = [];
  const tc = tenantCondition(workflowInstances, user);
  if (tc) conditions.push(tc);
  // T2-3 数据权限：按发起人部门限制非超管可见的实例范围
  const scopeCond = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });
  if (scopeCond) conditions.push(scopeCond);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  if (keyword) {
    const likeValue = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue)));
  }
  if (categoryId !== undefined) conditions.push(eq(workflowDefinitions.categoryId, categoryId));
  if (initiatorKeyword) conditions.push(ilike(users.nickname, `%${escapeLike(initiatorKeyword)}%`));
  if (priority) conditions.push(eq(workflowInstances.priority, priority));
  const where = and(...conditions);
  const statWhere = scopeCond ? (tc ? and(tc, scopeCond) : scopeCond) : tc;
  const [statRows, [{ total }], rows] = await Promise.all([
    db.select({ status: workflowInstances.status, cnt: count() })
      .from(workflowInstances)
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(statWhere)
      .groupBy(workflowInstances.status),
    db.select({ total: count() })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(workflowCategories, eq(workflowDefinitions.categoryId, workflowCategories.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(where),
    withPagination(
      db.select({
        inst: workflowInstances,
        definitionName: workflowDefinitions.name,
        categoryId: workflowDefinitions.categoryId,
        categoryName: workflowCategories.name,
        initiatorName: users.nickname,
        initiatorAvatar: users.avatar,
      })
        .from(workflowInstances)
        .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .leftJoin(workflowCategories, eq(workflowDefinitions.categoryId, workflowCategories.id))
        .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
        .where(where)
        .orderBy(priorityRankOrder, desc(workflowInstances.id))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const stats: Record<string, number> = { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0 };
  for (const r of statRows) {
    stats[r.status] = r.cnt;
    stats.total += r.cnt;
  }
  const activeNodeKeys = await loadActiveNodeKeysByInstance(rows.map((row) => row.inst.id));
  return {
    stats,
    list: rows.map((r) => mapInstance(r.inst, { ...r, currentNodeKeys: activeNodeKeys.get(r.inst.id) })),
    total,
    page,
    pageSize,
  };
}

/**
 * 读侧 formData 字段脱敏：按查看者相对本实例的身份收集其可依据的字段权限映射
 * （发起人 → start 节点 fieldPermissions；参与人 → 其任务节点 fieldPermissions 并集），
 * 仅当字段在**所有**相关映射中均为 hidden 时才剔除。
 *
 * 兼容边界（保守语义，不破坏既有流程）：
 * - 任一相关节点未配置 fieldPermissions → 返回全量（未启用字段权限的流程完全不受影响）；
 * - 查看者与任何节点无关（如子流程祖先发起人）→ 返回全量；
 * - 监控管理员/超管在调用方短路，不进入本函数。
 */
export function sanitizeDetailFormDataForViewer(
  row: {
    formData: unknown;
    initiatorId: number;
    definitionSnapshot: { flowData?: WorkflowFlowData | null } | null;
    tasks: Array<{ assigneeId: number | null; nodeKey: string }>;
  },
  userId: number,
): typeof row.formData {
  const formData = row.formData;
  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return formData;
  const flowData = row.definitionSnapshot?.flowData;
  if (!flowData?.nodes?.length) return formData;

  const permMaps: Array<Record<string, WorkflowFieldPermission>> = [];
  if (row.initiatorId === userId) {
    const startPerms = flowData.nodes.find((n) => n.data.type === 'start')?.data.fieldPermissions;
    if (!startPerms) return formData;
    permMaps.push(startPerms);
  }
  const myNodeKeys = new Set(row.tasks.filter((t) => t.assigneeId === userId).map((t) => t.nodeKey));
  for (const nodeKey of myNodeKeys) {
    const perms = resolveNodeFieldPermissions(flowData, nodeKey);
    if (!perms) return formData;
    permMaps.push(perms);
  }
  if (permMaps.length === 0) return formData;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formData as Record<string, unknown>)) {
    const hiddenEverywhere = permMaps.every((m) => m[key] === 'hidden');
    if (!hiddenEverywhere) out[key] = value;
  }
  return out;
}

export async function getInstanceDetail(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const row = await db.query.workflowInstances.findFirst({
    where: and(...conditions),
    with: {
      definition: { columns: { name: true } },
      initiator: { columns: { nickname: true, avatar: true } },
      tasks: {
        with: { assignee: { columns: { nickname: true, avatar: true } } },
        orderBy: workflowTasks.id,
      },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程实例不存在' });
  const isInitiator = row.initiatorId === user.userId;
  const isAssignee = row.tasks.some((t) => t.assigneeId === user.userId);
  // 流程监控管理员（workflow:instance:monitor）可查看租户可见范围内的任意实例详情，
  // 与「全局流程实例列表」权限口径一致（列表能看到却打不开详情属契约断裂）
  const isMonitor = isSuperAdmin(user)
    || (await getUserPermissions(user.userId)).includes('workflow:instance:monitor');
  let allowed = isInitiator || isAssignee || isMonitor;
  if (!allowed && row.parentInstanceId) {
    // 子流程实例：若用户是任一祖先实例的发起人，允许查看（支持嵌套子流程）
    let pid: number | null = row.parentInstanceId;
    for (let i = 0; i < 10 && pid; i++) {
      const [anc]: Array<{ initiatorId: number; parentInstanceId: number | null }> = await db
        .select({ initiatorId: workflowInstances.initiatorId, parentInstanceId: workflowInstances.parentInstanceId })
        .from(workflowInstances).where(eq(workflowInstances.id, pid)).limit(1);
      if (!anc) break;
      if (anc.initiatorId === user.userId) { allowed = true; break; }
      pid = anc.parentInstanceId;
    }
  }
  if (!allowed) throw new HTTPException(403, { message: '无权查看' });
  const snapshot = row.definitionSnapshot;
  // 转办明细 / 子实例 / 评论 / 征询相互独立，权限判定通过后并行加载
  const [transfersByTask, childRows, comments, consults] = await Promise.all([
    loadInstanceTransfersByTask(id),
    db.select({
      id: workflowInstances.id,
      title: workflowInstances.title,
      status: workflowInstances.status,
      parentTaskId: workflowInstances.parentTaskId,
      createdAt: workflowInstances.createdAt,
    }).from(workflowInstances)
      .where(eq(workflowInstances.parentInstanceId, id))
      .orderBy(workflowInstances.id),
    loadInstanceCommentsForDetail(id),
    loadInstanceConsultsForDetail(id),
  ]);
  const tasks = row.tasks.map((t) => {
    const cfg = snapshot?.flowData?.nodes.find((n) => n.data.key === t.nodeKey)?.data;
    const actionButtons = cfg?.actionButtons;
    const signatureRequired = cfg?.operations?.includes('signature') ?? false;
    return mapTask(t, t.assignee?.nickname, t.assignee?.avatar, actionButtons ?? null, signatureRequired, transfersByTask.get(t.id) ?? null);
  });
  const taskNodeKeyById = new Map(row.tasks.map((t) => [t.id, t.nodeKey]));
  const childInstances = childRows.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    parentTaskNodeKey: c.parentTaskId != null ? (taskNodeKeyById.get(c.parentTaskId) ?? null) : null,
    createdAt: formatDateTime(c.createdAt),
  }));
  // 读侧字段脱敏：非监控身份按查看者的节点字段权限剔除 hidden 字段（配置缺失时全量，兼容旧流程）
  const sanitizedRow = isMonitor ? row : { ...row, formData: sanitizeDetailFormDataForViewer(row, user.userId) };
  return mapInstance(sanitizedRow, {
    definitionName: row.definition?.name ?? null,
    initiatorName: row.initiator?.nickname ?? null,
    initiatorAvatar: row.initiator?.avatar ?? null,
    tasks,
    childInstances,
    comments,
    consults,
    includeDefinitionSnapshot: true,
  });
}
