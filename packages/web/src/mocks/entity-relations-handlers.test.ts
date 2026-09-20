import { describe, expect, it } from 'vitest';
import type { HttpHandler } from 'msw';
import { entityRelationsContract, entityRelationsResponseSchema, entityRelationPageSchema, entityTimelineContract, entityTimelineResponseSchema } from '@zenith/shared/platform';
import { urlOf } from '@/lib/contract-query';
import { entityRelationsHandlers, entityTimelineHandlers } from './handlers/entity-relations';
import { mockPaymentRefunds } from './data/payment';
import { mockAccessToken } from './utils/auth';

async function call(path: string, { method = 'GET', body, token = mockAccessToken('admin') }: { method?: string; body?: unknown; token?: string | null } = {}) {
  const request = new Request(`${window.location.origin}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const handler of [...entityRelationsHandlers, ...entityTimelineHandlers]) {
    const result = await (handler as HttpHandler).run({ request, requestId: 'entity-relations-test' });
    if (result?.response) return result.response;
  }
  throw new Error('No handler matched');
}

describe('Demo entity relations follow the real domain data', () => {
  const params = { type: 'payment.order' as const, key: '1' };
  it('resolves an actual anchor and returns only refunds whose orderId matches', async () => {
    const description = await (await call(urlOf(entityRelationsContract.describe, { params }))).json();
    expect(entityRelationsResponseSchema.parse(description.data).anchor.title).toBe('PAY1700000000001');
    const response = await (await call(urlOf(entityRelationsContract.section, { params: { ...params, sectionKey: 'payment.order.refunds' }, query: { limit: 50 } }))).json();
    const data = entityRelationPageSchema.parse(response.data);
    expect(data.items.map((row) => row.ref.key)).toEqual(mockPaymentRefunds.filter((row) => row.orderId === 1).map((row) => String(row.id)));
  });

  it('rejects unauthenticated, missing anchors and unrelated groups', async () => {
    expect((await call(urlOf(entityRelationsContract.describe, { params }), { token: null })).status).toBe(401);
    expect((await call(urlOf(entityRelationsContract.describe, { params: { ...params, key: '999999' } }))).status).toBe(404);
    expect((await call(urlOf(entityRelationsContract.section, { params: { ...params, sectionKey: 'iot.device.alarms' }, query: { limit: 5 } }))).status).toBe(404);
    expect((await call(urlOf(entityRelationsContract.describe, { params }), { token: mockAccessToken('admin', 2) })).status).toBe(404);
  });

  it('creates, deduplicates and removes a manual link in both directions', async () => {
    const target = { type: 'wiki.document' as const, key: '1' };
    const linkUrl = urlOf(entityRelationsContract.link, { params });
    const targetPageUrl = urlOf(entityRelationsContract.section, { params: { ...target, sectionKey: 'wiki.document.links' }, query: { limit: 5 } });
    for (let i = 0; i < 2; i++) expect((await call(linkUrl, { method: 'POST', body: { target } })).status).toBe(200);
    const data = entityRelationPageSchema.parse((await (await call(targetPageUrl)).json()).data);
    expect(data.items.filter((row) => row.ref.type === params.type && row.ref.key === params.key)).toHaveLength(1);
    expect((await call(urlOf(entityRelationsContract.unlink, { params: target }), { method: 'DELETE', body: { target: params } })).status).toBe(200);
    expect((await (await call(targetPageUrl)).json()).data.items).toEqual([]);
  });

  it('uses real order timestamps for typed events and cursor pagination', async () => {
    const refundedOrder = { ...params, key: '3' };
    const first = entityTimelineResponseSchema.parse((await (await call(urlOf(entityTimelineContract.timeline, { params: refundedOrder, query: { limit: 1 } }))).json()).data);
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = entityTimelineResponseSchema.parse((await (await call(urlOf(entityTimelineContract.timeline, { params: refundedOrder, query: { limit: 1, cursor: first.nextCursor! } }))).json()).data);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.hasMore).toBe(false);
  });
});
