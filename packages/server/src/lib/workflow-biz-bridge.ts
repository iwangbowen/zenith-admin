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
import { and, desc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowInstance, WorkflowInstancePriority, WorkflowInstanceStatus } from '@zenith/shared/workflow';
import type { WorkflowFormType } from '@zenith/shared/workflow';
import { db } from '../db';
import { workflowDefinitions, workflowInstances } from '../db/schema';
import { registerWorkflowEventConsumer } from './workflow-event-consumer';
import type { DbTransaction } from '../db/types';
import type { ConsumerResult } from './domain-events';
import logger from './logger';
import { createInstance } from '../services/workflow/workflow-instances.service';

export interface StartWorkflowForBizInput {
  /** 已发布的流程定义 ID */
  definitionId: number;
  title: string;
  /** 业务类型（与业务表对应，如 biz_leave） */
  bizType: string;
  /** 业务记录主键（字符串） */
  bizId: string | number;
  /** 暴露给流程的路由变量（写入实例 formData，供条件分支/审批人使用） */
  variables?: Record<string, unknown>;
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

/**
 * 按名称解析业务接入的流程定义 ID（业务模块发起前调用）。
 *
 * 同名已发布定义可能同时存在多个（种子数据 + 运营复制/重建是常态）：
 * 无排序的 limit(1) 会随机命中旧版本，业务单据被静默路由到错误流程。
 * 这里固定取**最新发布**（id 最大）并对多匹配记录警告，提示运营收敛重名。
 */
export async function resolveBizDefinitionId(params: {
  name: string;
  /** 预期表单类型，默认 external（业务系统主导） */
  formType?: WorkflowFormType;
}): Promise<number> {
  const formType = params.formType ?? 'external';
  const rows = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(
      eq(workflowDefinitions.name, params.name),
      eq(workflowDefinitions.status, 'published'),
      eq(workflowDefinitions.formType, formType),
    ))
    .orderBy(desc(workflowDefinitions.id))
    .limit(2);
  if (rows.length === 0) {
    throw new HTTPException(400, { message: `未找到已发布的「${params.name}」流程定义，请先在流程定义中发布` });
  }
  if (rows.length > 1) {
    logger.warn(`[workflow-biz-bridge] 存在多个同名已发布定义「${params.name}」（formType=${formType}），已选用最新发布 #${rows[0].id}；请停用旧版本避免歧义`);
  }
  return rows[0].id;
}

type WorkflowResultHandler = (tx: DbTransaction, instance: WorkflowInstance) => Promise<ConsumerResult | void>;
export interface WorkflowResultHandlers {
  onApproved?: WorkflowResultHandler;
  onRejected?: WorkflowResultHandler;
  onWithdrawn?: WorkflowResultHandler;
  onCreated?: WorkflowResultHandler;
}
/** Business result consumers commit their writeback and independent receipt together. */
export function onWorkflowResult(bizType: string, handlers: WorkflowResultHandlers): void {
  registerWorkflowEventConsumer(`workflow.business.${bizType}`, ['instance.created', 'instance.approved', 'instance.rejected', 'instance.withdrawn'],
    async (tx, event) => {
      if (!event.instance.bizId) return { outcome: 'skipped', reason: 'business subject missing' };
      const handle = event.type === 'instance.created' ? handlers.onCreated : event.type === 'instance.approved' ? handlers.onApproved
        : event.type === 'instance.rejected' ? handlers.onRejected : handlers.onWithdrawn;
      return handle ? await handle(tx, event.instance) : { outcome: 'skipped', reason: 'business result not applicable' };
    }, { bizType });
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
