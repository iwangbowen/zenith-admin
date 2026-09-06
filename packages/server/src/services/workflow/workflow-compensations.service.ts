import { and, eq, asc, desc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowCompensationActionStatus, WorkflowCompensationAction } from '@zenith/shared/workflow';
import { db } from '../../db';
import { workflowCompensations, workflowCompensationLogs, workflowInstances, workflowTasks, workflowTokens, users } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { enqueueJob } from '../../lib/workflow-jobs/engine';
import { bridgeReportFillWorkflowOutcome } from '../report/report-fill-workflow-bridge.service';
import { buildWhere } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';

type Row = typeof workflowCompensations.$inferSelect;
const map = (r: Row) => ({
  id: r.id, instanceId: r.instanceId, nodeKey: r.nodeKey, nodeName: r.nodeName ?? null,
  errorMessage: r.errorMessage ?? null, action: r.action, status: r.status as 'pending' | 'resolved' | 'terminated',
  compensationActionStatus: (r.compensationActionStatus ?? 'none') as WorkflowCompensationActionStatus,
  failedNodeKey: r.failedNodeKey ?? null,
  resolution: r.resolution ?? null, resolvedBy: r.resolvedBy ?? null, resolvedAt: formatNullableDateTime(r.resolvedAt), createdAt: formatDateTime(r.createdAt),
});

/**
 * 记录补偿工单并返回其 id。
 * - legacy catch：toAdmin=pending 待人工修复；notify/terminate=已闭环存档
 * - 统一失败策略：compensate/notify=pending（compensationActionStatus 跟踪自动动作）
 */
export async function recordCompensation(tx: DbExecutor, v: {
  instanceId: number; nodeKey: string; nodeName?: string; errorMessage?: string;
  action: string; status: 'pending' | 'resolved' | 'terminated';
  compensationActionStatus?: WorkflowCompensationActionStatus;
  failedNodeKey?: string | null;
  actionPayload?: unknown;
  tenantId: number | null;
}): Promise<number> {
  const [row] = await tx.insert(workflowCompensations).values({
    instanceId: v.instanceId, nodeKey: v.nodeKey, nodeName: v.nodeName ?? null, errorMessage: v.errorMessage?.slice(0, 1000) ?? null,
    action: v.action, status: v.status,
    compensationActionStatus: v.compensationActionStatus ?? 'none',
    failedNodeKey: v.failedNodeKey ?? null,
    actionPayload: (v.actionPayload ?? null) as Record<string, unknown> | null,
    tenantId: v.tenantId,
  }).returning({ id: workflowCompensations.id });
  return row.id;
}

/** 追加一条补偿工单处理历史（时间线）。 */
export async function addCompensationLog(tx: DbExecutor, v: {
  compensationId: number;
  action: 'note' | 'attachment' | 'auto' | 'retry' | 'resume' | 'resolve' | 'terminate';
  note?: string | null;
  attachments?: Array<{ id: number; name: string; url: string }> | null;
  operatorId?: number | null;
  tenantId: number | null;
}): Promise<void> {
  await tx.insert(workflowCompensationLogs).values({
    compensationId: v.compensationId,
    action: v.action,
    note: v.note?.slice(0, 4000) ?? null,
    attachments: (v.attachments ?? null) as Record<string, unknown>[] | null,
    operatorId: v.operatorId ?? null,
    tenantId: v.tenantId,
  });
}

/** 反向/兜底动作执行结果回写（由 compensation_action job handler 调用，无登录上下文）。 */
export async function markCompensationActionResult(compensationId: number, status: WorkflowCompensationActionStatus, note?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.update(workflowCompensations)
      .set({ compensationActionStatus: status })
      .where(eq(workflowCompensations.id, compensationId)).returning();
    if (row && status !== 'running' && status !== 'pending') {
      await addCompensationLog(tx, { compensationId, action: 'auto', note: `自动动作${status === 'succeeded' ? '成功' : '失败'}${note ? '：' + note : ''}`, tenantId: row.tenantId });
    }
  });
}

export async function listCompensations(q: { status?: string; instanceId?: number; page?: number; pageSize?: number }) {
  const page = q.page ?? 1, pageSize = q.pageSize ?? 20;
  const tc = tenantCondition(workflowCompensations, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (q.status) conds.push(eq(workflowCompensations.status, q.status));
  if (q.instanceId) conds.push(eq(workflowCompensations.instanceId, q.instanceId));
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowCompensations, where),
    rows: () => db.select().from(workflowCompensations).where(where).orderBy(desc(workflowCompensations.id)).limit(pageSize).offset((page - 1) * pageSize),
    map,
  });
}

/** 人工修复：resolve=补偿完成放行（保留实例），terminate=终止实例并取消待办 */
export async function resolveCompensation(id: number, action: 'resolve' | 'terminate', resolution?: string) {
  const tc = tenantCondition(workflowCompensations, currentUser());
  const conds = [eq(workflowCompensations.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowCompensations).where(and(...conds)).limit(1);
  requireRow(row, '补偿工单不存在');
  if (row.status !== 'pending') throw new HTTPException(400, { message: '工单已处理' });
  return db.transaction(async (tx) => {
    if (action === 'terminate') {
      await tx.update(workflowTasks).set({ status: 'skipped', actionAt: new Date() }).where(and(eq(workflowTasks.instanceId, row.instanceId), eq(workflowTasks.status, 'pending')));
      await tx.update(workflowTokens).set({ status: 'consumed', consumedAt: new Date() }).where(and(eq(workflowTokens.instanceId, row.instanceId), eq(workflowTokens.status, 'active')));
      await tx.update(workflowInstances).set({ status: 'rejected', currentNodeKey: null }).where(eq(workflowInstances.id, row.instanceId));
      await bridgeReportFillWorkflowOutcome(tx, {
        workflowInstanceId: row.instanceId,
        outcome: 'rejected',
        actorId: currentUser().userId,
        comment: resolution,
      });
    }
    const [updated] = await tx.update(workflowCompensations)
      .set({ status: action === 'terminate' ? 'terminated' : 'resolved', resolution: resolution ?? null, resolvedBy: currentUser()?.userId ?? null, resolvedAt: new Date() })
      .where(eq(workflowCompensations.id, id)).returning();
    await addCompensationLog(tx, { compensationId: id, action: action === 'terminate' ? 'terminate' : 'resolve', note: resolution ?? null, operatorId: currentUser()?.userId ?? null, tenantId: row.tenantId });
    return map(updated);
  });
}

const mapLog = (r: { id: number; compensationId: number; action: string; note: string | null; attachments: unknown; operatorId: number | null; createdAt: Date; operatorName?: string | null }) => ({
  id: r.id, compensationId: r.compensationId,
  action: r.action as 'note' | 'attachment' | 'auto' | 'retry' | 'resume' | 'resolve' | 'terminate',
  note: r.note ?? null,
  attachments: (r.attachments ?? null) as Array<{ id: number; name: string; url: string }> | null,
  operatorId: r.operatorId ?? null, operatorName: r.operatorName ?? null, createdAt: formatDateTime(r.createdAt),
});

async function findCompensationOr404(id: number): Promise<Row> {
  const tc = tenantCondition(workflowCompensations, currentUser());
  const conds = [eq(workflowCompensations.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowCompensations).where(and(...conds)).limit(1);
  return requireRow(row, '补偿工单不存在');
}

/** 补偿工单详情（含处理历史时间线）。 */
export async function getCompensationDetail(id: number) {
  const row = await findCompensationOr404(id);
  const logs = await db.select({
    id: workflowCompensationLogs.id, compensationId: workflowCompensationLogs.compensationId,
    action: workflowCompensationLogs.action, note: workflowCompensationLogs.note,
    attachments: workflowCompensationLogs.attachments, operatorId: workflowCompensationLogs.operatorId,
    createdAt: workflowCompensationLogs.createdAt, operatorName: users.nickname,
  }).from(workflowCompensationLogs)
    .leftJoin(users, eq(workflowCompensationLogs.operatorId, users.id))
    .where(eq(workflowCompensationLogs.compensationId, id))
    .orderBy(asc(workflowCompensationLogs.id));
  return { ...map(row), logs: logs.map(mapLog) };
}

/** 追加处理备注 / 附件（任何状态均可，用于沉淀处理过程）。 */
export async function addCompensationNote(id: number, note?: string, attachments?: Array<{ id: number; name: string; url: string }>) {
  const row = await findCompensationOr404(id);
  await addCompensationLog(db, {
    compensationId: id,
    action: attachments?.length ? 'attachment' : 'note',
    note: note ?? null, attachments: attachments ?? null,
    operatorId: currentUser()?.userId ?? null, tenantId: row.tenantId,
  });
  return getCompensationDetail(id);
}

/** 重试失败的自动反向 / 兜底动作（仅 compensationActionStatus='failed' 可重试）。 */
export async function retryCompensationAction(id: number) {
  const row = await findCompensationOr404(id);
  if (row.compensationActionStatus !== 'failed') throw new HTTPException(400, { message: '仅失败的自动动作可重试' });
  const action = (row.actionPayload ?? null) as WorkflowCompensationAction | null;
  if (!action?.type) throw new HTTPException(400, { message: '该工单无可重试的动作配置' });
  const nodeKey = row.failedNodeKey ?? row.nodeKey;
  await db.update(workflowCompensations).set({ compensationActionStatus: 'pending' }).where(eq(workflowCompensations.id, id));
  await addCompensationLog(db, { compensationId: id, action: 'retry', operatorId: currentUser()?.userId ?? null, tenantId: row.tenantId });
  await enqueueJob({
    jobType: 'compensation_action',
    payload: { compensationId: id, instanceId: row.instanceId, nodeKey, error: row.errorMessage ?? '', action },
    instanceId: row.instanceId, nodeKey,
    idempotencyKey: `compaction:retry:${id}:${Date.now()}`,
    maxAttempts: (action.maxRetries ?? 3) + 1, tenantId: row.tenantId,
  });
  return getCompensationDetail(id);
}
