import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { entityRelationsContract, globalSearchContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { urlOf } from '@/lib/contract-query';
import EntityContextView from './EntityContextRuntime';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, tenantId: null, viewingTenantId: null }, impersonation: null }) }));

const params = { type: 'payment.order' as const, key: '1' };
const sectionKey = 'payment.order.refunds';
const sectionUrl = urlOf(entityRelationsContract.section, { params: { ...params, sectionKey }, query: { limit: 5 } });

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', urlOf(entityRelationsContract.describe, { params }), {
    anchor: { ref: params, title: '支付订单 PAY-1' }, canManageLinks: true,
    sections: [{ key: sectionKey, labelKey: 'relation.payment.order.refunds', targetTypes: ['payment.refund'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } }],
  });
  recorder.on('GET', sectionUrl.split('?')[0], {
    items: [{ ref: { type: 'payment.refund', key: '3' }, relationKey: sectionKey, title: 'REF-3', subtitle: '部分退款', status: 'pending', capabilities: { view: true, open: false } }],
    nextCursor: null, hasMore: false, total: 1,
  });
  recorder.on('GET', globalSearchContract.search.fullPath, {
    results: [{ type: 'wiki-document', id: '8', title: '关联测试文档', subtitle: '售后处理说明', highlights: [], route: '/wiki/docs?docId=8', actions: { view: true, download: false } }],
    partial: false, failedTypes: [],
  });
  recorder.on('POST', urlOf(entityRelationsContract.link, { params }), null);
});

function renderView() {
  const Wrapper = createWrapper(createTestQueryClient());
  // Semi List, Collapse, Tabs and Modal are deliberately real so API misuse fails at render time.
  return render(<Wrapper><MemoryRouter><EntityContextView entityType={params.type} entityKey={params.key} showAnchor /></MemoryRouter></Wrapper>);
}

describe('EntityContextView with actual Semi components', () => {
  it('renders an authorized group and keeps it expanded when refreshing', async () => {
    renderView();
    await screen.findByText('支付订单 PAY-1');
    expect(recorder.countOf('GET', sectionUrl.split('?')[0])).toBe(0);
    fireEvent.click(screen.getByText('退款记录'));
    expect(await screen.findByText('REF-3')).toBeVisible();
    expect(screen.getByText('部分退款')).toBeVisible();
    expect(screen.getByText('待处理')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'REF-3' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(recorder.countOf('GET', sectionUrl.split('?')[0])).toBe(2));
    expect(screen.getByText('REF-3')).toBeVisible();
  });

  it('renders search rows in the link dialog and submits the selected exact reference', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: '添加关联' }));
    fireEvent.change(await screen.findByPlaceholderText('搜索用户、订单、流程、内容或设备'), { target: { value: '关联测试' } });
    expect(await screen.findByText('关联测试文档')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
    await waitFor(() => expect(recorder.calls.find((call) => call.method === 'POST')?.body).toEqual({ target: { type: 'wiki.document', key: '8' } }));
  });
});
