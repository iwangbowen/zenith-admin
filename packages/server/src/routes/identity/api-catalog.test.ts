import { gunzipSync } from 'node:zlib';
import { OpenAPIHono } from '@hono/zod-openapi';
import { apiCatalogContract, apiCatalogSchema } from '@zenith/shared/identity';
import { contextStorage } from 'hono/context-storage';
import { sign } from 'hono/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real route, catalog, JWT authentication, and permission guard. Only
// external state is replaced so a cached representation cannot bypass a gate.
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/invalidation-bus', () => ({
  onInvalidate: vi.fn(),
  onInvalidationReset: vi.fn(),
}));
vi.mock('../../lib/session-manager', () => ({
  getTokenRevocation: vi.fn().mockResolvedValue(null),
  touchSession: vi.fn().mockResolvedValue(true),
  registerSession: vi.fn(),
}));
vi.mock('../../lib/subject-liveness', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/subject-liveness')>(),
  loadSubjectRow: vi.fn(),
}));
vi.mock('../../lib/permissions', () => ({
  isSuperAdmin: vi.fn().mockReturnValue(false),
  getUserPermissions: vi.fn(),
}));
vi.mock('../../lib/licensing', () => ({ assertFeatureEnabled: vi.fn() }));

import { config } from '../../config';
import { getUserPermissions } from '../../lib/permissions';
import { getTokenRevocation } from '../../lib/session-manager';
import { loadSubjectRow } from '../../lib/subject-liveness';
import { resetAdminSubjectCache } from '../../middleware/auth';
import apiCatalogRouter from './api-catalog';

const endpoint = '/api/api-catalog';
const cacheControl = 'private, no-cache, no-transform';

function buildApp() {
  const app = new OpenAPIHono();
  app.use('*', contextStorage());
  app.route(endpoint, apiCatalogRouter);
  return app;
}

async function authorization() {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({
    userId: 1,
    username: 'catalog-reader',
    roles: ['operator'],
    tenantId: null,
    jti: 'catalog-test-session',
    iat: now,
    exp: now + 3600,
  }, config.jwtSecret, 'HS256');
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAdminSubjectCache();
  vi.mocked(getTokenRevocation).mockResolvedValue(null);
  vi.mocked(getUserPermissions).mockResolvedValue(['system:access-catalog:view']);
  vi.mocked(loadSubjectRow).mockResolvedValue({
    id: 1,
    username: 'catalog-reader',
    nickname: 'Catalog Reader',
    email: null,
    avatar: null,
    status: 'enabled',
    tenantId: null,
    tenantStatus: null,
    tenantExpireAt: null,
  });
});

describe('GET /api/api-catalog conditional responses', () => {
  it('returns the real catalog in the existing JSON envelope with private cache headers', async () => {
    const response = await buildApp().request(endpoint, { headers: await authorization() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
    expect(response.headers.get('Cache-Control')).toBe(cacheControl);
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
    expect(response.headers.get('ETag')).toMatch(/^"[^"\s]+"$/);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(body.code).toBe(0);
    expect(body.message).toBe('success');
    expect(apiCatalogSchema.safeParse(body.data).success).toBe(true);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items).toContainEqual(expect.objectContaining({
      fullPath: apiCatalogContract.get.fullPath,
      permissions: ['system:access-catalog:view'],
    }));
  });

  it('serves identical catalog content as gzip with a separate strong ETag', async () => {
    const app = buildApp();
    const headers = await authorization();
    const plain = await app.request(endpoint, { headers });
    const compressed = await app.request(endpoint, { headers: { ...headers, 'Accept-Encoding': 'gzip' } });
    const compressedBody = Buffer.from(await compressed.arrayBuffer());

    expect(compressed.status).toBe(200);
    expect(compressed.headers.get('Content-Encoding')).toBe('gzip');
    expect(compressed.headers.get('Vary')).toBe('Accept-Encoding');
    expect(compressed.headers.get('Cache-Control')).toBe(cacheControl);
    expect(compressed.headers.get('ETag')).toMatch(/^"[^"\s]+"$/);
    expect(compressed.headers.get('ETag')).not.toBe(plain.headers.get('ETag'));
    expect(gunzipSync(compressedBody).toString('utf8')).toBe(await plain.text());
  });

  it.each(['identity', 'gzip'])('returns an empty 304 for a matching %s ETag and 200 for an old one', async (encoding) => {
    const app = buildApp();
    const headers = { ...await authorization(), 'Accept-Encoding': encoding };
    const first = await app.request(endpoint, { headers });
    const etag = first.headers.get('ETag')!;
    const unchanged = await app.request(endpoint, { headers: { ...headers, 'If-None-Match': etag } });
    const changed = await app.request(endpoint, { headers: { ...headers, 'If-None-Match': '"previous-release"' } });

    expect(unchanged.status).toBe(304);
    expect(unchanged.body).toBeNull();
    expect(await unchanged.text()).toBe('');
    expect(unchanged.headers.get('ETag')).toBe(etag);
    expect(unchanged.headers.get('Cache-Control')).toBe(cacheControl);
    expect(unchanged.headers.get('Vary')).toBe('Accept-Encoding');
    expect(unchanged.headers.get('Content-Type')).toBeNull();
    expect(changed.status).toBe(200);
    expect(changed.headers.get('ETag')).toBe(etag);
    expect(await changed.arrayBuffer()).toEqual(await first.arrayBuffer());
  });

  it.each([false, true])('still requires authentication after warming the cache (conditional=%s)', async (conditional) => {
    const app = buildApp();
    const warm = await app.request(endpoint, { headers: await authorization() });
    expect(warm.status).toBe(200);
    const response = await app.request(endpoint, {
      headers: conditional ? { 'If-None-Match': warm.headers.get('ETag')! } : {},
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe(401);
    expect(response.headers.get('ETag')).toBeNull();
  });

  it.each([false, true])('checks current permissions after warming the cache (conditional=%s)', async (conditional) => {
    const app = buildApp();
    const headers = await authorization();
    const warm = await app.request(endpoint, { headers });
    expect(warm.status).toBe(200);
    vi.mocked(getUserPermissions).mockResolvedValue([]);
    const response = await app.request(endpoint, {
      headers: { ...headers, ...(conditional ? { 'If-None-Match': warm.headers.get('ETag')! } : {}) },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(403);
    expect(response.headers.get('ETag')).toBeNull();
    expect(getUserPermissions).toHaveBeenCalledTimes(2);
  });

  it('documents the bodyless 304 while retaining the catalog JSON schema for 200', () => {
    const document = buildApp().getOpenAPI31Document({
      openapi: '3.1.0',
      info: { title: 'Catalog test', version: '1' },
    });
    const responses = document.paths?.[endpoint]?.get?.responses;

    expect(responses?.['304']).toEqual({ description: expect.any(String) });
    expect(responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { data: { $ref: '#/components/schemas/ApiCatalog' } },
          },
        },
      },
    });
    expect(document.components?.schemas?.ApiCatalog).toMatchObject({
      type: 'object',
      required: ['items', 'permissionLabels'],
      properties: { items: { type: 'array', items: { $ref: '#/components/schemas/ApiCatalogItem' } } },
    });
  });
});
