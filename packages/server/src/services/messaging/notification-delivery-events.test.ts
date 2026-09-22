import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import type { NotificationOutboxRow } from '../../db/schema';

const record = vi.hoisted(() => vi.fn());
vi.mock('../platform/relations/events.service', () => ({ recordDomainEvent: record }));
import { recordNotificationOutcome } from './notification-delivery-events';

beforeEach(() => vi.clearAllMocks());
describe('notification terminal business events', () => {
  it('records partial channel failure accurately without recipient or provider data', async () => {
    const subjects = [{ type: 'payment.order', key: '7', role: 'related' }];
    const tx = { select: () => ({ from: () => ({ where: async () => subjects }) }) } as unknown as DbTransaction;
    const row = { id: 3, tenantId: 9, eventKey: 'payment.order_paid', attempts: 1, claimedAt: new Date('2026-09-22T00:00:00Z'),
      traceId: null, parentRef: null, recipients: [{ address: 'private@example.com' }], vars: { secret: 'private' } } as unknown as NotificationOutboxRow;
    await recordNotificationOutcome(tx, row, 'done', { sent: 1, failed: 1, deferred: 2, suppressed: 3 });
    expect(record).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'messaging.notification.dispatched', tenantId: 9, subjects,
      payload: { eventKey: 'payment.order_paid', status: 'done', sent: 1, failed: 1, deferred: 2, suppressed: 3 } }));
    expect(JSON.stringify(record.mock.calls[0][1])).not.toContain('private');
  });
});
