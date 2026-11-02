/** Durable payment/workflow facts → server-side semantic analytics hints. */
import type { PaymentEvent } from '../../lib/payment-event';
import type { WorkflowEvent } from '@zenith/shared/workflow';
import { WORKFLOW_EVENT_TYPES } from '@zenith/shared/workflow';
import type { DbTransaction } from '../../db/types';
import { registerEventConsumer } from '../../lib/domain-events';
import { formatDateTime } from '../../lib/datetime';
import { rememberTransactionEffect } from '../../lib/transaction-effects';
import { registerWorkflowEventConsumer } from '../../lib/workflow-event-consumer';
import { trackServerEvent } from './analytics-server-events.service';
import logger from '../../lib/logger';

let registered = false;

function mapPaymentProperties(e: PaymentEvent): Record<string, unknown> {
  const properties: Record<string, unknown> = { orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId, channel: e.channel, amount: e.amount };
  if (e.refundNo !== undefined) properties.refundNo = e.refundNo;
  if (e.refundAmount !== undefined) properties.refundAmount = e.refundAmount;
  return properties;
}

function resolveWorkflowUserId(event: WorkflowEvent): number | null {
  if (event.actor?.userId != null) return event.actor.userId;
  if ('instance' in event) return event.instance.initiatorId ?? null;
  if ('task' in event) return event.task.assigneeId ?? null;
  return null;
}

function mapWorkflowProperties(event: WorkflowEvent): Record<string, unknown> {
  if ('instance' in event) return { instanceId: event.instanceId, definitionId: event.definitionId, status: event.instance.status };
  if ('nodeKey' in event) return { instanceId: event.instanceId, nodeKey: event.nodeKey, nodeName: event.nodeName, nodeType: event.nodeType };
  return { instanceId: event.instanceId, taskId: event.task.id, nodeKey: event.task.nodeKey, status: event.task.status };
}

function scheduleAnalytics(tx: DbTransaction, key: string, input: Parameters<typeof trackServerEvent>[0]): void {
  rememberTransactionEffect(tx, key, async () => {
    try { trackServerEvent(input); }
    catch (err) { logger.error('[analytics-server-event-subscribers] handler error', { eventName: input.eventName, err }); }
  });
}

export function registerAnalyticsServerEventSubscribers(): void {
  if (registered) return;
  registered = true;

  registerEventConsumer({ key: 'payment.analytics', lane: 'analytics', after: ['payment.local-settlement'], matches: (event) => event.domain === 'payment',
    handle: async (tx, fact) => {
      const payload = fact.payload as unknown as PaymentEvent;
      const event: PaymentEvent = { ...payload, eventId: fact.eventId, occurredAt: formatDateTime(fact.occurredAt) };
      scheduleAnalytics(tx, `payment-analytics:${fact.eventId}`, { eventName: event.type, eventId: event.eventId, occurredAt: event.occurredAt,
        tenantId: event.tenantId ?? null, userId: event.userId ?? null, properties: mapPaymentProperties(event) });
      return { outcome: 'completed' };
    },
  });

  registerWorkflowEventConsumer('workflow.analytics', WORKFLOW_EVENT_TYPES, async (tx, event) => {
    scheduleAnalytics(tx, `workflow-analytics:${event.eventId}`, { eventName: `workflow.${event.type}`, eventId: event.eventId,
      occurredAt: event.occurredAt, tenantId: event.tenantId ?? null, userId: resolveWorkflowUserId(event),
      displayName: event.actor?.name ?? null, properties: mapWorkflowProperties(event) });
    return { outcome: 'completed' };
  }, { lane: 'analytics' });

  logger.info('[analytics-server-event-subscribers] registered durable payment/workflow analytics consumers');
}

export function __resetAnalyticsServerEventSubscribersForTest(): void { registered = false; }
