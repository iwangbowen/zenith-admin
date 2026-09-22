import { and, eq, inArray } from 'drizzle-orm';
import type { CanonicalEntityType, EntityRelationItem } from '@zenith/shared/platform';
import { asyncTasks, iotAlarms, iotDevices, paymentRefunds, workflowInstances, workflowTasks } from '../../../db/schema';
import { hasPermission } from '../../../lib/context';
import { exactTenantCondition } from '../../../lib/tenant';
import type { RelationAccessContext, VisibleEntityAnchor } from './types';

/** Navigation hints only. The domain detail and mutation independently authorize every action. */
export async function addRelationActions(items: EntityRelationItem[], anchor: VisibleEntityAnchor, access: RelationAccessContext): Promise<EntityRelationItem[]> {
  if (access.user.impersonation?.readOnly) return items.map((item) => ({ ...item, action: undefined }));
  const ids = (type: CanonicalEntityType) => items.filter((item) => item.ref.type === type && /^[1-9]\d*$/.test(item.ref.key))
    .map((item) => Number(item.ref.key)).filter(Number.isSafeInteger);
  const actions = new Map<string, NonNullable<EntityRelationItem['action']>>();
  const refundIds = ids('payment.refund');
  if (refundIds.length && await hasPermission('payment:refund:approve')) {
    const rows = await access.db.select({ id: paymentRefunds.id }).from(paymentRefunds).where(and(
      inArray(paymentRefunds.id, refundIds), exactTenantCondition(paymentRefunds.tenantId, anchor.tenantId), eq(paymentRefunds.approvalStatus, 'pending')));
    for (const row of rows) actions.set(`payment.refund:${row.id}`, { label: '审核退款', target: { type: 'payment.refund', key: String(row.id) } });
  }
  const taskIds = ids('tasks.async');
  if (taskIds.length && await hasPermission('system:async-task:manage')) {
    const rows = await access.db.select({ id: asyncTasks.id }).from(asyncTasks).where(and(
      inArray(asyncTasks.id, taskIds), exactTenantCondition(asyncTasks.tenantId, anchor.tenantId), inArray(asyncTasks.status, ['failed', 'cancelled'])));
    for (const row of rows) actions.set(`tasks.async:${row.id}`, { label: '处理任务', target: { type: 'tasks.async', key: String(row.id) } });
  }
  const alarmIds = ids('iot.alarm');
  if (alarmIds.length && await hasPermission('iot:alarm:resolve')) {
    const rows = await access.db.select({ id: iotAlarms.id }).from(iotAlarms).innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id)).where(and(
      inArray(iotAlarms.id, alarmIds), exactTenantCondition(iotDevices.tenantId, anchor.tenantId), inArray(iotAlarms.status, ['firing', 'acknowledged'])));
    for (const row of rows) actions.set(`iot.alarm:${row.id}`, { label: '处理告警', target: { type: 'iot.alarm', key: String(row.id) } });
  }
  const approvalIds = ids('workflow.task');
  if (approvalIds.length && await hasPermission('workflow:task:handle')) {
    const rows = await access.db.select({ id: workflowTasks.id, instanceId: workflowTasks.instanceId }).from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id)).where(and(
        inArray(workflowTasks.id, approvalIds), eq(workflowTasks.status, 'pending'), eq(workflowTasks.assigneeId, access.user.userId),
        eq(workflowInstances.status, 'running'), exactTenantCondition(workflowInstances.tenantId, anchor.tenantId)));
    for (const row of rows) actions.set(`workflow.task:${row.id}`, { label: '办理审批', target: { type: 'workflow.instance', key: String(row.instanceId) } });
  }
  const instanceIds = ids('workflow.instance');
  if (instanceIds.length && await hasPermission('workflow:task:handle')) {
    const rows = await access.db.selectDistinct({ id: workflowInstances.id }).from(workflowInstances)
      .innerJoin(workflowTasks, eq(workflowTasks.instanceId, workflowInstances.id)).where(and(
        inArray(workflowInstances.id, instanceIds), eq(workflowInstances.status, 'running'), eq(workflowTasks.status, 'pending'),
        eq(workflowTasks.assigneeId, access.user.userId), exactTenantCondition(workflowInstances.tenantId, anchor.tenantId)));
    for (const row of rows) actions.set(`workflow.instance:${row.id}`, { label: '办理审批', target: { type: 'workflow.instance', key: String(row.id) } });
  }
  return items.map((item) => ({ ...item, action: actions.get(`${item.ref.type}:${item.ref.key}`) }));
}
