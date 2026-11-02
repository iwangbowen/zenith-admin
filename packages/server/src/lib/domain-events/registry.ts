import type { DbTransaction } from '../../db/types';
import type { ConsumerDeliveryRow, OutboxEventRow } from '../../db/schema/event-outbox';

export interface ConsumerResult { outcome: 'completed' | 'handed_off' | 'skipped'; reason?: string; refs?: Record<string, unknown> }
export interface EventConsumer {
  key: string;
  matches: (event: Pick<OutboxEventRow, 'eventType' | 'domain' | 'payload'>) => boolean;
  after?: readonly string[];
  lane?: 'business' | 'analytics';
  handle: (tx: DbTransaction, event: OutboxEventRow, delivery: ConsumerDeliveryRow) => Promise<ConsumerResult>;
}

const consumers = new Map<string, EventConsumer>();
let sealed = false;
export function registerEventConsumer(consumer: EventConsumer): void {
  if (sealed) throw new Error(`Event consumer registry is already sealed: ${consumer.key}`);
  if (consumers.has(consumer.key)) throw new Error(`Duplicate event consumer: ${consumer.key}`);
  consumers.set(consumer.key, consumer);
}
/** Seal after bootstrap so every published fact sees the complete, immutable consumer catalog. */
export function sealEventConsumerRegistry(): void {
  if (consumers.size === 0) throw new Error('Cannot seal an empty event consumer registry');
  sealed = true;
}
export function assertEventConsumerRegistrySealed(): void {
  if (!sealed) throw new Error('Event consumer registry must be sealed before publication');
}
/** Test isolation only; production bootstrap seals once for the process lifetime. */
export function __resetEventConsumerRegistryForTest(): void {
  consumers.clear();
  sealed = false;
}
export function getEventConsumer(key: string): EventConsumer {
  const consumer = consumers.get(key);
  if (!consumer) throw new Error(`Event consumer is not registered: ${key}`);
  return consumer;
}
export function matchingEventConsumers(event: Pick<OutboxEventRow, 'eventType' | 'domain' | 'payload'>): EventConsumer[] {
  assertEventConsumerRegistrySealed();
  const matches = [...consumers.values()].filter((consumer) => consumer.matches(event));
  const keys = new Set(matches.map((consumer) => consumer.key));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error(`Cyclic event consumer dependency: ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of getEventConsumer(key).after ?? []) {
      if (!keys.has(dependency)) throw new Error(`Missing event consumer dependency: ${key} -> ${dependency}`);
      visit(dependency);
    }
    visiting.delete(key); visited.add(key);
  };
  for (const key of keys) visit(key);
  return matches;
}

export class PermanentEventError extends Error {}
export class EventLeaseLostError extends Error {
  constructor() { super('Event consumer lease is no longer owned'); }
}
