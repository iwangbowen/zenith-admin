/**
 * docker 域缓存一致性契约
 *
 * 收敛前 `useDockerPrune` 与终端页的容器启停都按 `['docker']` 域根广播，把镜像 / 网络 / 存储卷清单一并打回源；
 * 收敛后：
 *  1. 容器启停只改容器自身：容器清单 + 该容器的目录浏览回源，镜像 / 网络 / 存储卷保持 fresh
 *  2. 清理跨资源改变占用计数：四张清单都回源
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { partialMatchKey, type QueryKey } from '@tanstack/react-query';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
  type FetchObserver,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { dockerKeys, useDockerContainerAction, useDockerContainers, useDockerImages, useDockerNetworks, useDockerPrune, useDockerVolumes } from './docker';
import { fetchDockerDir, useDockerExplorerAction } from './terminal-files';

/** 目录浏览键的 input 段按对象子集匹配（与 invalidateQueries 同一算法） */
function fetchesMatching(fetches: FetchObserver, key: QueryKey) {
  return fetches.events.filter((k) => partialMatchKey(k, key)).length;
}

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/docker', [{ id: 'c1', name: 'web', state: 'running' }])
    .on('GET', '/api/docker/images', [])
    .on('GET', '/api/docker/networks', [])
    .on('GET', '/api/docker/volumes', [])
    .on('GET', '/api/docker/c1/files', [{ name: 'etc', type: 'dir' }])
    .on('POST', '/api/docker/c1/restart', null)
    .on('POST', '/api/docker/prune/containers', { deleted: 1, reclaimedBytes: 0 })
    .on('POST', '/api/docker/prune/system', { deleted: 1, reclaimedBytes: 0 });
});

async function mountDockerPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      containers: useDockerContainers(),
      images: useDockerImages(),
      networks: useDockerNetworks(),
      volumes: useDockerVolumes(),
      action: useDockerContainerAction(),
      explorerAction: useDockerExplorerAction(),
      prune: useDockerPrune(),
    }),
    { wrapper: createWrapper(qc) },
  );
  await waitFor(() => {
    expect(hook.result.current.containers.isSuccess).toBe(true);
    expect(hook.result.current.images.isSuccess).toBe(true);
    expect(hook.result.current.networks.isSuccess).toBe(true);
    expect(hook.result.current.volumes.isSuccess).toBe(true);
  });
  // 终端页 Explorer 用 fetchQuery 拉取容器目录（无 observer），失效后下次 fetchQuery 应回源
  await fetchDockerDir(qc, 'c1', '/');
  return { qc, hook };
}

describe('容器启停 —— 只动容器清单与该容器的目录浏览', () => {
  it('refetches the container list, marks the container directory stale, and leaves images / networks / volumes fresh', async () => {
    const { qc, hook } = await mountDockerPage();
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.action.mutateAsync({ id: 'c1', action: 'restart' });
    await waitFor(() => expect(fetches.countOf(dockerKeys.containers)).toBe(1));

    expect(isFresh(qc, dockerKeys.files('c1', '/'))).toBe(false);
    await fetchDockerDir(qc, 'c1', '/');
    expect(api.countOf('GET', '/api/docker/c1/files')).toBe(1);

    expect(fetches.countOf(dockerKeys.images)).toBe(0);
    expect(fetches.countOf(dockerKeys.networks)).toBe(0);
    expect(fetches.countOf(dockerKeys.volumes)).toBe(0);
    expect(isFresh(qc, dockerKeys.images)).toBe(true);
    fetches.stop();
  });

  it('the terminal explorer action is the same mutation and no longer sweeps host file caches', async () => {
    const { qc, hook } = await mountDockerPage();
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.explorerAction.mutateAsync({ id: 'c1', action: 'restart' });
    await waitFor(() => expect(fetches.countOf(dockerKeys.containers)).toBe(1));

    expect(fetchesMatching(fetches, dockerKeys.filesOf('c1'))).toBe(0);
    expect(isFresh(qc, dockerKeys.volumes)).toBe(true);
    fetches.stop();
  });
});

describe('useDockerPrune —— 跨资源占用计数，四张清单回源', () => {
  it('refetches containers, images, networks and volumes after a system prune', async () => {
    const { qc, hook } = await mountDockerPage();
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.prune.mutateAsync({ scope: 'system' });
    await waitFor(() => {
      expect(fetches.countOf(dockerKeys.containers)).toBe(1);
      expect(fetches.countOf(dockerKeys.images)).toBe(1);
      expect(fetches.countOf(dockerKeys.networks)).toBe(1);
      expect(fetches.countOf(dockerKeys.volumes)).toBe(1);
    });
    fetches.stop();
  });
});
