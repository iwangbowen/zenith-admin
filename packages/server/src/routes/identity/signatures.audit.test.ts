import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { contextStorage } from 'hono/context-storage';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../../lib/context';

const mocks = vi.hoisted(() => ({ log: vi.fn(), get: vi.fn(), before: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('../../db', () => ({ db: { insert: () => ({ values: mocks.log }) } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: async (c: Context, next: Next) => {
  c.set('user', { userId: 7, username: 'owner', tenantId: null, roles: [] });
  await next();
} }));
vi.mock('../../lib/permissions', () => ({ isSuperAdmin: () => false, getUserPermissions: async () => [] }));
vi.mock('../../lib/ip-location', () => ({ lookupIpLocation: () => null }));
// 真实 resolveReportedClient 的语义：自报优先、缺项回退解析（guard 的展示列逐请求调用它）
vi.mock('../../lib/request-helpers', () => ({
  getClientIp: () => '127.0.0.1',
  getPlatformVersion: () => null,
  parseUserAgent: () => ({ browser: 'Test', os: 'Test' }),
  resolveReportedClient: (reported: { browser?: string; os?: string }) => ({ browser: reported.browser ?? 'Test', os: reported.os ?? 'Test' }),
}));
vi.mock('../../lib/data-mask/boundary', () => ({ withDataMasking: (_op: unknown, handler: unknown) => handler }));
vi.mock('../../services/identity/user-signatures.service', () => ({
  getMySignature: mocks.get, getMySignatureAuditMetadata: mocks.before,
  saveMySignature: mocks.save, deleteMySignature: mocks.remove,
}));

import { signatureRoutes } from './signatures';
import { validationHook } from '../../lib/openapi-schemas';

const dataUrl = 'data:image/png;base64,U0lHTkFUVVJFLVNFTlNJVElWRQ==';
const metadata = { id: 11, version: 2, updatedAt: '2026-09-15 14:00:00' };
function app() {
  const router = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  router.use('*', contextStorage());
  router.openapiRoutes(signatureRoutes);
  return router;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.log.mockResolvedValue(undefined);
  mocks.before.mockResolvedValue({ ...metadata, version: 1 });
  mocks.save.mockResolvedValue({ ...metadata, dataUrl });
  mocks.get.mockResolvedValue({ ...metadata, dataUrl });
  mocks.remove.mockResolvedValue(undefined);
});

describe('personal signature routes through the real audit guard', () => {
  it('returns the image to its owner but never writes it into request/response/diff logs', async () => {
    const response = await app().request('/signature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { ...metadata, dataUrl } });
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledTimes(1));
    const logged = mocks.log.mock.calls[0][0];
    expect(logged.requestBody).toBeNull();
    expect(logged.responseBody).toBeNull();
    expect(JSON.parse(logged.beforeData)).toEqual({ ...metadata, version: 1 });
    expect(JSON.parse(logged.afterData)).toEqual(metadata);
    expect(JSON.stringify(logged)).not.toContain(dataUrl);
    expect(JSON.stringify(logged)).not.toContain('dataUrl');
  });
  it('records only old metadata and explicit null after deletion', async () => {
    const response = await app().request('/signature', { method: 'DELETE' });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledTimes(1));
    const logged = mocks.log.mock.calls[0][0];
    expect(JSON.parse(logged.beforeData)).toEqual({ ...metadata, version: 1 });
    expect(JSON.parse(logged.afterData)).toBeNull();
    expect(logged.requestBody).toBeNull();
    expect(logged.responseBody).toBeNull();
    expect(JSON.stringify(logged)).not.toContain('dataUrl');
  });
  it('does not capture rejected image inputs in validation error audit records', async () => {
    const response = await app().request('/signature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: 'https://example.com/private-signature.png' }) });
    expect(response.status).toBe(400);
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledTimes(1));
    expect(mocks.save).not.toHaveBeenCalled();
    const logged = mocks.log.mock.calls[0][0];
    expect(logged.requestBody).toBeNull();
    expect(logged.responseBody).toBeNull();
    expect(logged.afterData).toBeNull();
    expect(JSON.stringify(logged)).not.toContain('private-signature');
  });
});
