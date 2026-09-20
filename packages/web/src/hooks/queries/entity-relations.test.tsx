import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { entityRelationsContract, entityTimelineContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { contractKey, urlOf } from '@/lib/contract-query';

const recorder = new ApiRecorder();
const auth = vi.hoisted(() => ({
  user: { id: 1, tenantId: null as number | null, viewingTenantId: null as number | null },
  impersonation: null as { impersonationId: number } | null,
}));
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

import { invalidateEntityRelations, useEntityRelations, useEntityRelationSection, useEntityTimeline, useLinkEntity } from './entity-relations';

const params = { type: 'payment.order' as const, key: '1' };
const sectionParams = { ...params, sectionKey: 'payment.order.refunds' };
const describeUrl = urlOf(entityRelationsContract.describe, { params });
const sectionUrl = urlOf(entityRelationsContract.section, { params: sectionParams, query: { limit: 1 } });
const timelineUrl = urlOf(entityTimelineContract.timeline, { params, query: { limit: 20 } });
const item = (key: string) => ({ ref: { type: 'payment.refund', key }, relationKey: sectionParams.sectionKey, title: key, capabilities: { view: true, open: true } });

beforeEach(() => {
  recorder.reset();
  auth.user = { id: 1, tenantId: null, viewingTenantId: null };
  auth.impersonation = null;
});

describe('entity relations cursor and identity isolation', () => {
  it('waits for group activation and sends the server cursor for the next page', async () => {
    recorder.on('GET', sectionUrl.split('?')[0], ({ url }: { url: string }) => new URL(url, 'https://test.local').searchParams.has('cursor')
      ? { items: [item('second')], nextCursor: null, hasMore: false }
      : { items: [item('first')], nextCursor: 'opaque+/cursor', hasMore: true });
    const { result, rerender } = renderHook(({ enabled }) => useEntityRelationSection(params.type, params.key, sectionParams.sectionKey, enabled, 1), {
      wrapper: createWrapper(createTestQueryClient()), initialProps: { enabled: false },
    });
    expect(recorder.calls).toHaveLength(0);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data?.pages[0].items[0]?.title).toBe('first'));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data?.pages.flatMap((page) => page.items.map((row) => row.title))).toEqual(['first', 'second']));
    expect(new URL(recorder.calls[1].url, 'https://test.local').searchParams.get('cursor')).toBe('opaque+/cursor');
    expect(result.current.hasNextPage).toBe(false);
  });

  it('never reuses a previous user, tenant view, or impersonation result', async () => {
    recorder.on('GET', describeUrl, () => ({ anchor: { ref: params, title: JSON.stringify(auth) }, sections: [], canManageLinks: false }));
    const { result, rerender } = renderHook(() => useEntityRelations(params.type, params.key), { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const transition of [
      () => { auth.user = { ...auth.user, id: 2 }; },
      () => { auth.user = { ...auth.user, tenantId: 4 }; },
      () => { auth.user = { ...auth.user, viewingTenantId: 6 }; },
      () => { auth.impersonation = { impersonationId: 8 }; },
    ]) {
      const previous = result.current.data;
      transition();
      rerender();
      expect(result.current.data).not.toBe(previous);
      await waitFor(() => expect(result.current.data?.anchor.title).toBe(JSON.stringify(auth)));
    }
    expect(recorder.calls).toHaveLength(5);
  });

  it('keeps relation pages and typed timeline events in distinct caches', async () => {
    recorder.on('GET', sectionUrl.split('?')[0], { items: [item('refund')], nextCursor: null, hasMore: false });
    recorder.on('GET', timelineUrl.split('?')[0], { items: [{ id: 'event', eventType: 'payment.order.created' }], nextCursor: null, hasMore: false });
    const { result } = renderHook(() => ({
      relations: useEntityRelationSection(params.type, params.key, sectionParams.sectionKey, true, 1),
      timeline: useEntityTimeline(params.type, params.key),
    }), { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.relations.isSuccess && result.current.timeline.isSuccess).toBe(true));
    expect(result.current.relations.data?.pages[0].items[0].ref.key).toBe('refund');
    expect(result.current.timeline.data?.pages[0].items[0].id).toBe('event');
  });

  it('marks both endpoints and inactive reverse views stale after a relation change', async () => {
    const client = createTestQueryClient();
    const left = contractKey(entityRelationsContract.describe, { params });
    const right = contractKey(entityRelationsContract.describe, { params: { type: 'wiki.document', key: '7' } });
    const timeline = contractKey(entityTimelineContract.timeline, { params, query: { limit: 20 } });
    for (const key of [left, right, timeline]) client.setQueryData(key, {});
    client.setQueryData(['unrelated'], {});
    await invalidateEntityRelations(client);
    for (const key of [left, right, timeline]) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
    expect(recorder.calls).toHaveLength(0);
  });

  it('refreshes an open relation group after creating a manual link', async () => {
    let linked = false;
    recorder.on('GET', sectionUrl.split('?')[0], () => ({ items: linked ? [item('new')] : [], nextCursor: null, hasMore: false }));
    recorder.on('POST', urlOf(entityRelationsContract.link, { params }), () => { linked = true; return null; });
    const { result } = renderHook(() => ({
      section: useEntityRelationSection(params.type, params.key, sectionParams.sectionKey, true, 1), link: useLinkEntity(),
    }), { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => expect(result.current.section.isSuccess).toBe(true));
    await act(async () => { await result.current.link.mutateAsync({ params, body: { target: { type: 'wiki.document', key: '7' } } }); });
    await waitFor(() => expect(result.current.section.data?.pages[0].items[0]?.title).toBe('new'));
  });
});
