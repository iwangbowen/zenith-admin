/**
 * cms-ads 域缓存一致性契约
 *
 * 广告位与广告互相引用（广告位列表带 adCount、广告列表带 slotName）。收敛前广告位写操作
 * `invalidateQueries(cmsAdKeys.all)` 连带投放事件明细 / 统计一起打回源；收敛后广告位与广告互相失效，
 * 事件视图只在清理事件时刷新。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  cmsAdEventKeys,
  cmsAdKeys,
  useCmsAdEventList,
  useCmsAdList,
  useCmsAdSlots,
  useSaveCmsAd,
  useSaveCmsAdSlot,
} from './cms-ads';

const SITE_ID = 1;
const AD_PARAMS = { page: 1, pageSize: 10, siteId: SITE_ID };
const EVENT_PARAMS = { page: 1, pageSize: 10, siteId: SITE_ID };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/ads/slots', [{ id: 4, siteId: SITE_ID, name: '首页横幅', adCount: 1 }])
    .on('GET', '/api/cms/ads', { ...EMPTY_PAGE, list: [{ id: 6, slotId: 4, slotName: '首页横幅' }], total: 1 })
    .on('GET', '/api/cms/ads/events', EMPTY_PAGE)
    .on('PUT', '/api/cms/ads/slots/4', { id: 4, siteId: SITE_ID, name: '顶部横幅' })
    .on('POST', '/api/cms/ads', { id: 7, slotId: 4, slotName: '首页横幅' });
});

function mountAdsPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      slots: useCmsAdSlots(SITE_ID),
      ads: useCmsAdList(AD_PARAMS),
      events: useCmsAdEventList(EVENT_PARAMS),
      saveSlot: useSaveCmsAdSlot(),
      saveAd: useSaveCmsAd(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountAdsPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.slots.isSuccess).toBe(true);
    expect(hook.result.current.ads.isSuccess).toBe(true);
    expect(hook.result.current.events.isSuccess).toBe(true);
  });
}

describe('广告位 ↔ 广告互相失效，事件视图不受牵连', () => {
  it('renaming a slot refetches slots and the ad list (slotName), not the event list', async () => {
    const { qc, hook } = mountAdsPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.saveSlot.mutateAsync({ id: 4, values: { name: '顶部横幅' } });
    await waitFor(() => {
      expect(hook.result.current.slots.isFetching).toBe(false);
      expect(hook.result.current.ads.isFetching).toBe(false);
    });

    expect(fetches.countOf(cmsAdKeys.slotsAll)).toBe(1);
    expect(fetches.countOf(cmsAdKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsAdEventKeys.lists)).toBe(0);
    expect(isFresh(qc, cmsAdEventKeys.list(EVENT_PARAMS))).toBe(true);
    expect(api.countOf('GET', '/api/cms/ads/events')).toBe(0);

    fetches.stop();
  });

  it('creating an ad refetches the slot list because it renders adCount — the factory alone would miss it', async () => {
    const { qc, hook } = mountAdsPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.saveAd.mutateAsync({ values: { slotId: 4, name: '春季促销' } });
    await waitFor(() => expect(hook.result.current.slots.isFetching).toBe(false));

    expect(fetches.countOf(cmsAdKeys.lists)).toBe(1);
    expect(fetches.countOf(cmsAdKeys.slotsAll)).toBe(1);
    expect(fetches.countOf(cmsAdEventKeys.lists)).toBe(0);

    fetches.stop();
  });
});
