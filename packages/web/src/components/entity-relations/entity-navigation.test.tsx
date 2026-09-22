import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { entityRelationsContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { urlOf } from '@/lib/contract-query';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { useListSearch } from '@/hooks/useListSearch';
import { PreferencesContext } from '@/hooks/usePreferences';
import { createPreferencesContext } from '@/test-utils/preferences';
import EntityContextView from './EntityContextRuntime';
import EntityRelationButton from './EntityRelationButton';
import EntityRelationBackButton from './EntityRelationBackButton';
import {
  beginEntityRelationNavigation, clearEntityRelationNavigation, entityRelationSourceUrl,
  getEntityRelationNavigation, observeEntityRelationLocation, popEntityRelationNavigation,
} from './entity-navigation';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, tenantId: null, viewingTenantId: null }, impersonation: null }) }));

const order = { type: 'payment.order' as const, key: '41' };
const sectionKey = 'payment.order.refunds';
const audit = { type: 'platform.operation-log' as const, key: '90' };

beforeEach(() => {
  clearEntityRelationNavigation();
  recorder.reset();
  recorder.on('GET', urlOf(entityRelationsContract.describe, { params: order }), {
    anchor: { ref: order, title: '来源订单 PAY-41' }, canManageLinks: false,
    sections: [{ key: sectionKey, labelKey: 'relation.payment.order.refunds', targetTypes: ['payment.refund'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'has-data' }],
  });
  recorder.on('GET', urlOf(entityRelationsContract.section, { params: { ...order, sectionKey }, query: {} }), {
    items: [{ ref: { type: 'payment.refund', key: '7' }, relationKey: sectionKey, title: '关联退款 REF-7', capabilities: { view: true, open: true } }],
    nextCursor: null, hasMore: false,
  });
  recorder.on('GET', urlOf(entityRelationsContract.describe, { params: audit }), {
    anchor: { ref: audit, title: '来源审计记录' }, canManageLinks: false,
    sections: [{ key: 'audit.subjects', labelKey: 'relation.common.subjects', targetTypes: ['payment.refund'], kind: 'activity', cardinality: 'many', capabilities: { view: true, open: true }, summaryState: 'has-data' }],
  });
  recorder.on('GET', urlOf(entityRelationsContract.section, { params: { ...audit, sectionKey: 'audit.subjects' }, query: {} }), {
    items: [{ ref: { type: 'payment.refund', key: '7' }, relationKey: 'audit.subjects', title: '关联退款 REF-7', capabilities: { view: true, open: true } }],
    nextCursor: null, hasMore: false,
  });
});

function SourceDetail() {
  const [id, setId] = useState<string>();
  const search = useListSearch({ listKey: ['orders', 'list'], defaults: { keyword: '' }, refetchOnSearch: false });
  useListDeepLink(['orderId'], (params) => setId(params.orderId));
  return <><input aria-label="订单筛选" value={search.draftParams.keyword} onChange={(event) => search.setField('keyword')(event.target.value)} />
    <button onClick={search.handleSearch}>提交筛选</button><button onClick={() => search.setPage(3)}>第三页</button>
    <output data-testid="filters">{search.submittedParams.keyword}:{search.page}</output>
    <div data-testid="detail-scroll"><EntityContextView entityType="payment.order" entityKey={id} showAnchor /></div></>;
}

function TargetDetail() {
  const [id, setId] = useState<string>();
  useListDeepLink(['refundId'], (params) => setId(params.refundId));
  return <p>退款详情 {id}</p>;
}

function NavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}{location.hash}</output>
    <button onClick={() => navigate(-1)}>浏览器后退</button>
    {location.pathname === '/payment/orders' ? <SourceDetail />
      : location.pathname === '/system/operation-logs' ? <EntityRelationButton entityRef={audit} /> : <TargetDetail />}
    <EntityRelationBackButton />
  </>;
}

function renderNavigation(path: string) {
  const Wrapper = createWrapper(createTestQueryClient());
  return render(<Wrapper><PreferencesContext.Provider value={createPreferencesContext({ rememberListFilters: false })}>
    <MemoryRouter initialEntries={[path]}><NavigationHarness /></MemoryRouter>
  </PreferencesContext.Provider></Wrapper>);
}

describe('relation navigation continuity', () => {
  it('restores the exact source and expanded group after both source and target consume detail queries', async () => {
    renderNavigation('/payment/orders?orderId=41&view=compact#context');
    await screen.findByText('来源订单 PAY-41');
    expect(screen.getByTestId('location')).toHaveTextContent('/payment/orders?view=compact#context');
    fireEvent.change(screen.getByLabelText('订单筛选'), { target: { value: '已提交的筛选' } });
    fireEvent.click(screen.getByRole('button', { name: '提交筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '第三页' }));
    fireEvent.change(screen.getByLabelText('订单筛选'), { target: { value: '未提交的草稿' } });
    fireEvent.click(screen.getByText('退款记录'));
    const scroll = screen.getByTestId('detail-scroll');
    scroll.scrollTop = 175;
    fireEvent.click(await screen.findByRole('button', { name: '关联退款 REF-7' }));
    await screen.findByText('退款详情 7');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/payment/refunds'));
    expect(screen.getAllByRole('button', { name: '返回上一个关联对象' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '返回上一个关联对象' }));
    expect(await screen.findByText('来源订单 PAY-41')).toBeVisible();
    expect(await screen.findByRole('button', { name: '关联退款 REF-7' })).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('detail-scroll').scrollTop).toBe(175));
    expect(screen.getByTestId('location')).toHaveTextContent('/payment/orders?view=compact#context');
    expect(screen.getByTestId('filters')).toHaveTextContent('已提交的筛选:3');
    expect(screen.getByLabelText('订单筛选')).toHaveValue('未提交的草稿');
  });

  it('reopens a source relation sheet with its expanded group after returning from full detail', async () => {
    renderNavigation('/system/operation-logs?view=compact');
    fireEvent.click(screen.getByRole('button', { name: '关联信息' }));
    await screen.findByText('来源审计记录');
    fireEvent.click(screen.getByText('来源业务对象'));
    fireEvent.click(await screen.findByRole('button', { name: '关联退款 REF-7' }));
    await screen.findByText('退款详情 7');
    fireEvent.click(screen.getByRole('button', { name: '返回上一个关联对象' }));
    expect(await screen.findByText('来源审计记录')).toBeVisible();
    expect(await screen.findByRole('button', { name: '关联退款 REF-7' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/system/operation-logs?view=compact');
  });

  it('restores a consumed source detail when the browser navigates back', async () => {
    renderNavigation('/payment/orders?orderId=41&view=compact');
    await screen.findByText('来源订单 PAY-41');
    fireEvent.click(screen.getByText('退款记录'));
    fireEvent.click(await screen.findByRole('button', { name: '关联退款 REF-7' }));
    await screen.findByText('退款详情 7');
    fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }));
    expect(await screen.findByText('来源订单 PAY-41')).toBeVisible();
    expect(await screen.findByRole('button', { name: '关联退款 REF-7' })).toBeVisible();
  });

  it('reconstructs required detail tabs while retaining unrelated query values and hashes', () => {
    expect(entityRelationSourceUrl({ pathname: '/payment/risk-rules', search: '?view=compact', hash: '#review' }, '/payment/risk-rules?tab=reviews&reviewId=42'))
      .toBe('/payment/risk-rules?view=compact&tab=reviews&reviewId=42#review');
  });

  it('keeps multiple source frames across query cleanup and discards the trail on access or unrelated page changes', () => {
    beginEntityRelationNavigation({ url: '/payment/orders?orderId=41', locationKey: 'source', kind: 'detail', ref: order, pageScrollTop: 100 }, '/payment/refunds?refundId=7', 'user:1', '/payment/orders');
    observeEntityRelationLocation('/payment/refunds', 'user:1');
    observeEntityRelationLocation('/payment/refunds', 'user:1');
    beginEntityRelationNavigation({ url: '/payment/refunds?refundId=7', locationKey: 'refund', kind: 'detail', ref: { type: 'payment.refund', key: '7' }, pageScrollTop: 20 }, '/payment/orders?orderId=9', 'user:1', '/payment/refunds');
    expect(getEntityRelationNavigation()?.stack).toHaveLength(2);
    expect(popEntityRelationNavigation()?.url).toBe('/payment/refunds?refundId=7');
    expect(popEntityRelationNavigation()?.url).toBe('/payment/orders?orderId=41');
    observeEntityRelationLocation('/payment/orders', 'user:2');
    expect(getEntityRelationNavigation()).toBeNull();
    beginEntityRelationNavigation({ url: '/payment/orders', locationKey: 'source', kind: 'page', pageScrollTop: 0 }, '/payment/refunds?refundId=7', 'user:1', '/payment/orders');
    observeEntityRelationLocation('/payment/refunds', 'user:1');
    observeEntityRelationLocation('/system/users', 'user:1');
    expect(getEntityRelationNavigation()).toBeNull();
  });
});
