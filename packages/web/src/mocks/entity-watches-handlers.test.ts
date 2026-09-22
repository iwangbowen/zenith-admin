import { describe, expect, it } from 'vitest';
import type { HttpHandler } from 'msw';
import { entityWatchContract } from '@zenith/shared/platform';
import { urlOf } from '@/lib/contract-query';
import { entityWatchesHandlers } from './handlers/entity-watches';
import { publishMockWatchEvent } from './data/entity-watch-events';
import { mockInAppMessages } from './data/in-app-messages';
import { mockAccessToken } from './utils/auth';

async function call(method: 'GET' | 'POST' | 'DELETE', params: { type: 'payment.order' | 'payment.refund'; key: string }) {
  const operation = method === 'GET' ? entityWatchContract.state : method === 'POST' ? entityWatchContract.follow : entityWatchContract.unfollow;
  const request = new Request(`${window.location.origin}${urlOf(operation, { params })}`, { method, headers: { Authorization: `Bearer ${mockAccessToken('admin')}` } });
  for (const handler of entityWatchesHandlers) {
    const result = await (handler as HttpHandler).run({ request, requestId: 'watch-test' });
    if (result?.response) return result.response;
  }
  throw new Error('No watch handler');
}

describe('Demo object watch lifecycle', () => {
  it('follows once, deduplicates a repeated event and stops after unfollow', async () => {
    const ref = { type: 'payment.order', key: '1' } as const;
    const event = { id: 'qa:watch-event', eventType: 'payment.succeeded', occurredAt: '2026-09-22T00:00:00Z', sourceRef: ref,
      subjectRefs: [{ ...ref, role: 'primary' as const }], visibility: 'restricted' as const, payload: { orderNo: 'QA-1', amount: 10, currency: 'CNY' } };
    await call('POST', ref);
    await call('POST', ref);
    expect((await (await call('GET', ref)).json()).data.watching).toBe(true);
    const before = mockInAppMessages.length;
    publishMockWatchEvent(event);
    publishMockWatchEvent(event);
    expect(mockInAppMessages).toHaveLength(before + 1);
    expect(mockInAppMessages[0].link).toBe('/payment/orders?orderId=1');
    await call('DELETE', ref);
    publishMockWatchEvent({ ...event, id: 'qa:watch-after-cancel' });
    expect(mockInAppMessages).toHaveLength(before + 1);
  });
});
