// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileContract } from '@zenith/shared/platform';
import { api } from '@/lib/contract-query';
import { scopedStorageKey } from '@/utils/storage';
import { directMultipartUpload, listDirectUploadResumeCandidates } from './direct-multipart-upload';

vi.mock('@/lib/contract-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/contract-query')>(),
  api: vi.fn(),
}));

const apiMock = vi.mocked(api);
const sentHeaders: Array<Record<string, string>> = [];

class SuccessfulXhr {
  status = 200;
  responseText = '';
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  url = '';
  headers: Record<string, string> = {};

  open(_method: string, url: string) { this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  getResponseHeader(name: string) { return name.toLowerCase() === 'etag' ? 'part-etag' : null; }
  send(body: Blob) {
    sentHeaders.push(this.headers);
    this.upload.onprogress?.({ loaded: body.size } as ProgressEvent);
    this.onload?.();
  }
  abort() { this.onabort?.(); }
}

function responseSession(uploadId: string, provider = 's3') {
  return {
    uploadId,
    provider,
    objectKey: 'uploads/file.bin',
    bucketName: 'bucket',
    chunkSize: provider === 'kodo' ? 4 * 1024 * 1024 : 2,
    totalChunks: provider === 'kodo' ? 1 : 3,
    received: [],
    publicAccess: false,
    accessStrategy: 'proxy',
  };
}

beforeEach(() => {
  localStorage.clear();
  sentHeaders.length = 0;
  vi.stubGlobal('XMLHttpRequest', SuccessfulXhr);
  const implementation = async (
    op: unknown,
    input?: { params?: Record<string, unknown>; body?: Record<string, unknown> },
  ): Promise<unknown> => {
    if (op === fileContract.directUploadInit) return responseSession('new-upload');
    if (op === fileContract.directUploadStatus) {
      return { uploadId: input?.params?.uploadId, status: 'uploading', chunkSize: 2, totalChunks: 3, received: [0] };
    }
    if (op === fileContract.directUploadPartUrl) {
      const partNumber = input?.params?.partNumber;
      return { partNumber, url: 'https://upload.test/' + partNumber, method: 'PUT', expiresAt: '2026-01-01 00:00:00' };
    }
    if (op === fileContract.directUploadPartAck) return { index: Number(input?.params?.partNumber) - 1, receivedCount: 1 };
    if (op === fileContract.directUploadComplete) return { id: 'managed-file' };
    if (op === fileContract.directUploadAbort) return null;
    throw new Error('Unexpected API operation');
  };
  apiMock.mockImplementation(implementation as typeof api);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('directMultipartUpload', () => {
  it('uploads all parts and completes one multipart session', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'file.bin', { lastModified: 123 });
    const onProgress = vi.fn();
    const result = await directMultipartUpload({ file, storageConfigId: 7, contentHash: 'abc', onProgress });

    expect(result).toEqual({ id: 'managed-file' });
    expect(apiMock.mock.calls.filter(([op]) => op === fileContract.directUploadPartUrl)).toHaveLength(3);
    expect(apiMock.mock.calls.filter(([op]) => op === fileContract.directUploadPartAck)).toHaveLength(3);
    expect(apiMock.mock.calls.at(-1)?.[0]).toBe(fileContract.directUploadComplete);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it('resumes only parts the server has not acknowledged', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'file.bin', { lastModified: 123 });
    const key = scopedStorageKey('direct-multipart-upload:file.bin:5:123:7');
    localStorage.setItem(key, JSON.stringify({
      uploadId: 'existing-upload',
      fileHash: '74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0',
    }));

    await directMultipartUpload({ file, storageConfigId: 7 });

    const partNumbers = apiMock.mock.calls
      .filter(([op]) => op === fileContract.directUploadPartUrl)
      .map(([, input]) => (input as { params: { partNumber: number } }).params.partNumber)
      .sort((a, b) => a - b);
    expect(partNumbers).toEqual([2, 3]);
    expect(apiMock.mock.calls[0]?.[0]).toBe(fileContract.directUploadStatus);
    expect(apiMock.mock.calls.some(([op]) => op === fileContract.directUploadInit)).toBe(false);
  });

  it('starts a fresh session when the selected file content differs from the checkpoint', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'file.bin', { lastModified: 123 });
    const key = scopedStorageKey('direct-multipart-upload:file.bin:5:123:7');
    localStorage.setItem(key, JSON.stringify({ uploadId: 'other-content-upload', fileHash: '0'.repeat(64) }));

    await directMultipartUpload({ file, storageConfigId: 7 });

    expect(apiMock.mock.calls.some(([op, input]) =>
      op === fileContract.directUploadAbort
      && (input as { params: { uploadId: string } }).params.uploadId === 'other-content-upload')).toBe(true);
    expect(apiMock.mock.calls.some(([op]) => op === fileContract.directUploadInit)).toBe(true);
  });

  it('aborts the direct session when the caller is falling back to proxy upload', async () => {
    apiMock.mockImplementation((async (op: unknown, input?: { params?: Record<string, unknown> }) => {
      if (op === fileContract.directUploadInit) return responseSession('fallback-upload');
      if (op === fileContract.directUploadStatus) {
        return { uploadId: input?.params?.uploadId, status: 'uploading', chunkSize: 2, totalChunks: 3, received: [] };
      }
      if (op === fileContract.directUploadPartUrl) {
        return { partNumber: input?.params?.partNumber, url: 'https://upload.test/' + input?.params?.partNumber, method: 'PUT', expiresAt: '2026-01-01 00:00:00' };
      }
      if (op === fileContract.directUploadPartAck) return { index: Number(input?.params?.partNumber) - 1, receivedCount: 1 };
      if (op === fileContract.directUploadComplete) throw new Error('complete failed');
      if (op === fileContract.directUploadAbort) return null;
      throw new Error('Unexpected API operation');
    }) as typeof api);

    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'file.bin', { lastModified: 123 });
    await expect(directMultipartUpload({ file, storageConfigId: 7, contentHash: 'abc', abortOnFailure: true })).rejects.toThrow('complete failed');
    expect(apiMock.mock.calls.some(([op, input]) =>
      op === fileContract.directUploadAbort
      && (input as { params: { uploadId: string } }).params.uploadId === 'fallback-upload')).toBe(true);
    expect(localStorage.getItem(scopedStorageKey('direct-multipart-upload:file.bin:5:123:7'))).toBeNull();
  });

  it('lists resumable uploads from local checkpoints for the active storage config', async () => {
    const key = scopedStorageKey('direct-multipart-upload:archive.zip:104:123:7');
    localStorage.setItem(key, JSON.stringify({ uploadId: 'pending-upload', fileHash: 'f'.repeat(64) }));

    const candidates = await listDirectUploadResumeCandidates(7);

    expect(candidates).toEqual([{
      fileName: 'archive.zip',
      fileSize: 104,
      lastModified: 123,
      receivedParts: 1,
      totalParts: 3,
    }]);
    expect(apiMock.mock.calls.at(-1)?.[0]).toBe(fileContract.directUploadStatus);
  });

  it('sends Content-MD5 on each Kodo v2 block upload', async () => {
    apiMock.mockImplementation((async (op: unknown, input?: { params?: Record<string, unknown> }) => {
      if (op === fileContract.directUploadInit) return responseSession('kodo-upload', 'kodo');
      if (op === fileContract.directUploadPartUrl) {
        return {
          partNumber: input?.params?.partNumber,
          url: 'https://upload.test/kodo',
          method: 'PUT',
          headers: { Authorization: 'UpToken scoped-token', 'Content-Type': 'application/octet-stream' },
          expiresAt: '2026-01-01 00:00:00',
        };
      }
      if (op === fileContract.directUploadPartAck) return { index: 0, receivedCount: 1 };
      if (op === fileContract.directUploadComplete) return { id: 'managed-file' };
      throw new Error('Unexpected API operation');
    }) as typeof api);

    const file = new File([new Uint8Array([1, 2])], 'file.bin', { lastModified: 123 });
    await directMultipartUpload({ file, storageConfigId: 7 });

    expect(sentHeaders).toEqual([expect.objectContaining({ 'Content-MD5': 'DLmI0EKn8o3V/itVs/Wseg==' })]);
  });
});
