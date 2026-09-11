// ─── 工作流事件发射与流水号上下文（拆分自 workflow-instances.service.ts）───
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowTask as WorkflowTaskDto, WorkflowCustomFormConfig, WorkflowDefinitionSnapshot, WorkflowFlowData, WorkflowFormType, WorkflowSerialNoConfig } from '@zenith/shared/workflow';
import { currentUser, currentUserOrNull, currentUserDetail } from '../../../lib/context';
import { db } from '../../../db';
import type { DbExecutor } from '../../../db/types';
import { workflowInstances, workflowTasks, type WorkflowDefinitionRow } from '../../../db/schema';
import { requireRow } from '../../../lib/db-assert';
import { tenantCondition } from '../../../lib/tenant';
import { buildWhere } from '../../../lib/where-helpers';
import { workflowEventBus } from '../../../lib/workflow-event-bus';
import { type SerialNoGenContext } from '../workflow-serial.service';
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

/**
 * 构建业务编号生成上下文。
 * - 未启用 → undefined；
 * - 结构化模式 → 仅带 formData（不含动态变量，省去用户详情查询）；
 * - 模板模式 → 解析发起人部门 / 账号 / 昵称 / 租户等动态变量。
 */
export async function buildSerialNoContext(
  config: WorkflowSerialNoConfig | undefined | null,
  formData: Record<string, unknown>,
): Promise<SerialNoGenContext | undefined> {
  if (!config?.enabled) return undefined;
  if (config.mode !== 'template') return { formData };
  const user = currentUserOrNull();
  if (!user) return { formData };
  const detail = await currentUserDetail();
  return {
    formData,
    vars: {
      dept: detail?.department?.name ?? '',
      deptCode: detail?.department?.code ?? '',
      user: detail?.username ?? user.username ?? '',
      nickname: detail?.nickname ?? '',
      tenant: user.tenantId != null ? String(user.tenantId) : '',
    },
  };
}

/** 发射实例生命周期事件的辅助函数（传 executor 时在事务内入队 outbox，需 await） */
export function emitInstanceEvent(
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn' | 'instance.returned',
  instance: ReturnType<typeof mapInstance>,
  actor: { userId: number; name?: string | null },
  executor?: DbExecutor,
): void | Promise<unknown> {
  const ev = {
    type,
    instanceId: instance.id,
    definitionId: instance.definitionId,
    tenantId: instance.tenantId ?? null,
    actor,
    instance,
  } as Parameters<typeof workflowEventBus.emit>[0];
  if (executor) return workflowEventBus.emitInTx(ev, executor);
  workflowEventBus.emit(ev);
}

/** 发射任务生命周期事件的辅助函数（传 executor 时在事务内入队 outbox，需 await） */
export function emitTaskEvent(
  type: 'task.created' | 'task.approved' | 'task.rejected' | 'task.skipped' | 'task.transferred' | 'task.assigned' | 'task.addSigned' | 'task.reduceSigned' | 'task.urged',
  task: WorkflowTaskDto,
  meta: { definitionId: number; tenantId: number | null; actor?: { userId: number; name?: string | null }; comment?: string | null },
  executor?: DbExecutor,
): void | Promise<unknown> {
  const ev = {
    type,
    instanceId: task.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    task,
    comment: meta.comment,
  } as Parameters<typeof workflowEventBus.emit>[0];
  if (executor) return workflowEventBus.emitInTx(ev, executor);
  workflowEventBus.emit(ev);
}

/** 发射节点进入/离开事件（传 executor 时在事务内入队 outbox，需 await） */
export function emitNodeEvent(
  type: 'node.entered' | 'node.left',
  meta: { instanceId: number; definitionId: number; tenantId: number | null; nodeKey: string; nodeName: string; nodeType: WorkflowTaskDto['nodeType']; actor?: { userId: number; name?: string | null } },
  executor?: DbExecutor,
): void | Promise<unknown> {
  const ev = {
    type,
    instanceId: meta.instanceId,
    definitionId: meta.definitionId,
    tenantId: meta.tenantId,
    actor: meta.actor,
    nodeKey: meta.nodeKey,
    nodeName: meta.nodeName,
    nodeType: meta.nodeType,
  } as Parameters<typeof workflowEventBus.emit>[0];
  if (executor) return workflowEventBus.emitInTx(ev, executor);
  workflowEventBus.emit(ev);
}

type TaskRow = typeof workflowTasks.$inferSelect;

/**
 * 推进产生的新任务统一补发 node.entered → task.created → 按状态 task.assigned / approved / rejected。
 * 传 executor 时在事务内入队 outbox（需 await）；不传则提交后同步发射。
 */
export function emitTasksEnteredEvents(
  instanceId: number,
  tasks: readonly TaskRow[],
  meta: { definitionId: number; tenantId: number | null; actor?: { userId: number; name?: string | null } },
  executor?: DbExecutor,
): void | Promise<void> {
  const emitsFor = (t: TaskRow) => [
    () => emitNodeEvent('node.entered', { instanceId, ...meta, nodeKey: t.nodeKey, nodeName: t.nodeName, nodeType: t.nodeType }, executor),
    () => emitTaskEvent('task.created', mapTask(t), meta, executor),
    () => (t.assigneeId && t.status === 'pending' ? emitTaskEvent('task.assigned', mapTask(t), meta, executor) : undefined),
    () => (t.status === 'approved' ? emitTaskEvent('task.approved', mapTask(t), meta, executor) : undefined),
    () => (t.status === 'rejected' ? emitTaskEvent('task.rejected', mapTask(t), meta, executor) : undefined),
  ];
  if (!executor) {
    for (const t of tasks) for (const emit of emitsFor(t)) emit();
    return;
  }
  return (async () => {
    for (const t of tasks) for (const emit of emitsFor(t)) await emit();
  })();
}