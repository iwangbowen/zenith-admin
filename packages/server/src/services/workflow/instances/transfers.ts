// ─── 任务转办明细（谁在何时因何把任务交给了谁）────────────────────────────────
// 转办/委派/管理员改派/离职交接/超时升级 5 类流转的统一留痕，
// 同时支撑「禁止折返」校验与详情页转办时间线。
import { uniquePositiveInts } from '@zenith/shared/core';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { buildWhere } from '../../../lib/where-helpers';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../../db';
import { workflowTaskTransfers, workflowTasks, users } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';
import { formatDateTime } from '../../../lib/datetime';
import type { WorkflowTaskTransfer } from '@zenith/shared/workflow';

export type WorkflowTaskTransferAction = 'transfer' | 'delegate' | 'reassign' | 'handover' | 'timeout';

/**
 * 校验目标用户在同节点同激活轮内没有其它活动任务（pending/waiting）。
 * 转办/委派/加签/管理员改派把人指到已有活动任务的处理人时，
 * 会撞 wf_tasks_active_uniq 部分唯一索引直接 500——这里前置为友好 409。
 */
export async function assertAssigneesNotActiveOnNode(
  exec: DbExecutor,
  args: { instanceId: number; nodeKey: string; activationId: string; userIds: number[]; excludeTaskId?: number },
): Promise<void> {
  const ids = uniquePositiveInts(args.userIds);
  if (ids.length === 0) return;
  const where = buildWhere(
    eq(workflowTasks.instanceId, args.instanceId),
    eq(workflowTasks.nodeKey, args.nodeKey),
    eq(workflowTasks.activationId, args.activationId),
    inArray(workflowTasks.status, ['pending', 'waiting']),
    inArray(workflowTasks.assigneeId, ids),
    args.excludeTaskId != null ? ne(workflowTasks.id, args.excludeTaskId) : undefined,
  );
  const dupes = await exec.select({ assigneeId: workflowTasks.assigneeId })
    .from(workflowTasks).where(where).limit(ids.length);
  if (dupes.length === 0) return;
  const dupeIds = [...new Set(dupes.map((d) => d.assigneeId).filter((v): v is number => v != null))];
  const nameRows = await exec.select({ id: users.id, nickname: users.nickname, username: users.username })
    .from(users).where(inArray(users.id, dupeIds));
  const names = nameRows.map((u) => u.nickname ?? u.username).join('、');
  throw new HTTPException(409, { message: `${names || '所选人员'} 已是本节点待办处理人，无需重复指派` });
}

/** 转办明细落库 */
export async function recordTaskTransfer(
  executor: DbExecutor,
  input: {
    taskId: number;
    instanceId: number;
    fromUserId: number | null;
    toUserId: number;
    action: WorkflowTaskTransferAction;
    reason?: string | null;
    operatorId?: number | null;
    tenantId?: number | null;
  },
): Promise<void> {
  await executor.insert(workflowTaskTransfers).values({
    taskId: input.taskId,
    instanceId: input.instanceId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    action: input.action,
    reason: input.reason ?? null,
    operatorId: input.operatorId ?? null,
    tenantId: input.tenantId ?? null,
  });
}

/** 任务全部经手人（from/to 并集），用于禁止折返校验 */
export async function loadTaskHandledUserIds(taskId: number): Promise<Set<number>> {
  const rows = await db
    .select({ fromUserId: workflowTaskTransfers.fromUserId, toUserId: workflowTaskTransfers.toUserId })
    .from(workflowTaskTransfers)
    .where(eq(workflowTaskTransfers.taskId, taskId));
  const out = new Set<number>();
  for (const r of rows) {
    if (r.fromUserId != null) out.add(r.fromUserId);
    out.add(r.toUserId);
  }
  return out;
}

/** 用户是否经手过该任务（from/to 任一命中） */
export async function hasUserHandledTask(taskId: number, userId: number): Promise<boolean> {
  const count = await db.$count(
    workflowTaskTransfers,
    and(
      eq(workflowTaskTransfers.taskId, taskId),
      or(eq(workflowTaskTransfers.fromUserId, userId), eq(workflowTaskTransfers.toUserId, userId)),
    ),
  );
  return count > 0;
}

/** 详情场景：按实例批量加载转办明细并按 taskId 分组（含 from/to/操作人昵称） */
export async function loadInstanceTransfersByTask(instanceId: number): Promise<Map<number, WorkflowTaskTransfer[]>> {
  const rows = await db
    .select()
    .from(workflowTaskTransfers)
    .where(eq(workflowTaskTransfers.instanceId, instanceId))
    .orderBy(workflowTaskTransfers.id);
  const map = new Map<number, WorkflowTaskTransfer[]>();
  if (rows.length === 0) return map;
  const userIds = [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId, r.operatorId]).filter((v): v is number => v != null))];
  const nameRows = userIds.length > 0
    ? await db.select({ id: users.id, nickname: users.nickname, username: users.username }).from(users).where(inArray(users.id, userIds))
    : [];
  const names = new Map(nameRows.map((u) => [u.id, u.nickname ?? u.username]));
  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({
      id: r.id,
      fromUserId: r.fromUserId,
      fromUserName: r.fromUserId != null ? names.get(r.fromUserId) ?? `用户#${r.fromUserId}` : null,
      toUserId: r.toUserId,
      toUserName: names.get(r.toUserId) ?? `用户#${r.toUserId}`,
      action: r.action,
      reason: r.reason ?? null,
      operatorName: r.operatorId != null ? names.get(r.operatorId) ?? `用户#${r.operatorId}` : null,
      createdAt: formatDateTime(r.createdAt),
    });
    map.set(r.taskId, list);
  }
  return map;
}
