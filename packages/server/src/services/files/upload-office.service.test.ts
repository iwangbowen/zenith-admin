import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAsBlob } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { filesSettingsSchema } from '@zenith/shared/settings';
import { createHash } from 'node:crypto';

const tempRoot = vi.hoisted(() => {
  const root = `${process.env.TEMP ?? process.env.TMP ?? '/tmp'}/zenith-office-upload-${process.pid}`;
  process.env.UPLOAD_TEMP_DIR = root;
  return root;
});
vi.mock('../../db', () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), $count: vi.fn() } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, tenantId: null }) }));
vi.mock('../../lib/tenant', () => ({ tenantCondition: () => undefined, getCreateTenantId: () => null }));
vi.mock('../../lib/settings', () => ({ getSettings: vi.fn() }));
vi.mock('../../lib/file-storage', () => ({
  buildUploadObjectKey: vi.fn(), uploadObjectByConfig: vi.fn(), uploadFileByConfig: vi.fn(),
  extractBucketName: vi.fn(), getMultipartDriver: vi.fn(), mapObjectAclError: (err: unknown) => err,
  resolveObjectAcl: vi.fn(), readStoredFile: vi.fn(), deleteObjectByConfig: vi.fn(),
  buildManagedFileProxyUrl: (id: string) => `/files/${id}`, buildPublicFileUrl: () => null,
}));

import { db } from '../../db';
import { getSettings } from '../../lib/settings';
import { deleteObjectByConfig, getMultipartDriver, readStoredFile, uploadFileByConfig, uploadObjectByConfig } from '../../lib/file-storage';
import { uploadManagedFile } from './files.service';
import { completeChunkUpload, uploadChunk } from './upload-sessions.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- database fluent boundary is deliberately stubbed
type Chain = Record<string, any>;
function chain(result: unknown): Chain {
  const query: Chain = {};
  for (const method of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'returning', 'onConflictDoUpdate']) query[method] = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return query;
}
const dbMock = vi.mocked(db);
const config = { id: 7, name: 'local', provider: 'local', basePath: 'uploads', status: 'enabled', isDefault: true };
const samples = [
  { name: 'test.doc', mime: 'application/msword' },
  { name: 'Simple.xls', mime: 'application/vnd.ms-excel' },
  { name: 'basic_test_ppt_file.ppt', mime: 'application/vnd.ms-powerpoint' },
];
async function sampleFile(name: string, mime: string) {
  const blob = await openAsBlob(new URL(`./fixtures/legacy-office/${name}`, import.meta.url));
  return new File([blob], name, { type: mime });
}
function session(file: File, chunkSize: number, provider = 'local') {
  return { id: 1, uploadId: 'sample', fileName: file.name, mimeType: file.type, fileSize: file.size,
    chunkSize, totalChunks: Math.ceil(file.size / chunkSize), storageConfigId: 7, provider,
    objectKey: 'uploads/sample', bucketName: null, multipartUploadId: provider === 's3' ? 'cloud-1' : null,
    objectAcl: null, status: 'uploading', updatedAt: new Date(), tenantId: null };
}
function prepareComplete(file: File, chunkSize: number, provider = 'local') {
  const upload = session(file, chunkSize, provider);
  const rows = Array.from({ length: upload.totalChunks }, (_, index) => ({ index, size: Math.min(chunkSize, file.size - index * chunkSize), etag: provider === 's3' ? `etag-${index}` : null }));
  dbMock.select.mockReturnValueOnce(chain([upload])).mockReturnValueOnce(chain(rows)).mockReturnValueOnce(chain([{ ...config, provider }]));
  const update = chain([{ id: 1 }]);
  dbMock.update.mockReturnValue(update);
  const insert = chain([{ id: 'managed-file', originalName: file.name, mimeType: file.type }]);
  dbMock.insert.mockReturnValue(insert);
  return { update, insert };
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(getSettings).mockResolvedValue(filesSettingsSchema.parse({}));
  vi.mocked(deleteObjectByConfig).mockResolvedValue(undefined);
  dbMock.$count.mockResolvedValue(1);
  await fs.rm(tempRoot, { recursive: true, force: true });
});
afterAll(async () => { await fs.rm(tempRoot, { recursive: true, force: true }); });

describe('Office upload service paths with real type detection and stubbed persistence', () => {
  it.each(samples)('ordinary upload accepts $name under default settings', async ({ name, mime }) => {
    const file = await sampleFile(name, mime);
    dbMock.select.mockReturnValueOnce(chain([config]));
    dbMock.insert.mockReturnValueOnce(chain([{ id: 'managed-file', originalName: name }]));
    vi.mocked(uploadFileByConfig).mockResolvedValueOnce({ objectKey: 'uploads/sample', bucketName: null, size: file.size, mimeType: mime, extension: name.split('.').at(-1)! });
    await expect(uploadManagedFile(file)).resolves.toMatchObject({ id: 'managed-file', originalName: name });
    expect(uploadFileByConfig).toHaveBeenCalledOnce();
  });

  it.each(samples)('local multipart reads $name across chunk boundaries', async ({ name, mime }) => {
    const file = await sampleFile(name, mime);
    const chunkSize = 512; // Deliberately place the CFB directory/data in later chunks.
    const { insert } = prepareComplete(file, chunkSize);
    await fs.mkdir(path.join(tempRoot, 'sample'), { recursive: true });
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      await fs.writeFile(path.join(tempRoot, 'sample', String(offset / chunkSize)), Buffer.from(await file.slice(offset, offset + chunkSize).arrayBuffer()));
    }
    await expect(completeChunkUpload('sample')).resolves.toMatchObject({ id: 'managed-file' });
    expect(uploadObjectByConfig).toHaveBeenCalledOnce();
    expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ mimeType: mime }));
    await expect(fs.stat(path.join(tempRoot, 'sample'))).rejects.toThrow();
  });

  it.each(samples)('cloud multipart validates the completed $name content', async ({ name, mime }) => {
    const file = await sampleFile(name, mime);
    const { update } = prepareComplete(file, 4096, 's3');
    const driver = { init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(), abort: vi.fn() };
    vi.mocked(getMultipartDriver).mockReturnValue(driver);
    vi.mocked(readStoredFile).mockResolvedValue({ stream: file.stream(), contentType: file.type, fileName: name });
    await expect(completeChunkUpload('sample')).resolves.toMatchObject({ id: 'managed-file' });
    expect(driver.complete).toHaveBeenCalledOnce();
    expect(readStoredFile).toHaveBeenCalledOnce();
    expect(deleteObjectByConfig).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenLastCalledWith({ status: 'completed' });
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it('a custom whitelist rejects Office on ordinary upload before storage is touched', async () => {
    vi.mocked(getSettings).mockResolvedValue(filesSettingsSchema.parse({ uploadAllowedTypes: ['application/pdf'] }));
    await expect(uploadManagedFile(await sampleFile('test.doc', 'application/pdf'))).rejects.toMatchObject({ status: 400 });
    expect(uploadFileByConfig).not.toHaveBeenCalled();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('a rejected cloud object is deleted, aborted, and never registered', async () => {
    vi.mocked(getSettings).mockResolvedValue(filesSettingsSchema.parse({ uploadAllowedTypes: ['application/pdf'] }));
    const file = await sampleFile('test.doc', 'application/pdf');
    const { update } = prepareComplete(file, 4096, 's3');
    const driver = { init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(), abort: vi.fn() };
    vi.mocked(getMultipartDriver).mockReturnValue(driver);
    vi.mocked(readStoredFile).mockResolvedValue({ stream: file.stream(), contentType: file.type, fileName: file.name });
    await expect(completeChunkUpload('sample')).rejects.toMatchObject({ status: 400 });
    expect(deleteObjectByConfig).toHaveBeenCalledWith(expect.anything(), 'uploads/sample', null);
    expect(driver.abort).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenLastCalledWith({ status: 'aborted' });
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it('local multipart aborts and removes its chunks when the configured MIME list excludes Office', async () => {
    vi.mocked(getSettings).mockResolvedValue(filesSettingsSchema.parse({ uploadAllowedTypes: ['application/pdf'] }));
    const file = await sampleFile('test.doc', 'application/pdf');
    const { update } = prepareComplete(file, file.size);
    await fs.mkdir(path.join(tempRoot, 'sample'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'sample', '0'), Buffer.from(await file.arrayBuffer()));
    await expect(completeChunkUpload('sample')).rejects.toMatchObject({ status: 400 });
    expect(uploadObjectByConfig).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenLastCalledWith({ status: 'aborted' });
    await expect(fs.stat(path.join(tempRoot, 'sample'))).rejects.toThrow();
  });

  it('keeps the validation switch effective for cloud completion without reading the object', async () => {
    vi.mocked(getSettings).mockResolvedValue(filesSettingsSchema.parse({ uploadValidateType: false, uploadAllowedTypes: [] }));
    const file = await sampleFile('test.doc', 'application/msword');
    prepareComplete(file, 4096, 's3');
    vi.mocked(getMultipartDriver).mockReturnValue({ init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(), abort: vi.fn() });
    await expect(completeChunkUpload('sample')).resolves.toMatchObject({ id: 'managed-file' });
    expect(readStoredFile).not.toHaveBeenCalled();
  });

  it('still calculates and persists the cloud object hash after Office type validation', async () => {
    const file = await sampleFile('test.doc', 'application/msword');
    const { insert } = prepareComplete(file, 4096, 's3');
    vi.mocked(getMultipartDriver).mockReturnValue({ init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(), abort: vi.fn() });
    vi.mocked(readStoredFile).mockImplementation(async () => ({ stream: file.stream(), contentType: file.type, fileName: file.name }));
    const hash = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
    await completeChunkUpload('sample', { expectedHash: hash });
    expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ contentHash: hash }));
    expect(deleteObjectByConfig).not.toHaveBeenCalled();
  });

  it('cleans up a completed cloud object and terminates its session when reading fails', async () => {
    const file = await sampleFile('test.doc', 'application/msword');
    const { update } = prepareComplete(file, 4096, 's3');
    const driver = { init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(), abort: vi.fn() };
    vi.mocked(getMultipartDriver).mockReturnValue(driver);
    vi.mocked(readStoredFile).mockResolvedValue({ stream: new ReadableStream({ pull(controller) { controller.error(new Error('read failed')); } }), contentType: file.type, fileName: file.name });
    await expect(completeChunkUpload('sample')).rejects.toThrow('read failed');
    expect(deleteObjectByConfig).toHaveBeenCalledOnce();
    expect(driver.abort).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenLastCalledWith({ status: 'aborted' });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('keeps non-CFB first-chunk rejection before sending bytes to the cloud', async () => {
    const file = new File([new Uint8Array([0x4d, 0x5a, 0, 0])], 'fake.doc', { type: 'application/msword' });
    dbMock.select.mockReturnValueOnce(chain([session(file, file.size, 's3')]));
    const driver = { init: vi.fn(), uploadPart: vi.fn(), complete: vi.fn(), abort: vi.fn() };
    vi.mocked(getMultipartDriver).mockReturnValue(driver);
    await expect(uploadChunk('sample', 0, file)).rejects.toMatchObject({ status: 400 });
    expect(driver.uploadPart).not.toHaveBeenCalled();
  });

  it('cloud CFB validation waits for completion when the first chunk lacks directory sectors', async () => {
    const file = await sampleFile('test.doc', 'application/msword');
    dbMock.select.mockReturnValueOnce(chain([session(file, 512, 's3')])).mockReturnValueOnce(chain([{ ...config, provider: 's3' }]));
    const driver = { init: vi.fn(), uploadPart: vi.fn(async () => 'etag'), complete: vi.fn(), abort: vi.fn() };
    vi.mocked(getMultipartDriver).mockReturnValue(driver);
    dbMock.insert.mockReturnValueOnce(chain([]));
    await expect(uploadChunk('sample', 0, new File([file.slice(0, 512)], 'chunk'))).resolves.toMatchObject({ receivedCount: 1 });
    expect(driver.uploadPart).toHaveBeenCalledOnce();
    expect(readStoredFile).not.toHaveBeenCalled();
  });
});
