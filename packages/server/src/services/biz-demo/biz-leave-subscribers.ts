/**
 * 请假业务的工作流事件订阅者
 *
 * 监听 biz_leave 类型流程的终态事件，回写请假单状态（仿 payment-subscribers）。
 * 事件处理在请求上下文之外异步触发，审计 Proxy 会自动跳过 createdBy/updatedBy 注入。
 */
import { and, eq } from 'drizzle-orm';
import type { BizLeaveStatus } from '@zenith/shared/biz';
import type { DbTransaction } from '../../db/types';
import type { WorkflowInstance } from '@zenith/shared/workflow';
import { exactTenantCondition } from '../../lib/tenant';
import { bizLeaves } from '../../db/schema';
import logger from '../../lib/logger';
import { onWorkflowResult } from '../../lib/workflow-biz-bridge';
import { BIZ_LEAVE_TYPE } from './biz-leave.service';

let registered = false;

export function registerBizLeaveSubscribers(): void {
  if (registered) return;
  registered = true;

  onWorkflowResult(BIZ_LEAVE_TYPE, {
    onApproved: (tx, instance) => updateLeaveStatus(tx, instance, 'approved'),
    onRejected: (tx, instance) => updateLeaveStatus(tx, instance, 'rejected'),
    onWithdrawn: (tx, instance) => updateLeaveStatus(tx, instance, 'cancelled'),
  });

  logger.info('Biz-leave workflow subscribers registered');
}

async function updateLeaveStatus(tx: DbTransaction, instance: WorkflowInstance, status: BizLeaveStatus): Promise<void> {
  const id = Number(instance.bizId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid leave workflow business identity');
  await tx.update(bizLeaves).set({ status, workflowStatus: instance.status }).where(and(
    eq(bizLeaves.id, id), eq(bizLeaves.workflowInstanceId, instance.id), exactTenantCondition(bizLeaves.tenantId, instance.tenantId),
  ));
}
