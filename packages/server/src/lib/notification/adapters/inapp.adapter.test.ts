import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNotificationEvent } from '@zenith/shared/messaging';
import type { DeliveryContext } from '../types';

const mocks = vi.hoisted(() => ({ values: vi.fn(), push: vi.fn(), rows: [{ id: 9, createdAt: new Date('2026-11-18T07:00:00Z') }] as object[] }));
vi.mock('../../../db', () => ({ db: { insert: () => ({ values: (value: object) => { mocks.values(value); return { onConflictDoNothing: () => ({ returning: async () => mocks.rows }) }; } }) } }));
vi.mock('../../ws-manager', () => ({ scheduleSendToUsers: mocks.push }));
import { inAppAdapter } from './inapp.adapter';

beforeEach(() => { vi.clearAllMocks(); mocks.rows = [{ id: 9, createdAt: new Date('2026-11-18T07:00:00Z') }]; });
describe('in-app delivery event identity', () => {
  it.each(['workflow.task.created', 'ops.monitor.alert'] as const)('persists and pushes the exact %s event key regardless of content or link', async eventKey => {
    const ctx: DeliveryContext = { eventKey, event: getNotificationEvent(eventKey), target: { recipient: { type: 'user', id: 7 }, subjectId: 7, address: '7' }, title: '相同标题', content: '相同内容', vars: {}, link: '/business/custom-page', tenantId: 23, dedupeKey: 'test:7', channelLocked: false, options: null };
    await inAppAdapter.send(ctx);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ eventKey, userId: 7, tenantId: 23 }));
    expect(mocks.push).toHaveBeenCalledWith([{ userId: 7 }], expect.objectContaining({ payload: expect.objectContaining({ eventKey }) }));
    mocks.rows = [];
    await inAppAdapter.send(ctx);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});
