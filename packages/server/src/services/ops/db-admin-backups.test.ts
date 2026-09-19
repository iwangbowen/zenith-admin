/**
 * 数据库备份记录服务单测（db / 文件服务全替身）。钉死两类边界：
 *
 *  1. 下载只走「记录里的 fileId → restricted 文件」：记录不存在、或记录还没有产物（未完成 /
 *     未配置默认存储）都必须 404，不能退化成通用 `/files/{id}/content`（那是无鉴权公开接口）。
 *  2. 删除记录要把产物置 `orphan`：备份文件注册为 restricted + live，行还在就不该被回收；
 *     记录删掉后若不改状态，文件既永远回收不掉，又仍是一份可被通用接口读到的整库数据。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  del: vi.fn(),
  update: vi.fn(),
  getRestrictedFileForRead: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: {
    query: { dbBackups: { findFirst: mocks.findFirst } },
    delete: mocks.del,
    update: mocks.update,
  },
}));
vi.mock('../files/files.service', () => ({ getRestrictedFileForRead: mocks.getRestrictedFileForRead }));
vi.mock('../../lib/db-backup', () => ({ createPgDumpBackup: vi.fn(), createDrizzleExportBackup: vi.fn() }));

import { deleteDbBackup, getDbBackupFileForDownload } from './db-admin-backups.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chain = Record<string, any>;

/** 可无限链式调用、await 后得到 result 的 Drizzle 查询替身；`set` / `where` 的入参可从 mock.calls 取出断言 */
function createChain(result: unknown): Chain {
  const chain: Chain = {};
  for (const m of ['where', 'set', 'returning']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getDbBackupFileForDownload（备份产物只经专用路由读取）', () => {
  it('记录存在且有产物：按 fileId 取 restricted 文件', async () => {
    mocks.findFirst.mockResolvedValue({ id: 9, fileId: 'file-9' });
    mocks.getRestrictedFileForRead.mockResolvedValue({ file: { id: 'file-9' }, storageConfig: { id: 1 } });

    const result = await getDbBackupFileForDownload(9);

    expect(mocks.getRestrictedFileForRead).toHaveBeenCalledWith('file-9');
    expect(result.file.id).toBe('file-9');
  });

  it('记录不存在：404，且不触碰文件服务', async () => {
    mocks.findFirst.mockResolvedValue(undefined);

    const failure = getDbBackupFileForDownload(404);
    await expect(failure).rejects.toBeInstanceOf(HTTPException);
    await expect(failure).rejects.toMatchObject({ status: 404 });
    expect(mocks.getRestrictedFileForRead).not.toHaveBeenCalled();
  });

  it('记录存在但还没有产物（未完成 / 未配置默认存储）：404，且不触碰文件服务', async () => {
    mocks.findFirst.mockResolvedValue({ id: 10, fileId: null });

    await expect(getDbBackupFileForDownload(10)).rejects.toMatchObject({ status: 404 });
    expect(mocks.getRestrictedFileForRead).not.toHaveBeenCalled();
  });
});

describe('deleteDbBackup（删记录同时交出产物所有权）', () => {
  it('有产物：置 orphan 并打上时间戳，交给文件 GC 在宽限期后回收', async () => {
    const delChain = createChain([{ id: 3, fileId: 'file-3' }]);
    const updateChain = createChain(undefined);
    mocks.del.mockReturnValue(delChain);
    mocks.update.mockReturnValue(updateChain);

    await deleteDbBackup(3);

    expect(updateChain.set).toHaveBeenCalledTimes(1);
    const set = updateChain.set.mock.calls[0][0] as { gcState: string; orphanedAt: Date };
    expect(set.gcState).toBe('orphan');
    expect(set.orphanedAt).toBeInstanceOf(Date);
    expect(updateChain.where).toHaveBeenCalledTimes(1);
  });

  it('没有产物（失败或未完成的备份）：只删记录，不发多余的文件更新', async () => {
    const delChain = createChain([{ id: 4, fileId: null }]);
    mocks.del.mockReturnValue(delChain);

    await deleteDbBackup(4);

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('记录不存在：404', async () => {
    mocks.del.mockReturnValue(createChain([]));

    await expect(deleteDbBackup(999)).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
