import type { WorkflowEvent, WorkflowEventType, WorkflowInstanceEventPayload, WorkflowNodeEventPayload, WorkflowTaskEventPayload } from '@zenith/shared/workflow';
import { isPlainObject } from '@zenith/shared/core';
import type { DbTransaction } from '../db/types';
import type { OutboxEventRow } from '../db/schema/event-outbox';
import { registerEventConsumer, PermanentEventError, type ConsumerResult } from './domain-events';
import { formatDateTime } from './datetime';

type EventFor<T extends WorkflowEventType> = T extends `instance.${string}` ? WorkflowInstanceEventPayload : T extends `node.${string}` ? WorkflowNodeEventPayload : WorkflowTaskEventPayload;
type Handler<T extends WorkflowEventType> = (tx: DbTransaction, event: EventFor<T>, fact: OutboxEventRow) => Promise<ConsumerResult | void>;
type AnyHandler = (tx: DbTransaction, event: WorkflowEvent, fact: OutboxEventRow) => Promise<ConsumerResult | void>;
const registrations = new Map<string, Map<WorkflowEventType, AnyHandler>>();
/** A logical consumer shares ordering across its event types; handlers only prepare local effects. */
export function registerWorkflowEventConsumer<T extends WorkflowEventType>(key: string, types: readonly T[], handle: Handler<T>,
  options: { bizType?: string; lane?: 'business' | 'analytics'; after?: readonly string[] } = {}): void {
  const existing = registrations.get(key);
  const handlers = existing ?? new Map<WorkflowEventType, AnyHandler>();
  for (const type of types) handlers.set(type, handle as unknown as AnyHandler);
  if (existing) return;
  registrations.set(key, handlers);
  registerEventConsumer({ key, lane: options.lane, after: options.after,
    matches: (event) => event.domain === 'workflow' && [...handlers.keys()].some((type) => event.eventType === `workflow.${type}`)
      && (!options.bizType || (isPlainObject(event.payload.instance) && event.payload.instance.bizType === options.bizType)),
    handle: async (tx, fact) => {
      const type = fact.payload.type as WorkflowEventType;
      const handler = handlers.get(type);
      if (fact.schemaVersion !== 1 || typeof fact.payload.instanceId !== 'number' || !handler || fact.eventType !== `workflow.${type}`) {
        throw new PermanentEventError('Invalid workflow event snapshot');
      }
      const event = { ...fact.payload, eventId: fact.eventId, occurredAt: formatDateTime(fact.occurredAt) } as WorkflowEvent;
      return await handler(tx, event, fact) ?? { outcome: 'completed' };
    },
  });
}
export function getWorkflowEventConsumerIntrospection() {
  const counts = new Map<WorkflowEventType, number>();
  for (const handlers of registrations.values()) for (const type of handlers.keys()) counts.set(type, (counts.get(type) ?? 0) + 1);
  return { totalListenerCount: registrations.size, listeners: [...counts].map(([eventType, listenerCount]) => ({ eventType, listenerCount })) };
}
