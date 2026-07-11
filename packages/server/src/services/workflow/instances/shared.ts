// ─── 工作流事件发射与流水号上下文（拆分自 workflow-instances.service.ts）───
import type { WorkflowTask as WorkflowTaskDto, WorkflowCustomFormConfig, WorkflowDefinitionSnapshot, WorkflowFlowData, WorkflowFormType } from '@zenith/shared';
import { currentUserOrNull, currentUserDetail } from '../../../lib/context';
import type { DbExecutor } from '../../../db/types';
import type { WorkflowSerialNoConfig } from '@zenith/shared';
import type { WorkflowDefinitionRow } from '../../../db/schema';
import { workflowEventBus } from '../../../lib/workflow-event-bus';
import { type SerialNoGenContext } from '../workflow-serial.service';
import { mapInstance } from './mapping';

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
  type: 'instance.created' | 'instance.approved' | 'instance.rejected' | 'instance.withdrawn',
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
  return executor ? workflowEventBus.emitInTx(ev, executor) : void workflowEventBus.emit(ev);
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
  return executor ? workflowEventBus.emitInTx(ev, executor) : void workflowEventBus.emit(ev);
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
  return executor ? workflowEventBus.emitInTx(ev, executor) : void workflowEventBus.emit(ev);
}
