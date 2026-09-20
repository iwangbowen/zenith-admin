import * as z from 'zod';
import type { Permission } from '../core/permissions';
import { PAYMENT_DISPUTE_STATUSES, PAYMENT_RISK_ACTIONS, PAYMENT_RISK_REVIEW_STATUSES } from '../payment/constants';

const paymentSummary = z.object({
  orderNo: z.string().max(64),
  amount: z.number().int().nonnegative(),
  currency: z.string().max(8),
});
const refundSummary = paymentSummary.extend({ refundNo: z.string().max(64), refundAmount: z.number().int().nonnegative() });
const riskReviewSummary = z.object({ reviewNo: z.string().max(64), status: z.enum(PAYMENT_RISK_REVIEW_STATUSES) });
const disputeSummary = z.object({ disputeNo: z.string().max(64), status: z.enum(PAYMENT_DISPUTE_STATUSES) });
const workflowInstanceSummary = z.object({ instanceId: z.number().int().positive(), status: z.string().max(32) });

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
  'workflow.instance.created': { permission: 'workflow:instance:list', summarySchema: workflowInstanceSummary },
  'workflow.instance.approved': { permission: 'workflow:instance:list', summarySchema: workflowInstanceSummary },
  'workflow.instance.rejected': { permission: 'workflow:instance:list', summarySchema: workflowInstanceSummary },
  'workflow.instance.withdrawn': { permission: 'workflow:instance:list', summarySchema: workflowInstanceSummary },
  'workflow.instance.returned': { permission: 'workflow:instance:list', summarySchema: workflowInstanceSummary },
  'workflow.task.changed': {
    permission: 'workflow:task:handle',
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
} as const satisfies Record<string, { permission: Permission; summarySchema: z.ZodType<Record<string, unknown>> }>;

export type DomainEventType = keyof typeof DOMAIN_EVENT_CATALOG;
export type DomainEventPayload<K extends DomainEventType> = z.input<(typeof DOMAIN_EVENT_CATALOG)[K]['summarySchema']>;

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
