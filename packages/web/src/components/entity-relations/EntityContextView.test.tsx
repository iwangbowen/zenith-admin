import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { entityRelationsContract, globalSearchContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { urlOf } from '@/lib/contract-query';
import EntityContextView from './EntityContextRuntime';
import { entityRelationColumn } from './entity-relation-columns';
import { isValidElement } from 'react';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, tenantId: null, viewingTenantId: null }, impersonation: null }) }));

const params = { type: 'payment.order' as const, key: '1' };
const sectionKey = 'payment.order.refunds';
const describeUrl = urlOf(entityRelationsContract.describe, { params });
const sectionUrl = urlOf(entityRelationsContract.section, { params: { ...params, sectionKey }, query: { limit: 5 } });

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', describeUrl, {
    anchor: { ref: params, title: '支付订单 PAY-1' }, canManageLinks: true,
    sections: [{ key: sectionKey, labelKey: 'relation.payment.order.refunds', targetTypes: ['payment.refund'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'has-data' }],
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
  it('opens a dispatch outbox reference rather than the dispatch row ID and hides suppressed rows', async () => {
    const column = entityRelationColumn<{ id: number; outboxId: number | null }>('notification.outbox', (row) => row.outboxId);
    expect(column.render?.(null, { id: 900, outboxId: null }, 0)).toBeNull();
    const cell = column.render?.(null, { id: 900, outboxId: 41 }, 0);
    if (!isValidElement(cell)) throw new Error('Expected an entity entry');
    const outboxRef = { type: 'notification.outbox' as const, key: '41' };
    const outboxUrl = urlOf(entityRelationsContract.describe, { params: outboxRef });
    recorder.on('GET', outboxUrl, { anchor: { ref: outboxRef, title: '通知来源验证' }, sections: [], canManageLinks: false });
    const Wrapper = createWrapper(createTestQueryClient());
    render(<Wrapper><MemoryRouter>{cell}</MemoryRouter></Wrapper>);
    fireEvent.click(screen.getByRole('button', { name: '关联信息' }));
    expect(await screen.findByText('通知来源验证')).toBeVisible();
    expect(recorder.countOf('GET', outboxUrl)).toBe(1);
    expect(recorder.calls.some((call) => call.url.includes('/notification.outbox/900/'))).toBe(false);
  });

  it('opens a journal directly by its primary key', async () => {
    const column = entityRelationColumn<{ id: number }>('payment.journal');
    const cell = column.render?.(null, { id: 83 }, 0);
    if (!isValidElement(cell)) throw new Error('Expected an entity entry');
    const journalRef = { type: 'payment.journal' as const, key: '83' };
    const journalUrl = urlOf(entityRelationsContract.describe, { params: journalRef });
    recorder.on('GET', journalUrl, { anchor: { ref: journalRef, title: '凭证 JRN-83' }, sections: [], canManageLinks: false });
    const Wrapper = createWrapper(createTestQueryClient());
    render(<Wrapper><MemoryRouter>{cell}</MemoryRouter></Wrapper>);
    fireEvent.click(screen.getByRole('button', { name: '关联信息' }));
    expect(await screen.findByText('凭证 JRN-83')).toBeVisible();
    expect(recorder.countOf('GET', journalUrl)).toBe(1);
  });

  it('renders an authorized group and keeps it expanded when refreshing', async () => {
    renderView();
    await screen.findByText('支付订单 PAY-1');
    expect(recorder.countOf('GET', sectionUrl.split('?')[0])).toBe(0);
    expect(screen.getByRole('img', { name: '退款记录：有记录' })).toBeVisible();
    expect(screen.queryByText('共 1 条')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('退款记录'));
    expect(await screen.findByText('REF-3')).toBeVisible();
    expect(screen.getByText('部分退款')).toBeVisible();
    expect(screen.getByText('待处理')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'REF-3' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新退款记录' }));
    await waitFor(() => expect(recorder.countOf('GET', sectionUrl.split('?')[0])).toBe(2));
    expect(screen.getByText('REF-3')).toBeVisible();
  });

  it('renders qualitative attention and empty summaries without exposing counts', async () => {
    recorder.on('GET', describeUrl, {
      anchor: { ref: params, title: '支付订单 PAY-1' }, canManageLinks: false,
      sections: [
        { key: sectionKey, labelKey: 'relation.payment.order.refunds', targetTypes: ['payment.refund'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'attention' },
      ],
    });
    renderView();
    await screen.findByText('支付订单 PAY-1');
    expect(screen.getByRole('img', { name: '退款记录：需处理' })).toBeVisible();
    expect(screen.queryByText(/共 \d+ 条/)).not.toBeInTheDocument();
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
