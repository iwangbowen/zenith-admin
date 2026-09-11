// ─── 催办与抄送（转发/已读）（拆分自 workflow-instances.service.ts）───
import { uniquePositiveInts } from '@zenith/shared/core';
import { randomUUID } from 'node:crypto';
import { formatDateTime } from '../../../lib/datetime';
import { eq, and, desc, inArray, type SQL } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowTasks, workflowTaskUrges } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { mapTask } from './mapping';
import { emitTaskEvent, requireVisibleInstance } from './shared';
import { requireRow } from '../../../lib/db-assert';
import { buildWhere } from '../../../lib/where-helpers';

/** T1-2 标记抄送已读：仅本人 ccNode 任务可标记 */
export async function markCcRead(ccTaskId: number): Promise<void> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, ccTaskId)).limit(1);
  requireRow(task, '抄送任务不存在');
  if (task.assigneeId !== user.userId || task.nodeType !== 'ccNode') {
    throw new HTTPException(403, { message: '无权操作该抄送' });
  }
  if (task.ccReadAt) return;
  await db.update(workflowTasks).set({ ccReadAt: new Date() }).where(eq(workflowTasks.id, ccTaskId));
}

/** T1-2 主动抄送 / 转发：任一流程参与者（发起人/审批人/抄送人/管理员）将流程抄送给指定用户 */
export async function forwardInstance(instanceId: number, userIds: number[], note?: string) {
  const user = currentUser();
  const inst = await requireVisibleInstance(instanceId, '流程不存在');
  // 参与者校验：发起人 / 管理员 / 任一任务处理人
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  let allowed = isInitiator || isAdmin;
  if (!allowed) {
    const involved = await db.$count(workflowTasks, and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.assigneeId, user.userId)));
    allowed = involved > 0;
  }
  if (!allowed) throw new HTTPException(403, { message: '仅流程参与者可转发抄送' });

  const targetIds = uniquePositiveInts(userIds);
  if (targetIds.length === 0) throw new HTTPException(400, { message: '请选择抄送人' });
  // 去重：跳过已抄送给的用户
  const existing = await db.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeType, 'ccNode')));
  const existingSet = new Set(existing.map((r) => r.assigneeId).filter((v): v is number => typeof v === 'number'));
  const toAdd = targetIds.filter((uid) => !existingSet.has(uid));
  if (toAdd.length === 0) {
    return { list: [] as ReturnType<typeof mapTask>[], message: '所选用户均已抄送，无需重复添加' };
  }
  const noteText = note?.trim() ? `：${note.trim()}` : '';
  const forwardComment = `[转发抄送] 由 ${user.username ?? '系统'} 发起${noteText}`;
  const forwardActivation = randomUUID();
  const rows = toAdd.map((uid) => ({
    instanceId,
    nodeKey: inst.currentNodeKey ?? '__forward__',
    nodeName: '转发抄送',
    nodeType: 'ccNode' as const,
    assigneeId: uid,
    status: 'skipped' as const,
    comment: forwardComment,
    actionAt: null,
    activationId: forwardActivation,
  }));
  const inserted = await db.insert(workflowTasks).values(rows).returning();
  const actor = { userId: user.userId, name: user.username };
  for (const t of inserted) {
    emitTaskEvent('task.created', mapTask(t), { definitionId: inst.definitionId, tenantId: inst.tenantId, actor });
  }
  return { list: inserted.map((t) => mapTask(t)), message: `已抄送 ${inserted.length} 人` };
}

/** 同一任务两次催办的最小间隔（毫秒） */
const URGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

function mapTaskUrge(row: typeof workflowTaskUrges.$inferSelect): import('@zenith/shared').WorkflowTaskUrge {
  return {
    id: row.id,
    taskId: row.taskId,
    instanceId: row.instanceId,
    urgerId: row.urgerId ?? null,
    urgerName: row.urgerName ?? null,
    message: row.message ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 催办：仅发起人或管理员可催办 pending 任务；同任务 5 分钟内不可重复 */
export async function urgeTask(taskId: number, message?: string) {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks)
    .where(eq(workflowTasks.id, taskId)).limit(1);
  requireRow(task, '任务不存在');
  if (task.status !== 'pending') throw new HTTPException(400, { message: '仅可催办未处理任务' });
  const tc = tenantCondition(workflowInstances, user);
  const instConditions: (SQL | undefined)[] = [eq(workflowInstances.id, task.instanceId), tc];
  const [inst] = await db.select().from(workflowInstances)
    .where(buildWhere(...instConditions)).limit(1);
  requireRow(inst, '任务不存在或无权操作');
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无需催办' });

  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) {
    throw new HTTPException(403, { message: '仅发起人或管理员可催办' });
  }

  const [last] = await db.select({ createdAt: workflowTaskUrges.createdAt }).from(workflowTaskUrges)
    .where(eq(workflowTaskUrges.taskId, taskId))
    .orderBy(desc(workflowTaskUrges.createdAt)).limit(1);
  if (last) {
    const elapsed = Date.now() - new Date(last.createdAt).getTime();
    if (elapsed < URGE_MIN_INTERVAL_MS) {
      const wait = Math.ceil((URGE_MIN_INTERVAL_MS - elapsed) / 1000);
      throw new HTTPException(429, { message: `催办过于频繁，请 ${wait} 秒后再试` });
    }
  }

  const [row] = await db.insert(workflowTaskUrges).values({
    taskId,
    instanceId: inst.id,
    urgerId: user.userId,
    urgerName: user.username ?? null,
    message: message?.trim() || null,
  }).returning();

  const actor = { userId: user.userId, name: user.username };
  emitTaskEvent('task.urged', mapTask(task), {
    definitionId: inst.definitionId,
    tenantId: inst.tenantId,
    actor,
    comment: row.message ?? undefined,
  });
  return mapTaskUrge(row);
}

/** 查询某任务的催办历史 */
export async function listTaskUrges(taskId: number) {
  const rows = await db.select().from(workflowTaskUrges)
    .where(eq(workflowTaskUrges.taskId, taskId))
    .orderBy(desc(workflowTaskUrges.createdAt));
  return rows.map(mapTaskUrge);
}

/** 查询某实例的全部催办历史 */
export async function listInstanceUrges(instanceId: number) {
  const rows = await db.select().from(workflowTaskUrges)
    .where(eq(workflowTaskUrges.instanceId, instanceId))
    .orderBy(desc(workflowTaskUrges.createdAt));
  return rows.map(mapTaskUrge);
}

/** 实例级批量催办：对实例所有 pending 任务依次催办，节流命中的任务静默跳过 */
export async function urgeInstance(instanceId: number, message?: string) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions: (SQL | undefined)[] = [eq(workflowInstances.id, instanceId), tc];
  const [inst] = await db.select().from(workflowInstances)
    .where(buildWhere(...conditions)).limit(1);
  requireRow(inst, '流程不存在');
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无需催办' });
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) throw new HTTPException(403, { message: '仅发起人或管理员可催办' });

  const pendings = await db.select().from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'pending')));
  if (pendings.length === 0) throw new HTTPException(400, { message: '没有待办任务可催办' });

  const created: import('@zenith/shared').WorkflowTaskUrge[] = [];
  // 一次查出每个任务的最近催办时间做节流判断，再批量插入，避免逐任务 2N 次往返
  const lastUrges = await db.selectDistinctOn([workflowTaskUrges.taskId], {
    taskId: workflowTaskUrges.taskId,
    createdAt: workflowTaskUrges.createdAt,
  }).from(workflowTaskUrges)
    .where(inArray(workflowTaskUrges.taskId, pendings.map((t) => t.id)))
    .orderBy(workflowTaskUrges.taskId, desc(workflowTaskUrges.createdAt));
  const lastByTask = new Map(lastUrges.map((r) => [r.taskId, r.createdAt]));
  const now = Date.now();
  const eligible = pendings.filter((task) => {
    const last = lastByTask.get(task.id);
    return !(last && now - new Date(last).getTime() < URGE_MIN_INTERVAL_MS);
  });
  const skipped = pendings.length - eligible.length;
  if (eligible.length > 0) {
    const rows = await db.insert(workflowTaskUrges).values(eligible.map((task) => ({
      taskId: task.id,
      instanceId,
      urgerId: user.userId,
      urgerName: user.username ?? null,
      message: message?.trim() || null,
    }))).returning();
    const taskById = new Map(eligible.map((task) => [task.id, task]));
    const actor = { userId: user.userId, name: user.username };
    for (const row of rows) {
      created.push(mapTaskUrge(row));
      const task = taskById.get(row.taskId);
      if (!task) continue;
      emitTaskEvent('task.urged', mapTask(task), {
        definitionId: inst.definitionId,
        tenantId: inst.tenantId,
        actor,
        comment: row.message ?? undefined,
      });
    }
  }
  return {
    list: created,
    message: skipped > 0
      ? `已催办 ${created.length} 人，${skipped} 人催办过于频繁已跳过`
      : `已催办 ${created.length} 人`,
  };
}

/** 动态补加抄送：运行中实例为指定 ccNode 节点补加抄送人（去重 + 校验节点类型） */
export async function addInstanceCc(instanceId: number, nodeKey: string, userIds: number[]) {
  const user = currentUser();
  const tc = tenantCondition(workflowInstances, user);
  const conditions: (SQL | undefined)[] = [eq(workflowInstances.id, instanceId), tc];
  const [inst] = await db.select().from(workflowInstances)
    .where(buildWhere(...conditions)).limit(1);
  requireRow(inst, '流程不存在');
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无法补加抄送' });
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) throw new HTTPException(403, { message: '仅发起人或管理员可补加抄送' });

  const flowData = inst.definitionSnapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  const maybeNode = flowData.nodes.find((n) => n.data.key === nodeKey);
  const node = requireRow(maybeNode, '抄送节点不存在', 400);
  if (node.data.type !== 'ccNode') throw new HTTPException(400, { message: '仅 ccNode 节点支持补加抄送' });

  // 去重：过滤掉已经在该节点抄送过的用户
  const existing = await db.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, instanceId),
      eq(workflowTasks.nodeKey, nodeKey),
      eq(workflowTasks.nodeType, 'ccNode'),
    ));
  const existingSet = new Set(existing.map((r) => r.assigneeId).filter((v): v is number => typeof v === 'number'));
  const toAdd = Array.from(new Set(userIds)).filter((uid) => !existingSet.has(uid));
  if (toAdd.length === 0) {
    return { list: [] as ReturnType<typeof mapTask>[], message: '所选用户均已抄送，无需重复添加' };
  }

  const addCcActivation = randomUUID();
  const rows = toAdd.map((uid) => ({
    instanceId,
    nodeKey,
    nodeName: node.data.label,
    nodeType: 'ccNode' as const,
    assigneeId: uid,
    status: 'skipped' as const,
    actionAt: null,
    activationId: addCcActivation,
  }));
  const inserted = await db.insert(workflowTasks).values(rows).returning();
  const actor = { userId: user.userId, name: user.username };
  for (const t of inserted) {
    emitTaskEvent('task.created', mapTask(t), {
      definitionId: inst.definitionId,
      tenantId: inst.tenantId,
      actor,
    });
  }
  return {
    list: inserted.map((t) => mapTask(t)),
    message: `已补加 ${inserted.length} 人抄送`,
  };
}
