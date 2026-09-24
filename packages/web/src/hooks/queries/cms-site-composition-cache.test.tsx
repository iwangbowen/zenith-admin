import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cmsSiteContract, cmsWidgetContract, cmsWorkbenchContract } from '@zenith/shared/cms';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { useSaveCmsSite } from './cms-sites';
import { useSaveCmsWidgetSlot } from './cms-widgets';
import { useCmsConfigurationDraft } from './cms-workbench';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));
beforeEach(() => {
  api.reset();
  api.on('GET', cmsWorkbenchContract.configurationDraft.fullPath, { id: 6, siteId: 1, href: '/cms/publishing?site=1&release=6' });
  api.on('PUT', `${cmsSiteContract.basePath}/1`, { id: 1, name: '站点' });
  api.on('PUT', `${cmsWidgetContract.basePath}/slots/home.main`, []);
});
describe('配置保存后刷新待发布提示', () => {
  it('refetches the visible draft after both site settings and theme slot bindings change', async () => {
    const hook = renderHook(() => ({ draft: useCmsConfigurationDraft(1), site: useSaveCmsSite(), slot: useSaveCmsWidgetSlot() }), { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => expect(hook.result.current.draft.isSuccess).toBe(true));
    api.resetCalls();
    await hook.result.current.site.mutateAsync({ id: 1, values: { settings: { themeConfig: { homeSections: [] } } } });
    await waitFor(() => expect(api.countOf('GET', cmsWorkbenchContract.configurationDraft.fullPath)).toBe(1));
    await waitFor(() => expect(hook.result.current.draft.isFetching).toBe(false));
    api.resetCalls();
    await hook.result.current.slot.mutateAsync({ params: { slotKey: 'home.main' }, body: { siteId: 1, widgetId: null, rendererKey: 'list-grid' } });
    await waitFor(() => expect(api.countOf('GET', cmsWorkbenchContract.configurationDraft.fullPath)).toBe(1));
  });
});
