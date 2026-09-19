/**
 * 托管文件读取可见性边界的单测：通用 `content` 接口是**无鉴权**公开接口（契约里 `public: true`），
 * 因此 `restricted` 文件在这里必须按「不存在」处理，既不返回内容也不泄露其存在性。
 *
 * 这条边界是敏感产物的唯一防线：数据库备份这类整库数据注册为 restricted 后，
 * 只有带权限的归属模块路由（如 db-admin 的备份下载）能读到它。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const mocks = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../../db', () => ({ db: { select: mocks.select } }));

import { fileStorageConfigs } from '../../db/schema';
import { getStoredFileForRead } from './files.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chain = Record<string, any>;

const STORAGE = { id: 1, name: '本地磁盘', provider: 'local', basePath: 'storage/uploads' };
const fileRow = (visibility: string) => ({ id: 'file-1', storageConfigId: 1, objectKey: 'uploads/x.bin', size: 10, visibility });

/** 按 `.from(表)` 决定返回哪些行的查询替身（两次查询同源：managed_files → file_storage_configs） */
function stubSelect(files: unknown[], storages: unknown[]) {
  mocks.select.mockImplementation(() => {
    let table: unknown;
    const chain: Chain = {};
    for (const m of ['from', 'where', 'limit']) {
      chain[m] = vi.fn((arg: unknown) => {
        if (m === 'from') table = arg;
        return chain;
      });
    }
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(table === fileStorageConfigs ? storages : files).then(resolve, reject);
    return chain;
  });
}

beforeEach(() => {
  mocks.select.mockReset();
});

describe('getStoredFileForRead（通用 content 接口的可见性边界）', () => {
  it('restricted 文件：按不存在处理（404），且不继续读存储配置', async () => {
    stubSelect([fileRow('restricted')], [STORAGE]);

    const failure = getStoredFileForRead('file-1');

    await expect(failure).rejects.toBeInstanceOf(HTTPException);
    await expect(failure).rejects.toMatchObject({ status: 404 });
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it('public 文件：正常返回文件行与存储配置', async () => {
    stubSelect([fileRow('public')], [STORAGE]);

    const result = await getStoredFileForRead('file-1');

    expect(result.file).toMatchObject({ id: 'file-1', visibility: 'public' });
    expect(result.storageConfig.id).toBe(1);
  });

  it('文件不存在：404', async () => {
    stubSelect([], [STORAGE]);

    await expect(getStoredFileForRead('missing')).rejects.toMatchObject({ status: 404 });
  });
});
