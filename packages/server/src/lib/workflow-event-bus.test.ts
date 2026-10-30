import { describe, expect, it } from 'vitest';
import { workflowEventBus } from './workflow-event-bus';
import type { DbTransaction } from '../db/types';

describe('workflow durable publisher', () => {
  const event = {
    type: 'instance.created' as const, eventId: 'event-41', instanceId: 41, definitionId: 2, tenantId: 7,
    instance: { status: 'pending', formData: { secret: 'must not enter timeline' } }, actor: { userId: 9 },
  };
  it('builds a stable event identity without an in-process listener registry', () => {
    const first = workflowEventBus.build(event);
    const second = workflowEventBus.build({ ...event, eventId: undefined, occurredAt: undefined });
    expect(first.eventId).toBe('event-41'); expect(first.type).toBe('instance.created'); expect(second.eventId).toBeTruthy();
  });
  it('requires a transaction and explicit business tenant for durable publication', async () => {
    await expect(workflowEventBus.emitInTx({ ...event, tenantId: undefined }, {} as DbTransaction)).rejects.toThrow('business tenant');
  });
});
