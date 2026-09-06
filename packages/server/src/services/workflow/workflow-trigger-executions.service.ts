import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { workflowJobExecutions, workflowJobs, workflowTasks, workflowInstances } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime } from '../../lib/datetime';
import type { WorkflowTriggerExecution, WorkflowTriggerExecutionStatus, WorkflowTriggerType } from '@zenith/shared/workflow';
import { requireRow } from '../../lib/db-assert';

/**
 * 触发器执行记录的原始行。nodeName 取自 workflow_tasks.node_name（非空列，建任务时冻结），
 * 是唯一权威来源；triggerType 只存在于作业 payload（定义快照里的节点配置，无关系型来源）。
 */
export interface TriggerExecutionRow {
  execution: typeof workflowJobExecutions.$inferSelect;
  job: typeof workflowJobs.$inferSelect;
  nodeName: string | null;
  /** 实例标题；引擎内省等调用方不查实例表时可缺省 */
  instanceTitle?: string | null;
}

function getPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/**
 * 执行记录状态：由父作业状态与本次尝试共同决定，是展示与筛选的唯一口径。
 * 仍有重试预算时区分「已试过（retrying，含退避窗口内的 pending）」与「未开始（pending）」，
 * 预算耗尽、死信与取消统一为终态 failed。
 *
 * 改这里必须同步 {@link triggerExecutionStatusSql}，两者是同一规则的 TS 与 SQL 表达。
 */
export function deriveTriggerExecutionStatus(
  job: Pick<typeof workflowJobs.$inferSelect, 'status' | 'attempts' | 'maxAttempts'>,
  execution?: Pick<typeof workflowJobExecutions.$inferSelect, 'status'> | null,
): WorkflowTriggerExecutionStatus {
  if (execution?.status === 'succeeded' || job.status === 'succeeded') return 'success';
  if (execution?.status === 'running' || job.status === 'running') return 'running';
  if (job.status === 'dead' || job.status === 'canceled') return 'failed';
  if (job.attempts < job.maxAttempts) return job.attempts > 0 ? 'retrying' : 'pending';
  return 'failed';
}

/** {@link deriveTriggerExecutionStatus} 的 SQL 等价表达，供列表按状态筛选，保证筛选与展示一致。 */
export const triggerExecutionStatusSql = sql<WorkflowTriggerExecutionStatus>`
  case
    when ${workflowJobExecutions.status} = 'succeeded' or ${workflowJobs.status} = 'succeeded' then 'success'
    when ${workflowJobExecutions.status} = 'running' or ${workflowJobs.status} = 'running' then 'running'
    when ${workflowJobs.status} in ('dead', 'canceled') then 'failed'
    when ${workflowJobs.attempts} < ${workflowJobs.maxAttempts}
      then case when ${workflowJobs.attempts} > 0 then 'retrying' else 'pending' end
    else 'failed'
  end`;

export function mapTriggerExecution(row: TriggerExecutionRow): WorkflowTriggerExecution {
  const { execution, job } = row;
  return {
    id: execution.id,
    instanceId: job.instanceId ?? 0,
    instanceTitle: row.instanceTitle ?? null,
    taskId: job.taskId ?? null,
    nodeKey: job.nodeKey ?? '',
    nodeName: row.nodeName,
    triggerType: (getPayloadString(job.payload, 'triggerType') ?? 'webhook') as WorkflowTriggerType,
    status: deriveTriggerExecutionStatus(job, execution),
    attempt: execution.attempt,
    requestUrl: execution.requestUrl ?? null,
    requestMethod: execution.requestMethod ?? null,
    requestBody: execution.requestBody ?? null,
    responseStatus: execution.responseStatus ?? null,
    responseBody: execution.responseBody ?? null,
    errorMessage: execution.errorMessage ?? job.lastError ?? null,
    durationMs: execution.durationMs ?? null,
    tenantId: execution.tenantId ?? job.tenantId ?? null,
    createdAt: formatDateTime(execution.createdAt),
  };
}

/** 执行记录查询的公共选择列与关联：父作业提供上下文，任务提供节点名，实例提供标题 */
const TRIGGER_EXECUTION_SELECTION = {
  execution: workflowJobExecutions,
  job: workflowJobs,
  nodeName: workflowTasks.nodeName,
  instanceTitle: workflowInstances.title,
} as const;

export interface ListTriggerExecutionsParams {
  page?: number;
  pageSize?: number;
  instanceId?: number;
  nodeKey?: string;
  status?: WorkflowTriggerExecutionStatus;
}

export async function listTriggerExecutions(params: ListTriggerExecutionsParams) {
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
  const tc = tenantCondition(workflowJobExecutions, currentUser());
  const conds: SQL[] = [eq(workflowJobExecutions.jobType, 'trigger_dispatch')];
  if (tc) conds.push(tc);
  if (params.instanceId) conds.push(eq(workflowJobs.instanceId, params.instanceId));
  if (params.nodeKey) conds.push(eq(workflowJobs.nodeKey, params.nodeKey));
  if (params.status) conds.push(sql`${triggerExecutionStatusSql} = ${params.status}`);
  const where = and(...conds);

  const [total, rows] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` })
      .from(workflowJobExecutions)
      .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
      .where(where)
      .then((r) => r[0]?.c ?? 0),
    db.select(TRIGGER_EXECUTION_SELECTION).from(workflowJobExecutions)
      .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
      .leftJoin(workflowTasks, eq(workflowJobs.taskId, workflowTasks.id))
      .leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id))
      .where(where)
      .orderBy(desc(workflowJobExecutions.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapTriggerExecution), total, page, pageSize };
}

export async function getTriggerExecution(id: number) {
  const tc = tenantCondition(workflowJobExecutions, currentUser());
  const conds: SQL[] = [eq(workflowJobExecutions.id, id), eq(workflowJobExecutions.jobType, 'trigger_dispatch')];
  if (tc) conds.push(tc);
  const [row] = await db.select(TRIGGER_EXECUTION_SELECTION)
    .from(workflowJobExecutions)
    .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
    .leftJoin(workflowTasks, eq(workflowJobs.taskId, workflowTasks.id))
    .leftJoin(workflowInstances, eq(workflowJobs.instanceId, workflowInstances.id))
    .where(and(...conds))
    .limit(1);
  return mapTriggerExecution(requireRow(row, '触发器执行记录不存在'));
}
