import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const connection = process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)('durable Webhook preparation and real HTTP', () => {
  let database: typeof import('../../db'); let schema: typeof import('../../db/schema');
  let service: typeof import('./app-webhooks.service'); let server: Server; let siteId = 0; let subId = 0;
  const received: { id: string; body: string }[] = [];
  beforeAll(async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires local zenith_review');
    vi.stubEnv('DATABASE_URL', connection!);
    database = await import('../../db'); schema = await import('../../db/schema'); service = await import('./app-webhooks.service');
    const { config } = await import('../../config'); config.openPlatform.webhookAllowedHosts.push('127.0.0.1');
    server = createServer((request, response) => {
      let body = ''; request.on('data', (chunk) => { body += chunk; }); request.on('end', () => {
        received.push({ id: String(request.headers['x-zenith-event-id']), body }); response.writeHead(204); response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No receiver');
    const [site] = await database.db.insert(schema.cmsSites).values({ code: `outbox-${randomUUID().slice(0, 8)}`, name: 'Outbox integration' }).returning({ id: schema.cmsSites.id }); siteId = site.id;
    const [sub] = await database.db.insert(schema.appWebhookSubscriptions).values({ name: 'Outbox integration', internal: true,
      cmsSiteId: siteId, url: `http://127.0.0.1:${address.port}/events`, signMode: 'none', events: ['cms.content.updated'], tenantId: null,
    }).returning({ id: schema.appWebhookSubscriptions.id }); subId = sub.id;
  }, 120_000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (database) {
      if (subId) await database.db.delete(schema.appWebhookSubscriptions).where(eq(schema.appWebhookSubscriptions.id, subId));
      if (siteId) await database.db.delete(schema.cmsSites).where(eq(schema.cmsSites.id, siteId));
      await database.closeDb();
    }
    vi.unstubAllEnvs();
  });
  const event = () => ({ type: 'cms.content.updated', clientId: null, tenantId: null, scope: { siteId },
    eventId: randomUUID(), occurredAt: '2026-10-29 12:00:00', data: { content: { id: 123, version: 2 } } });
  it('prepares once without HTTP, then sends with stable identity and records its attempt', async () => {
    const input = event(); const before = received.length;
    const ids = await database.db.transaction(async (tx) => {
      const first = await service.prepareAppWebhookDeliveriesWithin(tx, input);
      expect(await service.prepareAppWebhookDeliveriesWithin(tx, input)).toEqual([]);
      expect(received.length).toBe(before); return first;
    });
    expect(ids).toHaveLength(1); expect(await service.dispatchDelivery(ids[0], null)).toBe(true);
    expect(received.at(-1)?.id).toBe(input.eventId); expect(JSON.parse(received.at(-1)!.body)).not.toHaveProperty('tenantId');
    const attempts = await database.db.select().from(schema.appWebhookAttempts).where(eq(schema.appWebhookAttempts.deliveryId, ids[0]));
    expect(attempts.map((row) => row.status)).toEqual(['succeeded']);
  });
  it('rolls back downstream work when receipt confirmation fails', async () => {
    const input = event();
    await expect(database.db.transaction(async (tx) => { await service.prepareAppWebhookDeliveriesWithin(tx, input); throw new Error('receipt failure'); })).rejects.toThrow('receipt failure');
    expect(await database.db.$count(schema.appWebhookDeliveries, eq(schema.appWebhookDeliveries.eventId, input.eventId))).toBe(0);
  });
  it('suppresses an already prepared request after subscription disablement', async () => {
    const [id] = await database.db.transaction((tx) => service.prepareAppWebhookDeliveriesWithin(tx, event())); const before = received.length;
    await database.db.update(schema.appWebhookSubscriptions).set({ status: 'disabled' }).where(eq(schema.appWebhookSubscriptions.id, subId));
    expect(await service.dispatchDelivery(id, null)).toBe(true); expect(received.length).toBe(before);
  });
});
