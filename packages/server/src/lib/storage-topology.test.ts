import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ storages: [] as Array<{ name: string; provider: string }>, staticSites: 0, fail: false }));

vi.mock('../db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => { if (mocks.fail) throw new Error('db down'); return mocks.storages; } }) }),
    $count: async () => mocks.staticSites,
  },
}));

type Module = typeof import('./storage-topology');

async function load(roles: { api: boolean; worker: boolean }, storageShared = false): Promise<Module> {
  vi.resetModules();
  vi.doMock('../config', () => ({ config: { roles: { ...roles, explicit: true, list: [], label: 'x' }, storageShared } }));
  const mod = await import('./storage-topology');
  vi.doUnmock('../config');
  return mod;
}

afterEach(() => {
  mocks.storages = [];
  mocks.staticSites = 0;
  mocks.fail = false;
});

describe('assertWorkerStorageTopology', () => {
  it('纯 worker + 本地磁盘型存储 + 未声明共享 → 拒绝启动并列出依赖', async () => {
    mocks.storages = [{ name: '默认本地', provider: 'local' }, { name: '七牛', provider: 'kodo' }];
    mocks.staticSites = 2;
    const { assertWorkerStorageTopology } = await load({ api: false, worker: true });
    await expect(assertWorkerStorageTopology()).rejects.toThrow(/默认本地.*local[\s\S]*七牛.*kodo[\s\S]*2 个 CMS 站点/);
  });

  it('声明 STORAGE_SHARED 后放行', async () => {
    mocks.storages = [{ name: '默认本地', provider: 'local' }];
    const { assertWorkerStorageTopology } = await load({ api: false, worker: true }, true);
    await expect(assertWorkerStorageTopology()).resolves.toBeUndefined();
  });

  it('与 api 同进程（单机全量）或纯 api 不检查', async () => {
    mocks.storages = [{ name: '默认本地', provider: 'local' }];
    await expect((await load({ api: true, worker: true })).assertWorkerStorageTopology()).resolves.toBeUndefined();
    await expect((await load({ api: true, worker: false })).assertWorkerStorageTopology()).resolves.toBeUndefined();
  });

  it('只用对象存储且无静态化站点时无需共享卷', async () => {
    const { assertWorkerStorageTopology, collectLocalDiskDependencies } = await load({ api: false, worker: true });
    await expect(collectLocalDiskDependencies()).resolves.toEqual([]);
    await expect(assertWorkerStorageTopology()).resolves.toBeUndefined();
  });

  it('数据库不可用时不阻断启动（由后续步骤以更明确的错误暴露）', async () => {
    mocks.fail = true;
    const { assertWorkerStorageTopology } = await load({ api: false, worker: true });
    await expect(assertWorkerStorageTopology()).resolves.toBeUndefined();
  });
});
