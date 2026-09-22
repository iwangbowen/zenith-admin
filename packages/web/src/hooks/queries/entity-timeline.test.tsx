import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { entityTimelineContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { urlOf } from '@/lib/contract-query';
import { useEntityTimeline, type EntityTimelineFilters } from './entity-timeline';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, tenantId: 7 }, impersonation: null }) }));
beforeEach(() => recorder.reset());

describe('timeline query filter scope', () => {
  it('changes the whole query scope and starts pagination anew for a new filter', async () => {
    const params = { type: 'payment.order' as const, key: '41' };
    const path = urlOf(entityTimelineContract.timeline, { params, query: {} });
    recorder.on('GET', path, ({ url }: { url: string }) => {
      const query = new URL(url, 'https://test.local').searchParams;
      return { items: [{ id: query.get('eventType') ?? 'all' }], nextCursor: query.has('cursor') ? null : 'next-page', hasMore: !query.has('cursor') };
    });
    const hook = renderHook(({ filters }) => useEntityTimeline(params.type, params.key, true, 20, filters), {
      wrapper: createWrapper(createTestQueryClient()), initialProps: { filters: {} as EntityTimelineFilters },
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    await act(async () => { await hook.result.current.fetchNextPage(); });
    expect(hook.result.current.data?.pages).toHaveLength(2);
    hook.rerender({ filters: { eventType: 'refund.failed', startTime: '2026-09-22', endTime: '2026-09-22' } });
    await waitFor(() => expect(hook.result.current.data?.pages[0].items[0].id).toBe('refund.failed'));
    expect(hook.result.current.data?.pages).toHaveLength(1);
    const latest = new URL(recorder.calls.at(-1)!.url, 'https://test.local').searchParams;
    expect(latest.get('cursor')).toBeNull();
    expect(latest.get('startTime')).toBe('2026-09-22');
    expect(latest.get('endTime')).toBe('2026-09-22');
    hook.unmount();
  });
});
