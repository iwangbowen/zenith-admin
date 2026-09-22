import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { entityTimelineContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { urlOf } from '@/lib/contract-query';
import { EntityNavigationContext } from './entity-navigation';
import EntityTimeline from './EntityTimeline';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, tenantId: 7 }, impersonation: null }) }));

describe('business timeline source navigation', () => {
  it('opens the authorized event source through the existing navigation context', async () => {
    const params = { type: 'payment.order' as const, key: '41' };
    const sourceRef = { type: 'payment.refund', key: '7' };
    recorder.reset();
    recorder.on('GET', urlOf(entityTimelineContract.timeline, { params, query: {} }), {
      items: [{ id: 'event:1', eventType: 'refund.succeeded', occurredAt: '2026-09-22T00:00:00Z', sourceRef,
        subjectRefs: [{ ...params, role: 'related' }], visibility: 'restricted', payload: { refundNo: 'REF-7' } }], nextCursor: null, hasMore: false,
    });
    const open = vi.fn();
    const Wrapper = createWrapper(createTestQueryClient());
    render(<Wrapper><MemoryRouter><EntityNavigationContext.Provider value={open}><EntityTimeline entityType={params.type} entityKey={params.key} /></EntityNavigationContext.Provider></MemoryRouter></Wrapper>);
    fireEvent.click(await screen.findByRole('button', { name: '查看退款' }));
    expect(open).toHaveBeenCalledWith(sourceRef);
    expect(document.querySelector('.semi-sidesheet')).toBeNull();
  });
});
