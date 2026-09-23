import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
const mocks = vi.hoisted(() => ({ persist: vi.fn(), register: vi.fn(), emit: vi.fn() }));
vi.mock('../../lib/task-center', () => ({ persistAsyncTask: mocks.persist, mapAsyncTask: (value: unknown) => value, enqueueAsyncTask: vi.fn(), registerTaskHandler: mocks.register }));
vi.mock('../../lib/context', () => ({ runWithCurrentUser: (_actor: unknown, fn: () => unknown) => fn() }));
vi.mock('../../lib/open-event-bus', () => ({ openEventBus: { emitAndWait: mocks.emit } }));
import { insertCmsContentWebhookOutbox, registerCmsWebhookTaskHandler } from './cms-webhook.service';

describe('CMS durable event snapshots', () => {
  beforeEach(() => vi.clearAllMocks());
  it('delivers a deletion after the content row is gone and preserves identity on replay', async () => {
    let payload: Record<string, unknown> = {};
    mocks.persist.mockImplementation(async (_executor, input) => { payload = input.payload; return { id: 99, payload }; });
    const executor = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ code: 'main', name: 'Main' }] }) }) }) } as unknown as DbTransaction;
    await insertCmsContentWebhookOutbox(executor, 'cms.content.deleted', { id: 4, siteId: 2, version: 7, title: 'Deleted title', status: 'offline' });
    registerCmsWebhookTaskHandler();
    const handler = mocks.register.mock.calls[0][0];
    await handler.run({ payload });
    await handler.run({ payload });
    expect(mocks.emit).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'cms.content.deleted', eventId: expect.any(String), data: expect.objectContaining({ content: expect.objectContaining({ id: 4, version: 7, title: 'Deleted title' }) }) }));
    expect(mocks.emit.mock.calls[0][0]).toEqual(mocks.emit.mock.calls[1][0]);
  });
  it('does not silently commit a content change when durable event insertion fails', async () => {
    mocks.persist.mockRejectedValueOnce(new Error('outbox unavailable'));
    const executor = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as unknown as DbTransaction;
    await expect(insertCmsContentWebhookOutbox(executor, 'cms.content.updated', { id: 4, siteId: 2, version: 8 })).rejects.toThrow('outbox unavailable');
  });
});
