import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadSessionInit } from '@zenith/shared/platform';
import type { BusinessUploadEndpoints } from './business-upload';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/utils/request', () => ({
  request: { post: mocks.post, get: mocks.get, delete: mocks.delete },
}));

const { uploadBusinessFile } = await import('./business-upload');

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = { onprogress: null as ((event: { loaded: number }) => void) | null };
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private headers: Record<string, string> = {};

  constructor() {
    FakeXhr.instances.push(this);
  }

  open() { /* no-op */ }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  getResponseHeader(key: string) { return key.toLowerCase() === 'etag' ? '"fake-etag"' : null; }
  addEventListener() { /* no-op */ }
  abort() { this.onabort?.(); }
  send() {
    this.status = 200;
    this.responseText = '';
    this.upload.onprogress?.({ loaded: 1 });
    this.onload?.();
  }
}

function initSession(mode: 'server-proxy' | 'browser-direct'): UploadSessionInit {
  return {
    uploadId: `u-${mode}`,
    mode,
    chunkSize: 2,
    totalChunks: 2,
    received: [],
  };
}

function baseEndpoints(mode: 'server-proxy' | 'browser-direct', overrides: Partial<BusinessUploadEndpoints<{ id: string }>> = {}) {
  return {
    init: vi.fn().mockResolvedValue(initSession(mode)),
    proxy: {
      chunk: '/proxy/chunk',
      complete: '/proxy/complete',
      status: () => '/proxy/status',
      abort: () => '/proxy/abort',
    },
    direct: {
      partUrl: vi.fn(async (_uploadId: string, partNumber: number) => ({
        partNumber,
        url: `http://stub/part/${partNumber}`,
        method: 'PUT' as const,
        expiresAt: '2026-01-01 00:00:00',
      })),
      partAck: vi.fn(async () => ({ index: 0, receivedCount: 1 })),
      status: vi.fn(async () => ({
        uploadId: `u-${mode}`,
        status: 'uploading' as const,
        chunkSize: 2,
        totalChunks: 2,
        received: [] as number[],
      })),
      complete: vi.fn(async () => ({ id: 'direct-result' })),
      abort: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

describe('uploadBusinessFile', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.post.mockReset();
    mocks.get.mockReset();
    mocks.delete.mockReset();
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  it('uses the server-proxy channel when init returns server-proxy', async () => {
    mocks.post.mockImplementation(async (url: string) => url === '/proxy/complete'
      ? { code: 0, data: { id: 'proxy-result' } }
      : { code: 0, data: { index: 0, receivedCount: 1 } });

    const endpoints = baseEndpoints('server-proxy');
    const result = await uploadBusinessFile<{ id: string }>({
      file: new File(['abcd'], 'proxy.txt'),
      endpoints,
      resumeScope: 'proxy-scope',
    });

    expect(result).toEqual({ id: 'proxy-result' });
    expect(endpoints.init).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(3); // 2 chunks + complete
    expect(endpoints.direct.partUrl).not.toHaveBeenCalled();
  });

  it('uses the browser-direct channel when init returns browser-direct', async () => {
    const endpoints = baseEndpoints('browser-direct');
    const result = await uploadBusinessFile<{ id: string }>({
      file: new File(['abcd'], 'direct.txt'),
      endpoints,
      resumeScope: 'direct-scope',
    });

    expect(result).toEqual({ id: 'direct-result' });
    expect(endpoints.direct.partUrl).toHaveBeenCalledTimes(2);
    expect(endpoints.direct.partAck).toHaveBeenCalledTimes(2);
    expect(endpoints.direct.complete).toHaveBeenCalledWith('u-browser-direct', expect.objectContaining({ contentHash: expect.any(String) }));
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
