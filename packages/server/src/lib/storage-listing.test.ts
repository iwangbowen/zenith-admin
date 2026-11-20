import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { FileStorageConfigRow } from '../db/schema';
import { listStorageObjects } from './file-storage';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'zenith-storage-list-'));
  await mkdir(path.join(root, 'uploads', 'folder-a'), { recursive: true });
  await writeFile(path.join(root, 'uploads', 'a.txt'), 'a');
  await writeFile(path.join(root, 'uploads', 'b.txt'), 'bb');
  await writeFile(path.join(root, 'uploads', 'folder-a', 'nested.txt'), 'nested');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function localConfig(): FileStorageConfigRow {
  return { provider: 'local', localRootPath: root, basePath: 'uploads' } as FileStorageConfigRow;
}

describe('listStorageObjects（local）', () => {
  it('按名称排序并用 offset 游标分页', async () => {
    const first = await listStorageObjects(localConfig(), { prefix: 'uploads/', limit: 2 });
    expect(first.objects.map((item) => item.key)).toEqual(['uploads/a.txt', 'uploads/b.txt']);
    expect(first.prefixes).toEqual([]);
    expect(first.nextCursor).toEqual({ offset: 2 });
    expect(first.objects[0]).toMatchObject({ size: 1 });

    const second = await listStorageObjects(localConfig(), { prefix: 'uploads/', limit: 2, cursor: first.nextCursor! });
    expect(second.objects).toEqual([]);
    expect(second.prefixes).toEqual(['uploads/folder-a/']);
    expect(second.nextCursor).toBeNull();
  });

  it('列出子目录且不递归展开', async () => {
    const page = await listStorageObjects(localConfig(), { prefix: 'uploads/folder-a/', limit: 10 });
    expect(page.prefixes).toEqual([]);
    expect(page.objects.map((item) => item.key)).toEqual(['uploads/folder-a/nested.txt']);
  });
});
