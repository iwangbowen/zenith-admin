// ─── 催办与抄送（转发/已读）（拆分自 workflow-instances.service.ts）───
import { uniquePositiveInts } from '@zenith/shared/core';
import { formatDateTime } from '../../../lib/datetime';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { users, workflowTasks, workflowTaskUrges } from '../../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { mapTask } from './mapping';
import { emitTaskEvent, lockInstanceExpecting, requireVisibleInstance } from './shared';
import { requireRow } from '../../../lib/db-assert';
import { workflowTransaction } from '../../../lib/workflow-jobs/lease';
import { resolveUserNames } from '../../../lib/user-nicknames';
import type { DbExecutor } from '../../../db/types';
import type { WorkflowTaskUrge, WorkflowUrgeResult, WorkflowUrgeSkipped } from '@zenith/shared/workflow';

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
  return workflowTransaction(async (tx) => {
    await lockInstanceExpecting(tx, instanceId, inst.status, '流程状态已变化，请刷新后重试');
    // 去重：跳过已抄送给的用户
    const existing = await tx.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.nodeType, 'ccNode')));
    const existingSet = new Set(existing.map((r) => r.assigneeId).filter((v): v is number => typeof v === 'number'));
    const toAdd = targetIds.filter((uid) => !existingSet.has(uid));
    if (toAdd.length === 0) {
      return { list: [] as ReturnType<typeof mapTask>[], message: '所选用户均已抄送，无需重复添加' };
    }
    const noteText = note?.trim() ? `：${note.trim()}` : '';
    const forwardComment = `[转发抄送] 由 ${user.username ?? '系统'} 发起${noteText}`;
    const rows = toAdd.map((uid) => ({
      instanceId,
      // 转发抄送不是流程节点：固定用独立 key，绝不能复用 inst.currentNodeKey。
      // 复用会让抄送行混进审批节点的任务集合，带偏节点完成判定的"当前轮"推断
      // （曾导致会签节点被提前判定完成、其余审批人的加签/会签任务遗留 pending）。
      nodeKey: '__forward__',
      nodeName: '转发抄送',
      nodeType: 'ccNode' as const, taskKind: 'cc' as const,
      assigneeId: uid,
      status: 'skipped' as const,
      comment: forwardComment,
      actionAt: null,
      activationId: null,
    }));
    const inserted = await tx.insert(workflowTasks).values(rows).returning();
    const actor = { userId: user.userId, name: user.username };
    for (const t of inserted) {
      await emitTaskEvent('task.created', mapTask(t), { definitionId: inst.definitionId, tenantId: inst.tenantId, actor }, tx);
    }
    return { list: inserted.map((t) => mapTask(t)), message: `已抄送 ${inserted.length} 人` };
  });
}

/** 同一任务两次催办的最小间隔（毫秒） */
const URGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

interface UrgeCandidate {
  task: typeof workflowTasks.$inferSelect;
  assigneeId: number | null;
  assigneeName: string | null;
  nodeKey: string;
  nodeName: string;
}

function mapTaskUrge(
  row: typeof workflowTaskUrges.$inferSelect,
  fallback?: Partial<Pick<WorkflowTaskUrge, 'assigneeId' | 'assigneeName' | 'nodeKey' | 'nodeName'>>,
): WorkflowTaskUrge {
  return {
    id: row.id,
    taskId: row.taskId,
    instanceId: row.instanceId,
    urgerId: row.urgerId ?? null,
    urgerName: row.urgerName ?? null,
    assigneeId: row.assigneeId ?? fallback?.assigneeId ?? null,
    assigneeName: row.assigneeName ?? fallback?.assigneeName ?? null,
    nodeKey: row.nodeKey ?? fallback?.nodeKey ?? null,
    nodeName: row.nodeName ?? fallback?.nodeName ?? null,
    message: row.message ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

function assertCanUrge(inst: { initiatorId: number }, user: { userId: number; roles?: string[] }) {
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) throw new HTTPException(403, { message: '仅发起人或管理员可催办' });
}

async function resolveUrgeCandidates(
  tasks: Array<typeof workflowTasks.$inferSelect>,
  executor: DbExecutor,
): Promise<UrgeCandidate[]> {
  const names = await resolveUserNames(tasks.map((task) => task.assigneeId), executor);
  return tasks.map((task) => ({
    task,
    assigneeId: task.assigneeId ?? null,
    assigneeName: task.assigneeId != null ? names.get(task.assigneeId) ?? null : null,
    nodeKey: task.nodeKey,
    nodeName: task.nodeName,
  }));
}

function buildUrgeMessage(inserted: WorkflowTaskUrge[], skipped: WorkflowUrgeSkipped[]): string {
  const people = new Set(inserted.map((row) => row.assigneeId).filter((id): id is number => id != null)).size;
  const parts = [`已催办 ${people} 人（${inserted.length} 个待办）`];
  if (skipped.length > 0) parts.push(`${skipped.length} 个待办已跳过`);
  return parts.join('，');
}

function buildUrgeResult(
  inst: { id: number; title: string },
  inserted: WorkflowTaskUrge[],
  skipped: WorkflowUrgeSkipped[],
): WorkflowUrgeResult {
  return {
    instanceId: inst.id,
    instanceTitle: inst.title,
    urged: inserted,
    skipped,
    message: buildUrgeMessage(inserted, skipped),
  };
}

/** 单任务催办：与实例级共用权限、锁、节流、快照和通知逻辑 */
async function urgeSingleTask(taskId: number, message?: string): Promise<WorkflowUrgeResult> {
  const user = currentUser();
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  requireRow(task, '任务不存在');
  if (task.status !== 'pending') throw new HTTPException(400, { message: '仅可催办未处理任务' });
  const inst = await requireVisibleInstance(task.instanceId, '任务不存在或无权操作');
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无需催办' });
  assertCanUrge(inst, user);

  return workflowTransaction(async (tx) => {
    await lockInstanceExpecting(tx, inst.id, 'running', '流程已结束，无需催办');
    const [freshTask] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).for('update').limit(1);
    if (!freshTask || freshTask.status !== 'pending') throw new HTTPException(409, { message: '任务状态已变化，无法催办' });
    if (freshTask.assigneeId == null) throw new HTTPException(400, { message: '任务没有处理人，无法催办' });
    const [last] = await tx.select({ createdAt: workflowTaskUrges.createdAt }).from(workflowTaskUrges)
      .where(eq(workflowTaskUrges.taskId, taskId))
      .orderBy(desc(workflowTaskUrges.createdAt)).limit(1);
    if (last) {
      const elapsed = Date.now() - new Date(last.createdAt).getTime();
      if (elapsed < URGE_MIN_INTERVAL_MS) {
        const wait = Math.ceil((URGE_MIN_INTERVAL_MS - elapsed) / 1000);
        throw new HTTPException(429, { message: `催办过于频繁，请 ${wait} 秒后再试` });
      }
    }

    const [candidate] = await resolveUrgeCandidates([freshTask], tx);
    const [row] = await tx.insert(workflowTaskUrges).values({
      taskId,
      instanceId: inst.id,
      urgerId: user.userId,
      urgerName: user.username ?? null,
      assigneeId: candidate.assigneeId,
      assigneeName: candidate.assigneeName,
      nodeKey: candidate.nodeKey,
      nodeName: candidate.nodeName,
      message: message?.trim() || null,
    }).returning();

    const actor = { userId: user.userId, name: user.username };
    await emitTaskEvent('task.urged', mapTask(freshTask, candidate.assigneeName), {
      definitionId: inst.definitionId,
      tenantId: inst.tenantId,
      actor,
      comment: row.message ?? undefined,
      notify: true,
    }, tx);
    return buildUrgeResult(inst, [mapTaskUrge(row)], []);
  });
}

/** 实例级催办：对实例所有 pending 任务催办；同一人多个待办只发一次通知，但保留每任务明细 */
async function urgeAllPending(instanceId: number, message?: string, notifySeen?: ReadonlySet<number>): Promise<WorkflowUrgeResult> {
  const user = currentUser();
  const inst = await requireVisibleInstance(instanceId, '流程不存在');
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无需催办' });
  assertCanUrge(inst, user);

  return workflowTransaction(async (tx) => {
    await lockInstanceExpecting(tx, instanceId, 'running', '流程已结束，无需催办');
    const pendings = await tx.select().from(workflowTasks)
      .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'pending')))
      .for('update');
    if (pendings.length === 0) throw new HTTPException(400, { message: '没有待办任务可催办' });

    const candidates = await resolveUrgeCandidates(pendings, tx);
    // 一次查出每个任务的最近催办时间做节流判断，再批量插入，避免逐任务 2N 次往返
    const lastUrges = await tx.selectDistinctOn([workflowTaskUrges.taskId], {
      taskId: workflowTaskUrges.taskId,
      createdAt: workflowTaskUrges.createdAt,
    }).from(workflowTaskUrges)
      .where(inArray(workflowTaskUrges.taskId, pendings.map((t) => t.id)))
      .orderBy(workflowTaskUrges.taskId, desc(workflowTaskUrges.createdAt));
    const lastByTask = new Map(lastUrges.map((r) => [r.taskId, r.createdAt]));
    const now = Date.now();
    const eligible: UrgeCandidate[] = [];
    const skipped: WorkflowUrgeSkipped[] = [];
    for (const candidate of candidates) {
      if (candidate.assigneeId == null) {
        skipped.push({
          taskId: candidate.task.id, assigneeId: null, assigneeName: null,
          nodeKey: candidate.nodeKey, nodeName: candidate.nodeName, reason: 'noAssignee',
        });
        continue;
      }
      const last = lastByTask.get(candidate.task.id);
      if (last && now - new Date(last).getTime() < URGE_MIN_INTERVAL_MS) {
        skipped.push({
          taskId: candidate.task.id, assigneeId: candidate.assigneeId, assigneeName: candidate.assigneeName,
          nodeKey: candidate.nodeKey, nodeName: candidate.nodeName, reason: 'cooldown',
        });
        continue;
      }
      eligible.push(candidate);
    }

    if (eligible.length === 0) return buildUrgeResult(inst, [], skipped);

    const rows = await tx.insert(workflowTaskUrges).values(eligible.map((candidate) => ({
      taskId: candidate.task.id,
      instanceId,
      urgerId: user.userId,
      urgerName: user.username ?? null,
      assigneeId: candidate.assigneeId,
      assigneeName: candidate.assigneeName,
      nodeKey: candidate.nodeKey,
      nodeName: candidate.nodeName,
      message: message?.trim() || null,
    }))).returning();
    const inserted = rows.map((row) => mapTaskUrge(row));
    const taskById = new Map(eligible.map((candidate) => [candidate.task.id, candidate]));
    // 同一人多个待办：保留每任务明细，但只发一次通知
    const peopleCounts = new Map<number, number>();
    for (const row of inserted) {
      if (row.assigneeId != null) peopleCounts.set(row.assigneeId, (peopleCounts.get(row.assigneeId) ?? 0) + 1);
    }
    // 批量跨实例催办时，调用方传入已通知过的人，保证同一人整批只发一次通知
    const notified = new Set<number>(notifySeen ?? []);
    const actor = { userId: user.userId, name: user.username };
    for (const row of inserted) {
      const candidate = taskById.get(row.taskId);
      if (!candidate) continue;
      const notify = row.assigneeId == null || !notified.has(row.assigneeId);
      if (row.assigneeId != null) notified.add(row.assigneeId);
      const count = row.assigneeId != null ? peopleCounts.get(row.assigneeId) ?? 1 : 1;
      const base = row.message?.trim();
      const comment = count > 1 && notify
        ? `${base ? `${base}；` : ''}同一实例共 ${count} 个待办被催办`
        : base || undefined;
      await emitTaskEvent('task.urged', mapTask(candidate.task, candidate.assigneeName), {
        definitionId: inst.definitionId,
        tenantId: inst.tenantId,
        actor,
        comment,
        notify,
      }, tx);
    }
    return buildUrgeResult(inst, inserted, skipped);
  });
}

/** 催办：单任务 / 实例下全部待办共用同一套权限、节流、快照与通知逻辑 */
export async function urgeTask(taskId: number, message?: string): Promise<WorkflowUrgeResult> {
  return urgeSingleTask(taskId, message);
}

export async function urgeInstance(instanceId: number, message?: string, notifySeen?: ReadonlySet<number>): Promise<WorkflowUrgeResult> {
  return urgeAllPending(instanceId, message, notifySeen);
}

/** 查询某任务的催办历史（旧记录回退到任务当前处理人） */
export async function listTaskUrges(taskId: number) {
  const rows = await db.select({
    urge: workflowTaskUrges,
    taskAssigneeId: workflowTasks.assigneeId,
    taskNodeKey: workflowTasks.nodeKey,
    taskNodeName: workflowTasks.nodeName,
    userName: users.nickname,
    username: users.username,
  }).from(workflowTaskUrges)
    .leftJoin(workflowTasks, eq(workflowTaskUrges.taskId, workflowTasks.id))
    .leftJoin(users, eq(users.id, workflowTasks.assigneeId))
    .where(eq(workflowTaskUrges.taskId, taskId))
    .orderBy(desc(workflowTaskUrges.createdAt));
  return rows.map(({ urge, ...fallback }) => mapTaskUrge(urge, {
    assigneeId: fallback.taskAssigneeId,
    assigneeName: fallback.userName ?? fallback.username,
    nodeKey: fallback.taskNodeKey,
    nodeName: fallback.taskNodeName,
  }));
}

/** 查询某实例的全部催办历史（旧记录回退到任务当前处理人） */
export async function listInstanceUrges(instanceId: number) {
  const rows = await db.select({
    urge: workflowTaskUrges,
    taskAssigneeId: workflowTasks.assigneeId,
    taskNodeKey: workflowTasks.nodeKey,
    taskNodeName: workflowTasks.nodeName,
    userName: users.nickname,
    username: users.username,
  }).from(workflowTaskUrges)
    .leftJoin(workflowTasks, eq(workflowTaskUrges.taskId, workflowTasks.id))
    .leftJoin(users, eq(users.id, workflowTasks.assigneeId))
    .where(eq(workflowTaskUrges.instanceId, instanceId))
    .orderBy(desc(workflowTaskUrges.createdAt));
  return rows.map(({ urge, ...fallback }) => mapTaskUrge(urge, {
    assigneeId: fallback.taskAssigneeId,
    assigneeName: fallback.userName ?? fallback.username,
    nodeKey: fallback.taskNodeKey,
    nodeName: fallback.taskNodeName,
  }));
}

/** 动态补加抄送：运行中实例为指定 ccNode 节点补加抄送人（去重 + 校验节点类型） */
export async function addInstanceCc(instanceId: number, nodeKey: string, userIds: number[]) {
  const user = currentUser();
  const inst = await requireVisibleInstance(instanceId, '流程不存在');
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程已结束，无法补加抄送' });
  const isInitiator = inst.initiatorId === user.userId;
  const isAdmin = (user.roles ?? []).some((r) => r === 'super_admin' || r === 'tenant_admin');
  if (!isInitiator && !isAdmin) throw new HTTPException(403, { message: '仅发起人或管理员可补加抄送' });

  const flowData = inst.definitionSnapshot?.flowData;
  if (!flowData) throw new HTTPException(500, { message: '流程快照数据异常' });
  const maybeNode = flowData.nodes.find((n) => n.data.key === nodeKey);
  const node = requireRow(maybeNode, '抄送节点不存在', 400);
  if (node.data.type !== 'ccNode') throw new HTTPException(400, { message: '仅 ccNode 节点支持补加抄送' });

  return workflowTransaction(async (tx) => {
    await lockInstanceExpecting(tx, instanceId, 'running', '流程已结束，无法补加抄送');
    // 去重：过滤掉已经在该节点抄送过的用户
    const existing = await tx.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
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

    const rows = toAdd.map((uid) => ({
      instanceId,
      nodeKey,
      nodeName: node.data.label,
      nodeType: 'ccNode' as const, taskKind: 'cc' as const,
      assigneeId: uid,
      status: 'skipped' as const,
      actionAt: null,
      activationId: null,
    }));
    const inserted = await tx.insert(workflowTasks).values(rows).returning();
    const actor = { userId: user.userId, name: user.username };
    for (const t of inserted) {
      await emitTaskEvent('task.created', mapTask(t), {
        definitionId: inst.definitionId,
        tenantId: inst.tenantId,
        actor,
      }, tx);
    }
    return {
      list: inserted.map((t) => mapTask(t)),
      message: `已补加 ${inserted.length} 人抄送`,
    };
  });
}
