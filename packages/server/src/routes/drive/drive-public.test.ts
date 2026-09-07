import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  open: vi.fn(),
}));
vi.mock('../../services/drive/drive-share.service', () => ({
  createDriveShareSession: vi.fn(), getDrivePublicShareMeta: vi.fn(), listDrivePublicChildren: vi.fn(),
  prepareDrivePublicContent: mocks.prepare, openDrivePublicContent: mocks.open, saveFromDriveShare: vi.fn(),
}));
vi.mock('./drive-nodes', () => ({
  binaryResponses: {},
  streamStoredContent: (input: { range: unknown }) => new Response('content', { status: input.range ? 206 : 200 }),
}));
import router from './drive-public';

const prepared = { file: { id: 'file', provider: 'local', size: 100 }, node: { name: 'test.txt' } };
const path = `/shares/${'a'.repeat(48)}/nodes/1/content?session=${'b'.repeat(48)}&download=true`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue(prepared);
  mocks.open.mockResolvedValue({ ...prepared, stored: { stream: new ReadableStream(), contentType: 'text/plain' } });
});

describe('public share content routing', () => {
  it('opens a range exactly once after resolving metadata', async () => {
    const response = await router.request(path, { headers: { range: 'bytes=10-19' } });
    expect(response.status).toBe(206);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(prepared, { start: 10, end: 19 });
  });

  it('does not open or count an invalid range', async () => {
    const response = await router.request(path, { headers: { range: 'bytes=120-130' } });
    expect(response.status).toBe(416);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('opens an ordinary download once', async () => {
    const response = await router.request(path);
    expect(response.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(prepared, null);
  });
});
