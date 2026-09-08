/**
 * 分片上传会话服务单测（db / 存储适配 / 设置读取全部替身，临时分片写入独立临时目录）。
 *
 * 钉死的行为：
 *  1. init：分片大小由服务端裁定（片数超上限时上调；仍超单片上限时拒绝）
 *  2. chunk：每片字节数必须等于该序号期望值；合并中不再接收分片
 *  3. complete：并发只有一个能把 uploading → completing；租约过期的 completing 可被接管；
 *     总量 / 哈希不符置 aborted；可重试错误放回 uploading；云端路径哈希不符要删对象但不再 abort multipart
 *  4. abort：已完成拒绝、合并中拒绝、上传中中止云端 multipart 并置 aborted
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_MIN_BYTES, UPLOAD_MAX_CHUNKS } from '@zenith/shared/platform';

const TEMP_ROOT = vi.hoisted(() => {
  // config 在模块加载时读取环境变量，必须在任何 import 求值前设置
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp'}/zenith-upload-sessions-test-${process.pid}`;
  process.env.UPLOAD_TEMP_DIR = dir;
  return dir;
});

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return { db };
});
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, tenantId: null }) }));
vi.mock('../../lib/tenant', () => ({ tenantCondition: () => undefined, getCreateTenantId: () => null }));
vi.mock('./files.service', () => ({
  assertUploadSizeAllowed: vi.fn(async () => undefined),
  assertUploadTypeAllowed: vi.fn(async () => undefined),
  mapManagedFile: vi.fn((row: unknown) => row),
}));
vi.mock('../../lib/file-storage', () => ({
  buildUploadObjectKey: vi.fn((fileName: string) => ({ objectKey: `uploads/${fileName}`, extension: 'bin' })),
  uploadObjectByConfig: vi.fn(async () => undefined),
  extractBucketName: vi.fn(() => null),
  getMultipartDriver: vi.fn(() => null),
  mapObjectAclError: vi.fn((err: unknown) => err),
  resolveObjectAcl: vi.fn(() => null),
  readStoredFile: vi.fn(),
  deleteObjectByConfig: vi.fn(async () => undefined),
}));

import { db } from '../../db';
import { deleteObjectByConfig, getMultipartDriver, readStoredFile, uploadObjectByConfig } from '../../lib/file-storage';
import { abortChunkUpload, completeChunkUpload, initChunkUpload, uploadChunk } from './upload-sessions.service';

const dbMock = vi.mocked(db);
const storage = { getMultipartDriver: vi.mocked(getMultipartDriver), uploadObjectByConfig: vi.mocked(uploadObjectByConfig), readStoredFile: vi.mocked(readStoredFile), deleteObjectByConfig: vi.mocked(deleteObjectByConfig) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chain = Record<string, any>;

/** 可无限链式调用、await 后得到 result 的查询替身；`set` / `values` 的入参可从 chain.set.mock.calls 取出断言 */
function createChain(result: unknown): Chain {
  const chain: Chain = {};
  for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'returning', 'onConflictDoUpdate']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const MIB = 1024 * 1024;
const CONFIG = { id: 7, name: '本地磁盘', provider: 'local', basePath: 'uploads', status: 'enabled', isDefault: true };

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    uploadId: 'u-1',
    fileName: 'demo.bin',
    fileSize: UPLOAD_CHUNK_MIN_BYTES + 10,
    mimeType: 'application/octet-stream',
    chunkSize: UPLOAD_CHUNK_MIN_BYTES,
    totalChunks: 2,
    storageConfigId: CONFIG.id,
    provider: 'local',
    objectKey: 'uploads/demo.bin',
    bucketName: null,
    multipartUploadId: null,
    objectAcl: null,
    status: 'uploading',
    tenantId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fileOf(size: number): File {
  return new File([new Uint8Array(size)], 'chunk.bin');
}

/** 把两片内容写进会话临时目录，返回整文件的 sha256 */
async function writeChunks(uploadId: string, parts: Buffer[]) {
  const dir = path.join(TEMP_ROOT, uploadId);
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(parts.map((p, i) => fs.writeFile(path.join(dir, String(i)), p)));
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

async function expectHttp(promise: Promise<unknown>, status: number, messagePart?: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HTTPException);
  expect((err as HTTPException).status).toBe(status);
  if (messagePart) expect((err as HTTPException).message).toContain(messagePart);
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.getMultipartDriver.mockReturnValue(null);
  dbMock.$count.mockResolvedValue(1);
});

afterAll(async () => {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true });
});

describe('initChunkUpload', () => {
  it('分片数超过上限时按 MiB 上调分片大小，并以裁定值落库与返回', async () => {
    dbMock.select.mockReturnValueOnce(createChain([CONFIG]));
    const insert = createChain([]);
    dbMock.insert.mockReturnValueOnce(insert);
    const fileSize = 100 * 1024 * MIB;

    const res = await initChunkUpload({ fileName: 'huge.bin', fileSize, chunkSize: UPLOAD_CHUNK_MIN_BYTES });

    expect(res.chunkSize).toBeGreaterThan(UPLOAD_CHUNK_MIN_BYTES);
    expect(res.totalChunks).toBeLessThanOrEqual(UPLOAD_MAX_CHUNKS);
    expect(insert.values.mock.calls[0][0]).toMatchObject({ chunkSize: res.chunkSize, totalChunks: res.totalChunks });
  });

  it('上调后仍超过单片上限时拒绝', async () => {
    const fileSize = UPLOAD_MAX_CHUNKS * UPLOAD_CHUNK_MAX_BYTES + 1;
    await expectHttp(initChunkUpload({ fileName: 'too-big.bin', fileSize, chunkSize: UPLOAD_CHUNK_MIN_BYTES }), 400, '文件过大');
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

describe('uploadChunk', () => {
  it('分片字节数与期望不符时拒绝且不落盘不登记', async () => {
    dbMock.select.mockReturnValueOnce(createChain([session()]));
    await expectHttp(uploadChunk('u-1', 0, fileOf(UPLOAD_CHUNK_MIN_BYTES - 1)), 400, '大小不匹配');
    expect(dbMock.insert).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(TEMP_ROOT, 'u-1', '0'))).rejects.toThrow();
  });

  it('末片按余量校验；正确分片写入临时目录并返回已收片数', async () => {
    dbMock.select.mockReturnValueOnce(createChain([session({ uploadId: 'u-2' })]));
    dbMock.insert.mockReturnValueOnce(createChain([]));
    dbMock.$count.mockResolvedValueOnce(2);

    const res = await uploadChunk('u-2', 1, fileOf(10));

    expect(res).toEqual({ index: 1, receivedCount: 2 });
    expect((await fs.stat(path.join(TEMP_ROOT, 'u-2', '1'))).size).toBe(10);
  });

  it('会话合并中不再接收分片', async () => {
    dbMock.select.mockReturnValueOnce(createChain([session({ status: 'completing' })]));
    await expectHttp(uploadChunk('u-1', 0, fileOf(UPLOAD_CHUNK_MIN_BYTES)), 400, '正在合并');
  });
});

describe('completeChunkUpload', () => {
  const rows = [{ index: 0, size: UPLOAD_CHUNK_MIN_BYTES, etag: null }, { index: 1, size: 10, etag: null }];

  it('分片不完整时 400，且不抢占合并权', async () => {
    dbMock.select.mockReturnValueOnce(createChain([session()])).mockReturnValueOnce(createChain(rows.slice(0, 1)));
    await expectHttp(completeChunkUpload('u-1'), 400, '分片不完整');
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('租约内的 completing 会话直接 409；抢占失败（并发对手先到）也 409', async () => {
    dbMock.select.mockReturnValueOnce(createChain([session({ status: 'completing', updatedAt: new Date() })]));
    await expectHttp(completeChunkUpload('u-1'), 409, '正在合并');

    dbMock.select.mockReturnValueOnce(createChain([session()])).mockReturnValueOnce(createChain(rows));
    dbMock.update.mockReturnValueOnce(createChain([]));
    await expectHttp(completeChunkUpload('u-1'), 409, '正在合并');
  });

  it('租约过期的 completing 可被接管并完成；写入的 contentHash 为服务端实算值', async () => {
    const parts = [Buffer.alloc(UPLOAD_CHUNK_MIN_BYTES, 1), Buffer.from('0123456789')];
    const hash = await writeChunks('u-3', parts);
    const stale = session({ uploadId: 'u-3', status: 'completing', updatedAt: new Date(Date.now() - 31 * 60 * 1000) });
    dbMock.select
      .mockReturnValueOnce(createChain([stale]))
      .mockReturnValueOnce(createChain(rows))
      .mockReturnValueOnce(createChain([CONFIG]));
    const claim = createChain([{ id: stale.id }]);
    dbMock.update.mockReturnValue(claim);
    const insert = createChain([{ id: 'file-1', contentHash: hash }]);
    dbMock.insert.mockReturnValueOnce(insert);

    const file = await completeChunkUpload('u-3', { expectedHash: hash.toUpperCase(), skipTypeCheck: true, visibility: 'restricted' });

    expect(file).toMatchObject({ id: 'file-1' });
    expect(storage.uploadObjectByConfig).toHaveBeenCalledTimes(1);
    expect(insert.values.mock.calls[0][0]).toMatchObject({ contentHash: hash, size: stale.fileSize, visibility: 'restricted' });
    const statuses = claim.set.mock.calls.map((c: unknown[]) => (c[0] as { status: string }).status);
    expect(statuses).toEqual(['completing', 'completed']);
    await expect(fs.stat(path.join(TEMP_ROOT, 'u-3'))).rejects.toThrow();
  });

  it('分片总大小与声明不一致：会话置 aborted、临时目录清除、不上传对象', async () => {
    await writeChunks('u-4', [Buffer.alloc(UPLOAD_CHUNK_MIN_BYTES), Buffer.alloc(10)]);
    dbMock.select
      .mockReturnValueOnce(createChain([session({ uploadId: 'u-4', fileSize: UPLOAD_CHUNK_MIN_BYTES + 99 })]))
      .mockReturnValueOnce(createChain(rows))
      .mockReturnValueOnce(createChain([CONFIG]));
    const update = createChain([{ id: 11 }]);
    dbMock.update.mockReturnValue(update);

    await expectHttp(completeChunkUpload('u-4'), 400, '不一致');

    expect(storage.uploadObjectByConfig).not.toHaveBeenCalled();
    const statuses = update.set.mock.calls.map((c: unknown[]) => (c[0] as { status: string }).status);
    expect(statuses).toEqual(['completing', 'aborted']);
    await expect(fs.stat(path.join(TEMP_ROOT, 'u-4'))).rejects.toThrow();
  });

  it('本地路径哈希不符：会话置 aborted 且不上传对象', async () => {
    await writeChunks('u-5', [Buffer.alloc(UPLOAD_CHUNK_MIN_BYTES), Buffer.alloc(10)]);
    dbMock.select
      .mockReturnValueOnce(createChain([session({ uploadId: 'u-5' })]))
      .mockReturnValueOnce(createChain(rows))
      .mockReturnValueOnce(createChain([CONFIG]));
    const update = createChain([{ id: 11 }]);
    dbMock.update.mockReturnValue(update);

    await expectHttp(completeChunkUpload('u-5', { expectedHash: 'f'.repeat(64), skipTypeCheck: true }), 400, 'SHA-256');

    expect(storage.uploadObjectByConfig).not.toHaveBeenCalled();
    expect(update.set.mock.calls.at(-1)?.[0]).toEqual({ status: 'aborted' });
  });

  it('可重试错误（合并上传抛错）把状态放回 uploading，保留分片供重试', async () => {
    await writeChunks('u-6', [Buffer.alloc(UPLOAD_CHUNK_MIN_BYTES), Buffer.alloc(10)]);
    dbMock.select
      .mockReturnValueOnce(createChain([session({ uploadId: 'u-6' })]))
      .mockReturnValueOnce(createChain(rows))
      .mockReturnValueOnce(createChain([CONFIG]));
    const update = createChain([{ id: 11 }]);
    dbMock.update.mockReturnValue(update);
    storage.uploadObjectByConfig.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(completeChunkUpload('u-6', { skipTypeCheck: true })).rejects.toThrow('ECONNRESET');

    const statuses = update.set.mock.calls.map((c: unknown[]) => (c[0] as { status: string }).status);
    expect(statuses).toEqual(['completing', 'uploading']);
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect((await fs.stat(path.join(TEMP_ROOT, 'u-6', '0'))).size).toBe(UPLOAD_CHUNK_MIN_BYTES);
  });

  it('云端路径：合并后读回哈希不符 → 删除对象、置 aborted，但不再对已完成的 multipart 调 abort', async () => {
    const driver = { init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) };
    storage.getMultipartDriver.mockReturnValue(driver);
    storage.readStoredFile.mockResolvedValue({ stream: new Blob([new Uint8Array([1, 2, 3])]).stream(), contentType: 'application/octet-stream', fileName: 'demo.bin' });
    const cloud = session({ uploadId: 'u-7', provider: 's3', multipartUploadId: 'mp-1', bucketName: 'bkt' });
    const cloudRows = [{ index: 0, size: UPLOAD_CHUNK_MIN_BYTES, etag: '"a"' }, { index: 1, size: 10, etag: '"b"' }];
    dbMock.select
      .mockReturnValueOnce(createChain([cloud]))
      .mockReturnValueOnce(createChain(cloudRows))
      .mockReturnValueOnce(createChain([{ ...CONFIG, provider: 's3' }]));
    const update = createChain([{ id: 11 }]);
    dbMock.update.mockReturnValue(update);

    await expectHttp(completeChunkUpload('u-7', { expectedHash: 'e'.repeat(64), skipTypeCheck: true }), 400, 'SHA-256');

    expect(driver.complete).toHaveBeenCalledWith(expect.anything(), 'uploads/demo.bin', 'mp-1', [
      { partNumber: 1, etag: '"a"' }, { partNumber: 2, etag: '"b"' },
    ], 'application/octet-stream');
    expect(storage.deleteObjectByConfig).toHaveBeenCalledWith(expect.anything(), 'uploads/demo.bin', 'bkt');
    expect(driver.abort).not.toHaveBeenCalled();
    expect(update.set.mock.calls.at(-1)?.[0]).toEqual({ status: 'aborted' });
  });
});

describe('abortChunkUpload', () => {
  it('已完成与租约内合并中的会话不可中止', async () => {
    dbMock.select.mockReturnValueOnce(createChain([session({ status: 'completed' })]));
    await expectHttp(abortChunkUpload('u-1'), 400, '已完成');
    dbMock.select.mockReturnValueOnce(createChain([session({ status: 'completing' })]));
    await expectHttp(abortChunkUpload('u-1'), 409, '正在合并');
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('上传中的云端会话：中止云端 multipart 并置 aborted', async () => {
    const driver = { init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(), abort: vi.fn(async () => undefined) };
    storage.getMultipartDriver.mockReturnValue(driver);
    dbMock.select
      .mockReturnValueOnce(createChain([session({ provider: 's3', multipartUploadId: 'mp-9' })]))
      .mockReturnValueOnce(createChain([{ ...CONFIG, provider: 's3' }]));
    const update = createChain([]);
    dbMock.update.mockReturnValue(update);

    await abortChunkUpload('u-1');

    expect(driver.abort).toHaveBeenCalledWith(expect.anything(), 'uploads/demo.bin', 'mp-9');
    expect(update.set).toHaveBeenCalledWith({ status: 'aborted' });
  });
});
