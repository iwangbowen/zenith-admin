// ─── 数据映射 ─────────────────────────────────────────────────────────────────
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';

export function mapTask(
  row: typeof workflowTasks.$inferSelect,
  assigneeName?: string | null,
  assigneeAvatar?: string | null,
) {
  return {
    id: row.id,
    instanceId: row.instanceId,
    nodeKey: row.nodeKey,
    nodeName: row.nodeName,
    nodeType: row.nodeType ?? null,
    assigneeId: row.assigneeId,
    assigneeName: assigneeName ?? null,
    assigneeAvatar: assigneeAvatar ?? null,
    status: row.status,
    comment: row.comment,
    actionAt: formatNullableDateTime(row.actionAt),
    externalCallbackId: row.externalCallbackId ?? null,
    externalDispatchStatus: row.externalDispatchStatus ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export function mapInstance(
  row: typeof workflowInstances.$inferSelect,
  extras: {
    definitionName?: string | null;
    categoryId?: number | null;
    categoryName?: string | null;
    initiatorName?: string | null;
    initiatorAvatar?: string | null;
    tasks?: ReturnType<typeof mapTask>[];
  } = {},
) {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: extras.definitionName ?? null,
    categoryId: extras.categoryId ?? null,
    categoryName: extras.categoryName ?? null,
    title: row.title,
    formData: row.formData,
    status: row.status,
    currentNodeKey: row.currentNodeKey,
    initiatorId: row.initiatorId,
    initiatorName: extras.initiatorName ?? null,
    initiatorAvatar: extras.initiatorAvatar ?? null,
    tenantId: row.tenantId,
    tasks: extras.tasks ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { count, countDistinct, eq, and, desc, ilike, or } from 'drizzle-orm';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { workflowInstances, workflowTasks, workflowDefinitions, workflowCategories, users } from '../db/schema';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { advanceFlow, getInitialTasks, validateFlowData, type TaskAction } from '../lib/workflow-engine';
import type { WorkflowApproveMethod, WorkflowFlowData, WorkflowTask as WorkflowTaskDto } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { resolveAssigneeIds } from './workflow-assignee-resolver.service';
import type { DbExecutor } from '../db/types';
import { workflowEventBus } from '../lib/workflow-event-bus';

/** 发射实例生命周期事件的辅助函数 */
function emitInstanceEvent(
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn',
  instance: ReturnType<typeof mapInstance>,
  actor: { userId: number; name?: string | null },
) {
  workflowEventBus.emit({
    type,
    instanceId: instance.id,
    definitionId: instance.definitionId,
    tenantId: instance.tenantId ?? null,
    actor,
    instance,
  } as Parameters<typeof workflowEventBus.emit>[0]);
}

/** 发射任务生命周期事件的辅助函数 */
function emitTaskEvent(
  type: 'task.created' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.assigned',
  task: WorkflowTaskDto,
  meta: { definitionId: number; tenantId: number | null; actor?: { userId: number; name?: string | null }; comment?: string | null },
) {
  workflowEventBus.emit({
    type,
    instanceId: task.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    task,
    comment: meta.comment,
  } as Parameters<typeof workflowEventBus.emit>[0]);
}

/** 发射节点进入/离开事件 */
function emitNodeEvent(
  type: 'node.entered' | 'node.left',
  meta: { instanceId: number; definitionId: number; tenantId: number | null; nodeKey: string; nodeName: string; nodeType: WorkflowTaskDto['nodeType']; actor?: { userId: number; name?: string | null } },
) {
  workflowEventBus.emit({
    type,
    instanceId: meta.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    nodeKey: meta.nodeKey,
    nodeName: meta.nodeName,
    nodeType: meta.nodeType,
  } as Parameters<typeof workflowEventBus.emit>[0]);
}

/**
 * 将引擎输出的 TaskAction[] 展开为实际需插入的 workflow_tasks 行。
 * - approve / handler：调用 resolver 展开为多人，依据 approveMethod 写入状态／sequence
 * - ccNode / delay / trigger / subProcess：保持原样
 */
async function expandTasksToRows(
  tasks: TaskAction[],
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown> },
): Promise<Array<typeof workflowTasks.$inferInsert>> {
  const rows: Array<typeof workflowTasks.$inferInsert> = [];
  for (const t of tasks) {
    if (t.nodeType !== 'approve' && t.nodeType !== 'handler') {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: t.assigneeId,
        status: t.nodeType === 'ccNode' ? 'skipped' as const : 'pending' as const,
      });
      continue;
    }
    // 节点级"自动通过/拒绝"开关（前端 ApprovalType）也可能通过 nodeConfig 传入；
    // 这里先处理 approveMethod=='auto' 的多人审批"自动通过"语义：直接落 approved 行。
    const rawMethod = t.nodeConfig.approveMethod;
    if (rawMethod === 'auto') {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: null,
        status: 'approved' as const,
        actionAt: new Date(),
      });
      continue;
    }

    const userIds = await resolveAssigneeIds(t.nodeConfig, {
      initiatorId: ctx.initiatorId,
      executor: ctx.executor,
      formData: ctx.formData,
      instanceId: ctx.instanceId,
    });
    // 未解析到任何人：写入一条无 assignee 的 pending 任务作为占位（避免隐性 stall）
    if (userIds.length === 0) {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: null,
        status: 'pending' as const,
      });
      continue;
    }
    const fallbackMethod: Exclude<WorkflowApproveMethod, 'auto'> = userIds.length > 1 ? 'and' : 'or';
    const method: Exclude<WorkflowApproveMethod, 'auto'> = rawMethod ?? fallbackMethod;
    userIds.forEach((uid, idx) => {
      rows.push({
        instanceId: ctx.instanceId,
        nodeKey: t.nodeKey,
        nodeName: t.nodeName,
        nodeType: t.nodeType,
        assigneeId: uid,
        // 顺序会签：只有第一人 pending，其余 waiting
        status: method === 'sequential' && idx > 0 ? 'waiting' as const : 'pending' as const,
        taskOrder: method === 'sequential' ? idx : null,
        approveMethod: userIds.length > 1 ? method : null,
      });
    });
  }
  return rows;
}

/**
 * 检查同一 (instanceId, nodeKey) 下的全部任务是否已达成完成条件。
 * - and （会签）：所有人 approved 才完成
 * - or  （或签）：任一人 approved 即完成，其余 pending 任务自动 skipped
 * - sequential（顺序会签）：逐个转换 waiting -> pending，全部 approved 后完成
 */
async function checkNodeCompletion(
  tx: DbExecutor,
  instanceId: number,
  nodeKey: string,
): Promise<{ completed: boolean; method: WorkflowApproveMethod | null }> {
  const siblings = await tx.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeKey, nodeKey)));
  if (siblings.length === 0) return { completed: true, method: null };
  const method = siblings.find((t) => t.approveMethod)?.approveMethod ?? null;

  if (!method || method === 'and') {
    const allDone = siblings.every((t) => t.status === 'approved' || t.status === 'skipped');
    return { completed: allDone, method };
  }
  if (method === 'or') {
    const anyApproved = siblings.some((t) => t.status === 'approved');
    if (anyApproved) {
      // 其余 pending 任务跳过
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
        .where(and(
          eq(workflowTasks.instanceId, instanceId),
          eq(workflowTasks.nodeKey, nodeKey),
          eq(workflowTasks.status, 'pending'),
        ));
      return { completed: true, method };
    }
    return { completed: false, method };
  }
  if (method === 'sequential') {
    const allApproved = siblings.every((t) => t.status === 'approved');
    if (allApproved) return { completed: true, method };
    // 将下一个 waiting 按 taskOrder 提升为 pending
    const nextWaiting = siblings
      .filter((t) => t.status === 'waiting')
      .sort((a, b) => (a.taskOrder ?? 0) - (b.taskOrder ?? 0))[0];
    if (nextWaiting) {
      await tx.update(workflowTasks).set({ status: 'pending' })
        .where(eq(workflowTasks.id, nextWaiting.id));
    }
    return { completed: false, method };
  }
  return { completed: false, method };
}

type InstanceStatus = 'draft' | 'running' | 'approved' | 'rejected' | 'withdrawn';

export async function listMyInstances(query: { page?: number; pageSize?: number; status?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status } = query;
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.initiatorId, user.userId)];
  if (tc) conditions.push(tc);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(workflowInstances, where),
    db.query.workflowInstances.findMany({
      where,
      with: {
        definition: { columns: { name: true } },
        initiator: { columns: { nickname: true, avatar: true } },
      },
      orderBy: desc(workflowInstances.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return {
    list: rows.map((r) => mapInstance(r, {
      definitionName: r.definition?.name ?? null,
      initiatorName: r.initiator?.nickname ?? null,
      initiatorAvatar: r.initiator?.avatar ?? null,
    })),
    total, page, pageSize,
  };
}

export async function listPendingMine(query: { page?: number; pageSize?: number }) {
  const user = currentUser();
  const { page = 1, pageSize = 20 } = query;
  const tc = tenantCondition(workflowInstances, user);
  const where = and(
    eq(workflowTasks.assigneeId, user.userId),
    eq(workflowTasks.status, 'pending'),
    eq(workflowInstances.status, 'running'),
    tc,
  );
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: countDistinct(workflowInstances.id) })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(where),
    withPagination(
      db
        .select({ inst: workflowInstances, definitionName: workflowDefinitions.name, initiatorName: users.nickname, initiatorAvatar: users.avatar, task: workflowTasks })
        .from(workflowTasks)
        .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
        .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
        .where(where)
        .orderBy(desc(workflowTasks.createdAt))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  return {
    list: rows.map((r) => ({ ...mapInstance(r.inst, r), pendingTaskId: r.task.id })),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function listAllInstances(query: { page?: number; pageSize?: number; status?: string; keyword?: string; categoryId?: number; initiatorKeyword?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, status, keyword, categoryId, initiatorKeyword } = query;
  const conditions = [];
  const tc = tenantCondition(workflowInstances, user);
  if (tc) conditions.push(tc);
  if (status) conditions.push(eq(workflowInstances.status, status as InstanceStatus));
  if (keyword) {
    const likeValue = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(workflowInstances.title, likeValue), ilike(workflowDefinitions.name, likeValue)));
  }
  if (categoryId !== undefined) conditions.push(eq(workflowDefinitions.categoryId, categoryId));
  if (initiatorKeyword) conditions.push(ilike(users.nickname, `%${escapeLike(initiatorKeyword)}%`));
  const where = and(...conditions);
  const [statRows, [{ total }], rows] = await Promise.all([
    db.select({ status: workflowInstances.status, cnt: count() })
      .from(workflowInstances)
      .where(tc)
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
        .orderBy(desc(workflowInstances.id))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const stats: Record<string, number> = { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0 };
  for (const r of statRows) {
    stats[r.status] = r.cnt;
    stats.total += r.cnt;
  }
  return { stats, list: rows.map((r) => mapInstance(r.inst, r)), total, page, pageSize };
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
  if (!isInitiator && !isAssignee) throw new HTTPException(403, { message: '无权查看' });
  const tasks = row.tasks.map((t) => mapTask(t, t.assignee?.nickname, t.assignee?.avatar));
  return mapInstance(row, {
    definitionName: row.definition?.name ?? null,
    initiatorName: row.initiator?.nickname ?? null,
    initiatorAvatar: row.initiator?.avatar ?? null,
    tasks,
  });
}

export async function getWorkflowInstanceBeforeAudit(id: number) {
  try {
    return await getInstanceDetail(id);
  } catch {
    return null;
  }
}

export async function getWorkflowTaskBeforeAudit(taskId: number) {
  const user = currentUser();
  const [task] = await db
    .select({ instanceId: workflowTasks.instanceId })
    .from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);
  if (!task) return null;
  return getWorkflowInstanceBeforeAudit(task.instanceId);
}

export async function createInstance(data: { definitionId: number; title: string; formData?: Record<string, unknown> | null }) {
  const user = currentUser();
  const [def] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, data.definitionId), eq(workflowDefinitions.status, 'published'))).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在或未发布' });
  const flowData = def.flowData as WorkflowFlowData;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程定义无效' });
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new HTTPException(400, { message: validation.errors[0] });
  const formData: Record<string, unknown> = data.formData ?? {};
  const initialResult = getInitialTasks(flowData, formData);
  if (initialResult.tasksToCreate.length === 0 && !initialResult.finished) {
    throw new HTTPException(400, { message: '流程定义中无可执行节点' });
  }
  const { instance, createdTasks } = await db.transaction(async (tx) => {
    const [createdInstance] = await tx.insert(workflowInstances).values({
      definitionId: def.id,
      definitionSnapshot: def,
      title: data.title,
      formData,
      status: initialResult.finished ? 'approved' : 'running',
      currentNodeKey: initialResult.currentNodeKeys[0] ?? null,
      initiatorId: user.userId,
      tenantId: getCreateTenantId(user),
    }).returning();
    let inserted: typeof workflowTasks.$inferSelect[] = [];
    if (initialResult.tasksToCreate.length > 0) {
      const rows = await expandTasksToRows(initialResult.tasksToCreate, {
        instanceId: createdInstance.id,
        initiatorId: user.userId,
        executor: tx,
        formData,
      });
      if (rows.length > 0) {
        inserted = await tx.insert(workflowTasks).values(rows).returning();
      }
    }
    return { instance: createdInstance, createdTasks: inserted };
  });
  const instanceDto = mapInstance(instance);
  const actor = { userId: user.userId, name: user.username };
  emitInstanceEvent('instance.created', instanceDto, actor);
  for (const t of createdTasks) {
    emitTaskEvent('task.created', mapTask(t), { definitionId: instance.definitionId, tenantId: instance.tenantId, actor });
    if (t.assigneeId && t.status === 'pending') {
      emitTaskEvent('task.assigned', mapTask(t), { definitionId: instance.definitionId, tenantId: instance.tenantId, actor });
    }
  }
  return instanceDto;
}

export async function withdrawInstance(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions = [eq(workflowInstances.id, id)];
  if (tc) conditions.push(tc);
  const [inst] = await db.select().from(workflowInstances).where(and(...conditions)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.initiatorId !== user.userId) throw new HTTPException(403, { message: '只有发起人可以撤回' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '只能撤回进行中的申请' });
  const { row: updated, cancelledTasks } = await db.transaction(async (tx) => {
    const cancelled = await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() })
      .where(and(eq(workflowTasks.instanceId, id), eq(workflowTasks.status, 'pending')))
      .returning();
    const [row] = await tx.update(workflowInstances).set({ status: 'withdrawn' }).where(and(...conditions)).returning();
    return { row, cancelledTasks: cancelled };
  });
  const instanceDto = mapInstance(updated);
  const actor = { userId: user.userId, name: user.username };
  for (const t of cancelledTasks) {
    emitTaskEvent('task.skipped', mapTask(t), { definitionId: updated.definitionId, tenantId: updated.tenantId, actor });
  }
  emitInstanceEvent('instance.withdrawn', instanceDto, actor);
  return instanceDto;
}

export interface ApproveResult {
  instance: ReturnType<typeof mapInstance>;
  message: string;
}

export async function approveTask(taskId: number, comment?: string): Promise<ApproveResult> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });

  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData };
  const flowData = snapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });

  const updated = await db.transaction(async (tx) => {
    const [approvedTask] = await tx.update(workflowTasks).set({
      status: 'approved',
      comment: comment ?? null,
      actionAt: new Date(),
    }).where(eq(workflowTasks.id, taskId)).returning();

    // 检查当前节点是否已足够推进（会签/或签/顺序会签）
    const { completed } = await checkNodeCompletion(tx, inst.id, task.nodeKey);
    if (!completed) {
      const [row] = await tx.update(workflowInstances)
        .set({ currentNodeKey: task.nodeKey })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, finished: false, advanced: false, approvedTask, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    const allTasks = await tx.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.status, 'approved')));
    const completedKeys = new Set(allTasks.map((t) => t.nodeKey));
    completedKeys.add('start');
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    const advanceResult = advanceFlow(flowData, task.nodeKey, formData, completedKeys);

    if (advanceResult.finished && advanceResult.tasksToCreate.length === 0) {
      const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { row, finished: true, advanced: true, approvedTask, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    let newTasks: typeof workflowTasks.$inferSelect[] = [];
    if (advanceResult.tasksToCreate.length > 0) {
      const rows = await expandTasksToRows(advanceResult.tasksToCreate, {
        instanceId: inst.id,
        initiatorId: inst.initiatorId,
        executor: tx,
        formData,
      });
      if (rows.length > 0) newTasks = await tx.insert(workflowTasks).values(rows).returning();
    }

    if (advanceResult.finished) {
      const [row] = await tx.update(workflowInstances).set({ status: 'approved', currentNodeKey: null }).where(eq(workflowInstances.id, inst.id)).returning();
      return { row, finished: true, advanced: true, approvedTask, newTasks };
    }

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: advanceResult.currentNodeKeys[0] ?? null })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, finished: false, advanced: true, approvedTask, newTasks };
  });

  const actor = { userId: user.userId, name: user.username };
  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor };
  emitTaskEvent('task.approved', mapTask(updated.approvedTask), { ...meta, comment });
  if (updated.advanced) {
    emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
  }
  for (const t of updated.newTasks) {
    emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
    emitTaskEvent('task.created', mapTask(t), meta);
    if (t.assigneeId && t.status === 'pending') {
      emitTaskEvent('task.assigned', mapTask(t), meta);
    }
  }
  if (updated.finished) {
    emitInstanceEvent('instance.approved', mapInstance(updated.row), actor);
  }

  let message: string;
  if (updated.finished) {
    message = '审批通过，流程已完成';
  } else if (updated.advanced) {
    message = '审批通过，流程已推进';
  } else {
    message = '审批通过，等待其他审批人处理';
  }
  return {
    instance: mapInstance(updated.row),
    message,
  };
}

export async function rejectTask(taskId: number, comment: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId))).limit(1);
  if (!task) throw new HTTPException(404, { message: '任务不存在或无权操作' });
  if (task.status !== 'pending') throw new HTTPException(400, { message: '任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(500, { message: '流程数据异常' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });

  // 读取节点驳回策略
  const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
  const flowData = snapshot?.flowData;
  const currentNodeCfg = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  const strategy = currentNodeCfg?.rejectStrategy ?? 'terminate';
  const rejectToNodeKey = currentNodeCfg?.rejectToNodeKey;

  // 解析目标节点（returnPrev / returnStart / returnToNode）
  let targetNodeKey: string | null = null;
  if (strategy !== 'terminate' && flowData) {
    if (strategy === 'returnToNode') {
      if (rejectToNodeKey && flowData.nodes.some((n) => n.data.key === rejectToNodeKey)) {
        targetNodeKey = rejectToNodeKey;
      }
    } else if (strategy === 'returnPrev') {
      // 找最近一个已 approved 的 approve/handler 任务节点
      const prevApproved = await db.select().from(workflowTasks)
        .where(and(
          eq(workflowTasks.instanceId, inst.id),
          eq(workflowTasks.status, 'approved'),
        ))
        .orderBy(desc(workflowTasks.actionAt), desc(workflowTasks.id));
      const prev = prevApproved.find((t) => {
        const cfg = flowData.nodes.find((n) => n.data.key === t.nodeKey)?.data;
        return cfg && (cfg.type === 'approve' || cfg.type === 'handler');
      });
      if (prev) targetNodeKey = prev.nodeKey;
    } else if (strategy === 'returnStart') {
      // 从头重新走流程（重新生成首批任务）
      targetNodeKey = '__start__';
    }
  }

  const updated = await db.transaction(async (tx) => {
    // 当前任务 → rejected
    const [rejectedTask] = await tx.update(workflowTasks)
      .set({ status: 'rejected', comment, actionAt: new Date() })
      .where(eq(workflowTasks.id, taskId))
      .returning();
    // 同节点其他 pending / waiting 任务跳过
    const skipped = await tx.update(workflowTasks)
      .set({ status: 'skipped', actionAt: new Date() })
      .where(and(
        eq(workflowTasks.instanceId, inst.id),
        eq(workflowTasks.nodeKey, task.nodeKey),
        or(eq(workflowTasks.status, 'pending'), eq(workflowTasks.status, 'waiting')),
      ))
      .returning();

    // 终止：实例置为 rejected
    if (strategy === 'terminate' || !targetNodeKey || !flowData) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    // 回退：实例保持 running，在目标节点重新生成任务
    const formData = (inst.formData ?? {}) as Record<string, unknown>;
    let tasksToCreate: TaskAction[] = [];
    let newCurrentKey: string | null = null;

    if (strategy === 'returnStart') {
      const initial = getInitialTasks(flowData, formData);
      tasksToCreate = initial.tasksToCreate;
      newCurrentKey = initial.currentNodeKeys[0] ?? null;
    } else {
      const targetCfg = flowData.nodes.find((n) => n.data.key === targetNodeKey)?.data;
      if (targetCfg && (targetCfg.type === 'approve' || targetCfg.type === 'handler')) {
        tasksToCreate = [{
          nodeKey: targetCfg.key,
          nodeName: targetCfg.label,
          nodeType: targetCfg.type,
          assigneeId: targetCfg.assigneeId ?? null,
          nodeConfig: targetCfg,
        }];
        newCurrentKey = targetCfg.key;
      }
    }

    if (tasksToCreate.length === 0) {
      const [row] = await tx.update(workflowInstances)
        .set({ status: 'rejected', currentNodeKey: null })
        .where(eq(workflowInstances.id, inst.id))
        .returning();
      return { row, terminated: true, rejectedTask, skippedTasks: skipped, newTasks: [] as typeof workflowTasks.$inferSelect[] };
    }

    const rows = await expandTasksToRows(tasksToCreate, {
      instanceId: inst.id,
      initiatorId: inst.initiatorId,
      executor: tx,
      formData,
    });
    let newTasks: typeof workflowTasks.$inferSelect[] = [];
    if (rows.length > 0) newTasks = await tx.insert(workflowTasks).values(rows).returning();

    const [row] = await tx.update(workflowInstances)
      .set({ currentNodeKey: newCurrentKey })
      .where(eq(workflowInstances.id, inst.id))
      .returning();
    return { row, terminated: false, rejectedTask, skippedTasks: skipped, newTasks };
  });

  const actor = { userId: user.userId, name: user.username };
  const meta = { definitionId: updated.row.definitionId, tenantId: updated.row.tenantId, actor };
  emitTaskEvent('task.rejected', mapTask(updated.rejectedTask), { ...meta, comment });
  for (const t of updated.skippedTasks) {
    emitTaskEvent('task.skipped', mapTask(t), meta);
  }
  emitNodeEvent('node.left', { instanceId: updated.row.id, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType });
  if (updated.terminated) {
    emitInstanceEvent('instance.rejected', mapInstance(updated.row), actor);
  } else {
    for (const t of updated.newTasks) {
      emitNodeEvent('node.entered', { instanceId: updated.row.id, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType });
      emitTaskEvent('task.created', mapTask(t), meta);
      if (t.assigneeId && t.status === 'pending') emitTaskEvent('task.assigned', mapTask(t), meta);
    }
  }

  return mapInstance(updated.row);
}
