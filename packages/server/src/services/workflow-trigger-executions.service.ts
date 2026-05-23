import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { workflowTriggerExecutions, workflowInstances } from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { tenantCondition } from '../lib/tenant';
import { pageOffset } from '../lib/pagination';
import { formatDateTime } from '../lib/datetime';

export function mapTriggerExecution(row: typeof workflowTriggerExecutions.$inferSelect) {
  return {
    id: row.id,
    instanceId: row.instanceId,
    taskId: row.taskId ?? null,
    nodeKey: row.nodeKey,
    nodeName: row.nodeName ?? null,
    triggerType: row.triggerType,
    status: row.status,
    attempt: row.attempt,
    requestUrl: row.requestUrl ?? null,
    requestMethod: row.requestMethod ?? null,
    requestBody: row.requestBody ?? null,
    responseStatus: row.responseStatus ?? null,
    responseBody: row.responseBody ?? null,
    errorMessage: row.errorMessage ?? null,
    durationMs: row.durationMs ?? null,
    tenantId: row.tenantId ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function insertTriggerExecution(input: typeof workflowTriggerExecutions.$inferInsert) {
  const [row] = await db.insert(workflowTriggerExecutions).values(input).returning();
  return row;
}

export interface ListTriggerExecutionsParams {
  page?: number;
  pageSize?: number;
  instanceId?: number;
  nodeKey?: string;
  status?: typeof workflowTriggerExecutions.$inferSelect['status'];
}

export async function listTriggerExecutions(params: ListTriggerExecutionsParams) {
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
  const tc = tenantCondition(workflowTriggerExecutions, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (params.instanceId) conds.push(eq(workflowTriggerExecutions.instanceId, params.instanceId));
  if (params.nodeKey) conds.push(eq(workflowTriggerExecutions.nodeKey, params.nodeKey));
  if (params.status) conds.push(eq(workflowTriggerExecutions.status, params.status));
  const where = conds.length ? and(...conds) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(workflowTriggerExecutions, where),
    db.select().from(workflowTriggerExecutions)
      .where(where)
      .orderBy(desc(workflowTriggerExecutions.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapTriggerExecution), total, page, pageSize };
}

export async function getTriggerExecution(id: number) {
  const tc = tenantCondition(workflowTriggerExecutions, currentUser());
  const conds = [eq(workflowTriggerExecutions.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowTriggerExecutions).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '触发器执行记录不存在' });
  return mapTriggerExecution(row);
}

/** 从 instance 取 tenantId（用于 subscriber 内部调用，无 currentUser） */
export async function resolveInstanceTenantId(instanceId: number): Promise<number | null> {
  const [row] = await db.select({ tenantId: workflowInstances.tenantId })
    .from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
  return row?.tenantId ?? null;
}
