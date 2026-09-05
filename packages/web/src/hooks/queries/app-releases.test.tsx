/**
 * app-releases 域缓存一致性契约。
 *
 * 关键判据：
 *  1. 发布 / 撤回 / 灰度是非标准生命周期接口，但应用列表的 latestVersion / releaseCount
 *     冗余列读了发布状态 → 必须连带失效 client-apps 列表；应用下拉源（lookup）只读
 *     id/name，不受发布影响，不得被打回源。
 *  2. 制品变更只影响所属版本（详情 + 列表的制品计数），不触及应用冗余列。
 *  3. 看板统计读事件流水（另一份数据源），任何版本 CRUD 都不应使其回源。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AppRelease, ClientApp } from '@zenith/shared/ops';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => {
  const base = createRequestMock(() => api);
  // 域内制品上传走 multipart（request.postForm），harness 默认替身没有该方法
  return { request: { ...base, postForm: (url: string, body?: unknown) => api.dispatch('POST', url, body) } };
});

import {
  appReleaseKeys,
  appReleaseStatsKeys,
  clientAppKeys,
  useAllClientApps,
  useAppReleaseList,
  useAppReleaseStats,
  useClientAppList,
  useDeleteAppReleases,
  usePublishAppRelease,
  useSaveAppRelease,
  useUploadAppArtifact,
} from './app-releases';

const APP: ClientApp = {
  id: 1, appKey: 'zenith-desktop', name: 'Zenith 桌面端', description: null,
  status: 'enabled', releaseCount: 1, latestVersion: '1.85.0',
  createdAt: '2026-07-31 10:00:00', updatedAt: '2026-07-31 10:00:00',
};

const RELEASE: AppRelease = {
  id: 1, appId: 1, appKey: 'zenith-desktop', appName: 'Zenith 桌面端',
  channel: 'stable', version: '1.85.0', notes: null, status: 'draft',
  mandatory: false, minVersion: null, rolloutPercent: 100, publishedAt: null,
  artifactCount: 1, artifacts: [],
  createdAt: '2026-07-31 10:00:00', updatedAt: '2026-07-31 10:00:00',
};

const STATS = {
  totals: { checks: 0, downloads: 0, devices: 0, installSuccess: 0, installFail: 0 },
  trend: [], platforms: [], versions: [],
};

const LIST_PARAMS = { page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/app-releases/releases', { list: [RELEASE], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/app-releases/releases/1', RELEASE)
    .on('GET', '/api/app-releases/apps', { list: [APP], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/app-releases/apps/all', [APP])
    .on('GET', '/api/app-releases/stats', STATS)
    .on('POST', '/api/app-releases/releases', RELEASE)
    .on('POST', '/api/app-releases/releases/1/publish', { ...RELEASE, status: 'published' })
    .on('POST', '/api/app-releases/releases/1/artifacts', { id: 9, releaseId: 1 })
    .on('PUT', '/api/app-releases/releases/1', RELEASE)
    .on('DELETE', '/api/app-releases/releases/1', null);
});

/** 还原页面挂载情况：版本列表 + 应用筛选下拉 + 应用管理弹窗列表 + 统计 Tab 曾打开过 */
function mountPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      releases: useAppReleaseList(LIST_PARAMS),
      apps: useClientAppList(LIST_PARAMS, true),
      lookup: useAllClientApps(),
      stats: useAppReleaseStats(1, 30),
      publish: usePublishAppRelease(),
      save: useSaveAppRelease(),
      remove: useDeleteAppReleases(),
      upload: useUploadAppArtifact(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountPage>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.releases.isSuccess).toBe(true);
    expect(hook.result.current.apps.isSuccess).toBe(true);
    expect(hook.result.current.lookup.isSuccess).toBe(true);
    expect(hook.result.current.stats.isSuccess).toBe(true);
  });
}

describe('usePublishAppRelease —— 生命周期变更的连带失效', () => {
  it('refreshes release list/detail and client-app list, but not the lookup or stats', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);
    // 弹窗遗留的详情缓存
    qc.setQueryData(appReleaseKeys.detail(1), RELEASE);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.publish.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(hook.result.current.releases.isFetching).toBe(false));

    expect(fetches.countOf(appReleaseKeys.lists)).toBe(1);
    // 应用列表的 latestVersion / releaseCount 冗余列随发布态变化
    expect(fetches.countOf(clientAppKeys.lists)).toBe(1);
    // 下拉源只读 id/name，发布不改它
    expect(fetches.countOf(clientAppKeys.lookup)).toBe(0);
    expect(isFresh(qc, clientAppKeys.lookup)).toBe(true);
    // 看板读事件流水，版本发布不使其回源
    expect(fetches.countOf(appReleaseStatsKeys.of(1, 30))).toBe(0);
    expect(isFresh(qc, appReleaseStatsKeys.of(1, 30))).toBe(true);

    fetches.stop();
  });
});

describe('useUploadAppArtifact —— 制品是版本的子资源', () => {
  it('refreshes the owning release detail and list, leaving client-app queries untouched', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);
    qc.setQueryData(appReleaseKeys.detail(1), RELEASE);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.upload.mutateAsync({ releaseId: 1, formData: new FormData() });
    await waitFor(() => expect(hook.result.current.releases.isFetching).toBe(false));

    expect(fetches.countOf(appReleaseKeys.lists)).toBe(1);
    // 制品不影响应用冗余列（版本数 / 最新版本号）
    expect(fetches.countOf(clientAppKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/app-releases/apps')).toBe(0);

    fetches.stop();
  });
});

describe('useSaveAppRelease / useDeleteAppReleases（工厂 + onSaved/onDeleted 接线）', () => {
  it('save also refreshes the client-app list (releaseCount changes on create)', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.save.mutateAsync({ values: { appId: 1, version: '1.86.0' } });
    await waitFor(() => expect(hook.result.current.releases.isFetching).toBe(false));

    expect(fetches.countOf(appReleaseKeys.lists)).toBe(1);
    expect(fetches.countOf(clientAppKeys.lists)).toBe(1);

    fetches.stop();
  });

  it('drops the deleted release detail rather than invalidating it into a 404 refetch', async () => {
    const { qc, hook } = mountPage();
    await settle(hook);

    qc.setQueryData(appReleaseKeys.detail(1), RELEASE);
    api.resetCalls();

    await hook.result.current.remove.mutateAsync([1]);
    await waitFor(() => expect(hook.result.current.releases.isFetching).toBe(false));

    expect(hasCacheEntry(qc, appReleaseKeys.detail(1))).toBe(false);
    expect(api.countOf('GET', '/api/app-releases/releases/1')).toBe(0);
    // onDeleted 接线：应用列表冗余列（releaseCount）回源
    expect(api.countOf('GET', '/api/app-releases/apps')).toBe(1);
  });
});
