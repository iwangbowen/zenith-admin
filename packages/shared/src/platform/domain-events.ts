import * as z from 'zod';
import type { Permission } from '../core/permissions';
import { PAYMENT_DISPUTE_STATUSES, PAYMENT_RISK_ACTIONS, PAYMENT_RISK_REVIEW_STATUSES } from '../payment/constants';
import { ASYNC_TASK_TERMINAL_STATUSES } from '../tasks/constants';

const paymentSummary = z.object({
  orderNo: z.string().max(64),
  amount: z.number().int().nonnegative(),
  currency: z.string().max(8),
});
const refundSummary = paymentSummary.extend({ refundNo: z.string().max(64), refundAmount: z.number().int().nonnegative() });
const riskReviewSummary = z.object({ reviewNo: z.string().max(64), status: z.enum(PAYMENT_RISK_REVIEW_STATUSES) });
const disputeSummary = z.object({ disputeNo: z.string().max(64), status: z.enum(PAYMENT_DISPUTE_STATUSES) });
const workflowInstanceSummary = z.object({ instanceId: z.number().int().positive(), status: z.string().max(32) });
const workflowReadPermissions = ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] as const;
const taskTerminalSummary = z.object({ taskType: z.string().max(96), status: z.enum(ASYNC_TASK_TERMINAL_STATUSES), attempt: z.number().int().nonnegative() });
const notificationResultSummary = z.object({
  eventKey: z.string().max(128),
  status: z.enum(['done', 'failed']),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
  suppressed: z.number().int().nonnegative(),
});

/** Safe timeline summaries only: provider payloads, addresses and form/comment bodies never enter this catalog. */
export const DOMAIN_EVENT_CATALOG = {
  'payment.succeeded': { permission: 'payment:order:list', summarySchema: paymentSummary },
  'payment.closed': { permission: 'payment:order:list', summarySchema: paymentSummary },
  'payment.failed': { permission: 'payment:order:list', summarySchema: paymentSummary },
  'refund.succeeded': { permission: 'payment:refund:list', summarySchema: refundSummary },
  'refund.failed': { permission: 'payment:refund:list', summarySchema: refundSummary },
  'payment.risk.hit': { permission: 'payment:risk:list', summarySchema: z.object({ action: z.enum(PAYMENT_RISK_ACTIONS) }) },
  'payment.risk.review.created': { permission: 'payment:risk:review', summarySchema: riskReviewSummary },
  'payment.risk.review.decided': { permission: 'payment:risk:review', summarySchema: riskReviewSummary },
  'payment.dispute.replied': { permission: 'payment:dispute:list', summarySchema: disputeSummary },
  'payment.dispute.resolved': { permission: 'payment:dispute:list', summarySchema: disputeSummary },
  'payment.dispute.refund-requested': { permission: 'payment:dispute:list', summarySchema: disputeSummary },
  'payment.dispute.refunded': { permission: 'payment:dispute:list', summarySchema: disputeSummary },
  'payment.dispute.refund-failed': { permission: 'payment:dispute:list', summarySchema: disputeSummary },
  'workflow.instance.created': { permission: workflowReadPermissions, summarySchema: workflowInstanceSummary },
  'workflow.instance.approved': { permission: workflowReadPermissions, summarySchema: workflowInstanceSummary },
  'workflow.instance.rejected': { permission: workflowReadPermissions, summarySchema: workflowInstanceSummary },
  'workflow.instance.withdrawn': { permission: workflowReadPermissions, summarySchema: workflowInstanceSummary },
  'workflow.instance.returned': { permission: workflowReadPermissions, summarySchema: workflowInstanceSummary },
  'workflow.task.changed': {
    permission: workflowReadPermissions,
    summarySchema: z.object({ action: z.string().max(48), status: z.string().max(32) }),
  },
  'messaging.notification.queued': {
    permission: 'system:notify-policy:list',
    summarySchema: z.object({ eventKey: z.string().max(128) }),
  },
  'tasks.async-task.created': {
    permission: 'system:async-task:list',
    summarySchema: z.object({ taskType: z.string().max(96) }),
  },
  'tasks.async-task.succeeded': { permission: 'system:async-task:list', summarySchema: taskTerminalSummary },
  'tasks.async-task.failed': { permission: 'system:async-task:list', summarySchema: taskTerminalSummary },
  'tasks.async-task.cancelled': { permission: 'system:async-task:list', summarySchema: taskTerminalSummary },
  'messaging.notification.dispatched': { permission: 'system:notify-policy:list', summarySchema: notificationResultSummary },
  'messaging.notification.failed': { permission: 'system:notify-policy:list', summarySchema: notificationResultSummary },
} as const satisfies Record<string, { permission: Permission | readonly Permission[]; summarySchema: z.ZodType<Record<string, unknown>> }>;

export type DomainEventType = keyof typeof DOMAIN_EVENT_CATALOG;
export type DomainEventPayload<K extends DomainEventType> = z.input<(typeof DOMAIN_EVENT_CATALOG)[K]['summarySchema']>;

export const ENTITY_TIMELINE_EVENT_LABELS = {
  'payment.succeeded': '支付成功', 'payment.closed': '订单关闭', 'payment.failed': '支付失败',
  'refund.succeeded': '退款成功', 'refund.failed': '退款失败',
  'payment.risk.hit': '命中风控规则', 'payment.risk.review.created': '发起风控审核', 'payment.risk.review.decided': '风控审核完成',
  'payment.dispute.replied': '回复支付投诉', 'payment.dispute.resolved': '支付投诉已解决',
  'payment.dispute.refund-requested': '投诉发起退款', 'payment.dispute.refunded': '投诉退款完成', 'payment.dispute.refund-failed': '投诉退款失败',
  'workflow.instance.created': '流程发起', 'workflow.instance.approved': '流程通过',
  'workflow.instance.rejected': '流程驳回', 'workflow.instance.withdrawn': '流程撤回',
  'workflow.instance.returned': '流程退回', 'workflow.task.changed': '审批任务更新',
  'messaging.notification.queued': '通知进入发送队列', 'messaging.notification.dispatched': '通知派发完成', 'messaging.notification.failed': '通知派发失败',
  'tasks.async-task.created': '异步任务创建', 'tasks.async-task.succeeded': '异步任务完成', 'tasks.async-task.failed': '异步任务失败', 'tasks.async-task.cancelled': '异步任务取消',
  'platform.audit.operation': '操作记录',
} as const satisfies Record<DomainEventType | 'platform.audit.operation', string>;
export const ENTITY_TIMELINE_EVENT_TYPES = Object.keys(ENTITY_TIMELINE_EVENT_LABELS) as Array<keyof typeof ENTITY_TIMELINE_EVENT_LABELS>;
export const ENTITY_TIMELINE_EVENT_OPTIONS = ENTITY_TIMELINE_EVENT_TYPES.map((value) => ({ value, label: ENTITY_TIMELINE_EVENT_LABELS[value] }));

/** Unknown event types are not discoverable; callers must also authorize the event source object. */
export function getDomainEventDefinition(eventType: string) {
  return Object.prototype.hasOwnProperty.call(DOMAIN_EVENT_CATALOG, eventType)
    ? DOMAIN_EVENT_CATALOG[eventType as DomainEventType]
    : undefined;
}

/** Apply the same allowlist at write and read boundaries; unknown fields are stripped by Zod. */
export function parseDomainEventSummary(eventType: DomainEventType, payload: unknown): Record<string, unknown> {
  const definition = getDomainEventDefinition(eventType);
  if (!definition) throw new Error(`Unknown domain event type: ${eventType}`);
  return definition.summarySchema.parse(payload);
}
