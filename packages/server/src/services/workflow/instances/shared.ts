// ─── 工作流事件发射与流水号上下文（拆分自 workflow-instances.service.ts）───
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { getWorkflowBusinessAdapter } from '../../../lib/workflow-business';
import type { WorkflowTask as WorkflowTaskDto, WorkflowCustomFormConfig, WorkflowDefinitionSnapshot, WorkflowFlowData, WorkflowFormType } from '@zenith/shared/workflow';
import { currentUser } from '../../../lib/context';
import { db } from '../../../db';
import type { DbExecutor, DbTransaction } from '../../../db/types';
import { workflowInstances, workflowTasks, type WorkflowDefinitionRow } from '../../../db/schema';
import { requireRow } from '../../../lib/db-assert';
import { tenantCondition } from '../../../lib/tenant';
import { buildWhere } from '../../../lib/where-helpers';
import { workflowEventBus } from '../../../lib/workflow-event-bus';
import { mapInstance, mapTask } from './mapping';

type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;

/** 按 id 取当前用户租户可见范围内的实例（条件：`id` + `tenantCondition`）；不存在或不可见返回 undefined */
export async function findVisibleInstance(id: number, executor: DbExecutor = db): Promise<WorkflowInstanceRow | undefined> {
  const [inst] = await executor.select().from(workflowInstances)
    .where(buildWhere(eq(workflowInstances.id, id), tenantCondition(workflowInstances, currentUser())))
    .limit(1);
  return inst;
}

/** 同 `findVisibleInstance`，不存在则抛 404；文案按操作语义覆盖（如「任务不存在或无权操作」） */
export async function requireVisibleInstance(id: number, message = '流程实例不存在', executor: DbExecutor = db): Promise<WorkflowInstanceRow> {
  return requireRow(await findVisibleInstance(id, executor), message);
}

/**
 * 外部回调定位（公开回调路由、外部审批 / 触发器唤醒共用）：按 `externalCallbackId` 取任务与所属实例，
 * 并从实例快照解析该任务节点的配置；任务不存在 404。回调无登录态，不带租户条件。
 */
export async function requireCallbackTaskContext(callbackId: string) {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  requireRow(task, '回调任务不存在');
  const inst = requireRow(
    (await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1))[0],
    '流程实例不存在',
  );
  const nodeConfig = inst.definitionSnapshot?.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  return { task, inst, nodeConfig };
}

/**
 * 事务内对实例加行级锁并在锁内重校验状态：把同一实例上的并发审批 / 推进 / 管理操作串行化，
 * 避免状态互相覆盖或残留任务。状态与预期不符时抛 409，文案由调用方按操作给出。
 */
export async function lockInstanceExpecting(
  tx: DbExecutor,
  instanceId: number,
  expectedStatus: typeof workflowInstances.$inferSelect['status'],
  conflictMessage: string,
): Promise<void> {
  const [locked] = await tx.select({ status: workflowInstances.status })
    .from(workflowInstances).where(eq(workflowInstances.id, instanceId)).for('update').limit(1);
  if (!locked || locked.status !== expectedStatus) {
    throw new HTTPException(409, { message: conflictMessage });
  }
}

/**
 * 定义行 → 实例定义快照（发起 / 提交草稿 / 子流程 / 版本迁移共用）。
 * 单点承担 jsonb 列的类型窄化，并只保留快照 DTO 关心的字段。
 */
export function toDefinitionSnapshot(
  def: WorkflowDefinitionRow,
  flowDataOverride?: WorkflowFlowData,
): WorkflowDefinitionSnapshot {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    categoryId: def.categoryId,
    flowData: flowDataOverride ?? (def.flowData as WorkflowFlowData | null),
    formId: def.formId,
    formType: def.formType as WorkflowFormType,
    customForm: (def.customForm as WorkflowCustomFormConfig | null) ?? null,
    status: def.status,
    version: def.version,
    tenantId: def.tenantId,
  };
}

/** 在业务事务内持久化实例事件，并同步执行必须随审批提交的业务回写。 */
export async function emitInstanceEvent(
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn' | 'instance.returned',
  instance: ReturnType<typeof mapInstance>,
  actor: { userId: number; name?: string | null },
  executor: DbTransaction,
): Promise<unknown> {
  if (type !== 'instance.created') {
    await getWorkflowBusinessAdapter(instance.bizType)?.onOutcomeInTransaction?.(executor, instance, actor.userId);
  }
  const ev = {
    type,
    instanceId: instance.id,
    definitionId: instance.definitionId,
    tenantId: instance.tenantId ?? null,
    actor,
    instance,
  } as Parameters<typeof workflowEventBus.emitInTx>[0];
  return workflowEventBus.emitInTx(ev, executor);
}

/** 在任务状态变更的同一事务内持久化任务事件。 */
export function emitTaskEvent(
  type: 'task.created' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.assigned' | 'task.addSigned' | 'task.reduceSigned' | 'task.urged',
  task: WorkflowTaskDto,
  meta: { definitionId: number; tenantId: number | null; actor?: { userId: number; name?: string | null }; comment?: string | null },
  executor: DbTransaction,
): Promise<unknown> {
  const ev = {
    type,
    instanceId: task.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    task,
    comment: meta.comment,
  } as Parameters<typeof workflowEventBus.emitInTx>[0];
  return workflowEventBus.emitInTx(ev, executor);
}

/** 在节点推进的同一事务内持久化节点进入/离开事件。 */
export function emitNodeEvent(
  type: 'node.entered' | 'node.left',
  meta: { instanceId: number; definitionId: number; tenantId: number | null; nodeKey: string; nodeName: string; nodeType: WorkflowTaskDto['nodeType']; actor?: { userId: number; name?: string | null } },
  executor: DbTransaction,
): Promise<unknown> {
  const ev = {
    type,
    instanceId: meta.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    nodeKey: meta.nodeKey,
    nodeName: meta.nodeName,
    nodeType: meta.nodeType,
  } as Parameters<typeof workflowEventBus.emitInTx>[0];
  return workflowEventBus.emitInTx(ev, executor);
}

type TaskRow = typeof workflowTasks.$inferSelect;

/** 推进产生的新任务在同一事务中按 node.entered → task.created → 状态事件的顺序持久化。 */
export async function emitTasksEnteredEvents(
  instanceId: number,
  tasks: readonly TaskRow[],
  meta: { definitionId: number; tenantId: number | null; actor?: { userId: number; name?: string | null } },
  executor: DbTransaction,
): Promise<void> {
  for (const task of tasks) {
    await emitNodeEvent('node.entered', { instanceId, ...meta, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType }, executor);
    const dto = mapTask(task);
    await emitTaskEvent('task.created', dto, meta, executor);
    if (task.assigneeId && task.status === 'pending') await emitTaskEvent('task.assigned', dto, meta, executor);
    if (task.status === 'approved') await emitTaskEvent('task.approved', dto, meta, executor);
    if (task.status === 'rejected') await emitTaskEvent('task.rejected', dto, meta, executor);
  }
}
