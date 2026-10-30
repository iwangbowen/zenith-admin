import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../open-platform/open-events.service', () => ({ publishOpenEventInTx: mocks.publish }));
import { insertCmsContentWebhookOutbox } from './cms-webhook.service';

describe('CMS durable event snapshots', () => {
  beforeEach(() => vi.clearAllMocks());
  it('captures deletion metadata and a stable revision key using the source transaction', async () => {
    mocks.publish.mockResolvedValue({ id: 99, eventId: 'stable' });
    const executor = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ code: 'main', name: 'Main' }] }) }) }) } as unknown as DbTransaction;
    await insertCmsContentWebhookOutbox(executor, 'cms.content.deleted', { id: 4, siteId: 2, version: 7, title: 'Deleted title', status: 'offline' });
    expect(mocks.publish).toHaveBeenCalledWith(executor, expect.objectContaining({ type: 'cms.content.deleted', tenantId: null,
      scope: { siteId: 2 }, businessKey: 'cms.content.deleted:4:v7',
      data: expect.objectContaining({ content: expect.objectContaining({ id: 4, version: 7, title: 'Deleted title' }) }),
    }));
  });
  it('does not silently commit a content change when durable event insertion fails', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('outbox unavailable'));
    const executor = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as unknown as DbTransaction;
    await expect(insertCmsContentWebhookOutbox(executor, 'cms.content.updated', { id: 4, siteId: 2, version: 8 })).rejects.toThrow('outbox unavailable');
  });
});
