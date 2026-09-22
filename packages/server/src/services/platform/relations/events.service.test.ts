import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../../db/types';
import { domainEventSubjects, domainEvents, entityWatchEvents } from '../../../db/schema';
import { recordDomainEvent } from './events.service';

vi.mock('../../../lib/context', () => ({ currentUserOrNull: () => ({ userId: 1, tenantId: null }) }));

function transaction(subjectError?: Error) {
  const pending: Array<{ table: unknown; values: unknown }> = [];
  const tx = {
    insert: vi.fn((table: unknown) => ({ values: (values: unknown) => {
      if (table === domainEventSubjects) {
        if (subjectError) return Promise.reject(subjectError);
        pending.push({ table, values });
        return Promise.resolve();
      }
      pending.push({ table, values });
      return { onConflictDoNothing: () => ({ returning: async () => [{ id: 41 }] }) };
    } })),
  } as unknown as DbTransaction;
  return { tx, pending };
}

const input = {
  eventType: 'payment.succeeded' as const,
  payload: { orderNo: 'PO-41', amount: 100, currency: 'CNY', secret: 'must never persist' },
  tenantId: 7,
  source: { type: 'payment.order', key: '41' },
  subjects: [{ type: 'payment.order', key: '41', role: 'primary' as const }],
};

describe('domain event write boundary', () => {
  it('uses the authorized business tenant and an allowlisted summary', async () => {
    const f = transaction();
    await expect(recordDomainEvent(f.tx, input)).resolves.toBe(41);
    expect(f.pending).toEqual([
      { table: domainEvents, values: expect.objectContaining({ tenantId: 7, payload: { orderNo: 'PO-41', amount: 100, currency: 'CNY' } }) },
      { table: domainEventSubjects, values: [{ eventId: 41, tenantId: 7, entityType: 'payment.order', entityKey: '41', role: 'primary' }] },
      { table: entityWatchEvents, values: { eventId: 41 } },
    ]);
  });

  it('does not enqueue notification meta-events and cannot recursively notify watchers', async () => {
    const f = transaction();
    await recordDomainEvent(f.tx, { ...input, eventType: 'messaging.notification.queued', payload: { eventKey: 'platform.entity.changed' } });
    expect(f.pending.some((write) => write.table === entityWatchEvents)).toBe(false);
  });

  it('rejects unknown types, malformed refs and missing tenancy before writing', async () => {
    for (const invalid of [
      { ...input, eventType: 'unknown' },
      { ...input, subjects: [{ type: 'unknown.type', key: '41' }] },
      { ...input, tenantId: undefined },
      { ...input, source: undefined },
    ]) {
      const f = transaction();
      await expect(recordDomainEvent(f.tx, invalid as never)).rejects.toThrow();
      expect(f.tx.insert).not.toHaveBeenCalled();
    }
  });

  it('propagates a child write failure so the surrounding business transaction rolls back', async () => {
    const f = transaction(new Error('subject storage unavailable'));
    const committed: unknown[] = [];
    await expect((async () => {
      await recordDomainEvent(f.tx, input);
      committed.push(...f.pending);
    })()).rejects.toThrow('subject storage unavailable');
    expect(committed).toEqual([]);
  });
});
