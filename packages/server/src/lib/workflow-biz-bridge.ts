/**
 * 工作流业务接入桥（Workflow ↔ Business Bridge）
 *
 * 为「业务模块自有实体」接入工作流提供统一 SDK：
 * - startWorkflowForBiz：业务保存自己的数据后，发起并关联一个工作流实例（businessKey = bizType + bizId）
 * - onWorkflowResult：订阅某业务类型流程的终态事件，回写业务记录状态（仿 payment-subscribers）
 * - getWorkflowStatusByBiz：按 businessKey 批量查询流程状态，供业务列表页展示
 *
 * 业务数据始终留在业务模块自己的表，工作流仅存 businessKey + 路由变量（formData）。
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { WorkflowInstance, WorkflowInstancePriority, WorkflowInstanceStatus } from '@zenith/shared';
import { db } from '../db';
import { workflowInstances } from '../db/schema';
import { workflowEventBus } from './workflow-event-bus';
import { createInstance } from '../services/workflow-instances.service';

export interface StartWorkflowForBizInput {
  /** 已发布的流程定义 ID */
  definitionId: number;
  /** 流程实例标题 */
  title: string;
  /** 业务类型（与业务表对应，如 biz_leave） */
  bizType: string;
  /** 业务记录主键（字符串） */
  bizId: string | number;
  /** 暴露给流程的路由变量（写入实例 formData，供条件分支/审批人使用） */
  variables?: Record<string, unknown>;
  /** 优先级 */
  priority?: WorkflowInstancePriority;
  /**
   * 指定发起人上下文。省略时取当前登录用户（currentUser）。
   * 在无请求上下文的后台任务里发起时必须显式传入。
   */
  caller?: { userId: number; username: string; tenantId: number | null; roles?: string[] };
}

/** 业务保存数据后发起并关联工作流实例 */
export async function startWorkflowForBiz(input: StartWorkflowForBizInput) {
  const bizType = input.bizType.trim();
  const bizId = String(input.bizId).trim();
  return createInstance(
    {
      definitionId: input.definitionId,
      title: input.title,
      formData: input.variables ?? {},
      priority: input.priority,
      bizType,
      bizId,
    },
    input.caller,
  );
}

export interface WorkflowResultHandlers {
  onApproved?: (instance: WorkflowInstance) => void | Promise<void>;
  onRejected?: (instance: WorkflowInstance) => void | Promise<void>;
  onWithdrawn?: (instance: WorkflowInstance) => void | Promise<void>;
  onCreated?: (instance: WorkflowInstance) => void | Promise<void>;
}

/**
 * 订阅指定业务类型流程的生命周期事件。
 * 仅当实例的 bizType 与订阅一致且存在 bizId 时回调，便于业务模块回写自己的记录状态。
 */
export function onWorkflowResult(bizType: string, handlers: WorkflowResultHandlers): void {
  const match = (instance: WorkflowInstance) => instance.bizType === bizType && !!instance.bizId;
  if (handlers.onCreated) {
    workflowEventBus.on('instance.created', (e) => { if (match(e.instance)) void handlers.onCreated?.(e.instance); });
  }
  if (handlers.onApproved) {
    workflowEventBus.on('instance.approved', (e) => { if (match(e.instance)) void handlers.onApproved?.(e.instance); });
  }
  if (handlers.onRejected) {
    workflowEventBus.on('instance.rejected', (e) => { if (match(e.instance)) void handlers.onRejected?.(e.instance); });
  }
  if (handlers.onWithdrawn) {
    workflowEventBus.on('instance.withdrawn', (e) => { if (match(e.instance)) void handlers.onWithdrawn?.(e.instance); });
  }
}

export interface WorkflowStatusForBiz {
  instanceId: number;
  status: WorkflowInstanceStatus;
  currentNodeKey: string | null;
}

/** 按 businessKey 批量查询流程状态（每个 bizId 取最新一条实例） */
export async function getWorkflowStatusByBiz(
  bizType: string,
  bizIds: Array<string | number>,
): Promise<Map<string, WorkflowStatusForBiz>> {
  const map = new Map<string, WorkflowStatusForBiz>();
  const ids = [...new Set(bizIds.map(String))];
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      id: workflowInstances.id,
      bizId: workflowInstances.bizId,
      status: workflowInstances.status,
      currentNodeKey: workflowInstances.currentNodeKey,
    })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.bizType, bizType), inArray(workflowInstances.bizId, ids)))
    .orderBy(workflowInstances.id);
  for (const r of rows) {
    if (r.bizId) map.set(r.bizId, { instanceId: r.id, status: r.status, currentNodeKey: r.currentNodeKey });
  }
  return map;
}
