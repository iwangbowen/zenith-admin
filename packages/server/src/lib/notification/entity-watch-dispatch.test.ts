import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationOutboxRow } from '../../db/schema';
const mocks = vi.hoisted(() => ({ send: vi.fn(), address: vi.fn(), guard: vi.fn(), insert: vi.fn() }));
vi.mock('../../db', () => ({ db: {
  select: () => ({ from: () => ({ where: async () => [] }) }),
  insert: () => ({ values: (value: unknown) => { mocks.insert(value); return { onConflictDoNothing: async () => undefined }; } }),
} }));
vi.mock('./registry', () => ({ getNotificationAdapter: () => ({ resolveAddress: mocks.address, send: mocks.send }) }));
vi.mock('./resolver', () => ({ resolveDispatchPlan: async () => [{ recipient: { type: 'user', id: 1 }, channels: [{ channel: 'email', allowed: true, reasonCode: null, deferUntil: null }] }] }));
vi.mock('../../services/platform/entity-watch-delivery-guard', () => ({ authorizeEntityWatchDelivery: mocks.guard }));
import { deliverOutboxRow } from './dispatch';

const row = { id: 5, eventKey: 'platform.entity.changed', recipients: [{ type: 'user', id: 1 }],
  vars: { watchId: 7, eventId: 11, objectTitle: 'PRIVATE OLD OBJECT', eventLabel: 'OLD EVENT' },
  link: '/private-old', channelOptions: { email: { html: 'PRIVATE OLD HTML', subject: 'PRIVATE OLD TITLE' } }, channelPolicy: null,
  tenantId: 9, dedupeKey: 'watch:11:1', scheduledAt: null } as unknown as NotificationOutboxRow;

beforeEach(() => { vi.clearAllMocks(); mocks.address.mockResolvedValue('reader@example.com'); mocks.send.mockResolvedValue({}); });
describe('guarded object-watch delivery', () => {
  it('rebuilds every channel field when another authorized watch replaces the original one', async () => {
    mocks.guard.mockResolvedValue({ vars: { watchId: 8, eventId: 11, objectTitle: 'Allowed object', eventLabel: '当前事件' }, link: '/payment/orders?orderId=8' });
    expect(await deliverOutboxRow(row)).toMatchObject({ sent: 1, failed: 0 });
    expect(mocks.address).toHaveBeenCalledWith({ type: 'user', id: 1 }, null);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Allowed object · 当前事件', content: '你关注的对象发生了业务变化：当前事件。',
      vars: { watchId: '8', eventId: '11', objectTitle: 'Allowed object', eventLabel: '当前事件' },
      link: '/payment/orders?orderId=8', options: null,
    }));
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain('PRIVATE');
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain('OLD');
  });
  it('suppresses a delayed row after its final matching watch is cancelled', async () => {
    mocks.guard.mockResolvedValue(null);
    expect(await deliverOutboxRow({ ...row, scheduledAt: new Date() })).toMatchObject({ sent: 0, suppressed: 1 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith([expect.objectContaining({ decision: 'suppressed', reasonCode: 'source_unavailable' })]);
  });
  it('propagates guard infrastructure errors for outbox retry instead of treating them as revocation', async () => {
    mocks.guard.mockRejectedValue(new Error('authorization database offline'));
    await expect(deliverOutboxRow(row)).rejects.toThrow('authorization database offline');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
