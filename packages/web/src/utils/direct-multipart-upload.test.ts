// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileContract } from '@zenith/shared/platform';
import { api } from '@/lib/contract-query';
import { scopedStorageKey } from '@/utils/storage';
import { directMultipartUpload } from './direct-multipart-upload';

vi.mock('@/lib/contract-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/contract-query')>(),
  api: vi.fn(),
}));

const apiMock = vi.mocked(api);

class SuccessfulXhr {
  status = 200;
  responseText = '';
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  url = '';

  open(_method: string, url: string) { this.url = url; }
  setRequestHeader() {}
  getResponseHeader(name: string) { return name.toLowerCase() === 'etag' ? 'part-etag' : null; }
  send(body: Blob) {
    this.upload.onprogress?.({ loaded: body.size } as ProgressEvent);
    this.onload?.();
  }
  abort() { this.onabort?.(); }
}

function responseSession(uploadId: string) {
  return {
    uploadId,
    provider: 's3',
    objectKey: 'uploads/file.bin',
    bucketName: 'bucket',
    chunkSize: 2,
    totalChunks: 3,
    received: [],
    publicAccess: false,
    accessStrategy: 'proxy',
  };
}

beforeEach(() => {
  localStorage.clear();
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
    localStorage.setItem(key, 'existing-upload');

    await directMultipartUpload({ file, storageConfigId: 7 });

    const partNumbers = apiMock.mock.calls
      .filter(([op]) => op === fileContract.directUploadPartUrl)
      .map(([, input]) => (input as { params: { partNumber: number } }).params.partNumber);
    expect(partNumbers).toEqual([2, 3]);
    expect(apiMock.mock.calls[0]?.[0]).toBe(fileContract.directUploadStatus);
    expect(apiMock.mock.calls.some(([op]) => op === fileContract.directUploadInit)).toBe(false);
  });
});
