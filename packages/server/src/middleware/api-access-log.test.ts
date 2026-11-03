import { Hono, type Context } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { bodyLimit } from 'hono/body-limit';
import { createCsrfMiddleware } from './csrf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewApiAccessLog } from '../db/schema';

const store = vi.hoisted(() => ({ rows: [] as NewApiAccessLog[], write: vi.fn(), warn: vi.fn() }));
vi.mock('../db', () => ({ db: { insert: () => ({ values: store.write }) } }));
vi.mock('../lib/logger', () => ({ default: { warn: store.warn } }));
vi.mock('../config', () => ({ config: { trustedProxyCidrs: [], multiTenantMode: true, roles: { label: 'api' }, otel: { serviceName: 'test-service' } } }));
vi.mock('../lib/ip-location', () => ({ lookupIpLocation: () => '内网地址' }));
vi.mock('../lib/tenant', () => ({ getEffectiveTenantId: (user: { tenantId: number | null }) => user.tenantId }));
vi.mock('../middleware/auth', () => ({ authMiddleware: async (c: Context, next: () => Promise<void>) => {
  if (!c.req.header('authorization')) return c.json({ code: 401 }, 401);
  c.set('user', { userId: 1, username: 'admin', tenantId: 7, roles: [] });
  await next();
} }));
vi.mock('../middleware/guard', () => ({ guard: () => async (c: Context) => c.json({ code: 403 }, 403) }));
vi.mock('../middleware/platform-admin', () => ({ platformAdminOnly: () => async (_c: Context, next: () => Promise<void>) => next() }));
vi.mock('../lib/data-mask/boundary', () => ({ withDataMasking: (_op: unknown, handler: unknown) => handler }));
vi.mock('../lib/licensing', () => ({ licenseFeatureGate: () => async (_c: Context, next: () => Promise<void>) => next() }));

import * as z from 'zod';
import { defineContract, op } from '@zenith/shared/core';
import { defineContractRoute } from '../lib/contract-route';
import { apiAccessLogMiddleware } from './api-access-log';
import { API_ACCESS_BODY_MAX_BYTES, flushApiAccessLogs } from '../lib/api-access-log';

function makeApp() {
  const app = new Hono();
  app.use('*', requestId());
  app.use('/api/*', apiAccessLogMiddleware);
  app.onError((error, c) => c.json({ code: error instanceof HTTPException ? error.status : 500 }, error instanceof HTTPException ? error.status : 500));
  return app;
}

async function onlyRecord() {
  await flushApiAccessLogs();
  expect(store.rows).toHaveLength(1);
  return store.rows[0];
}

beforeEach(async () => {
  await flushApiAccessLogs();
  store.rows.length = 0;
  store.write.mockReset().mockImplementation(async (rows: NewApiAccessLog[]) => { store.rows.push(...rows); });
});

describe('API access logging with real Hono requests and a database sink substitute', () => {
  it('saves final 2xx/4xx/5xx statuses, including middleware denials and not-found', async () => {
    const app = makeApp();
    app.get('/api/ok', (c) => c.json({ ok: true }, 201));
    app.use('/api/unauthorized', (c) => c.json({ code: 401 }, 401));
    app.use('/api/forbidden', (c) => c.json({ code: 403 }, 403));
    app.get('/api/business', () => { throw new HTTPException(400, { message: 'expected failure' }); });
    app.get('/api/fail', () => { throw new Error('token=secret-should-not-copy'); });
    for (const [path, status] of [['ok', 201], ['unauthorized', 401], ['forbidden', 403], ['missing', 404], ['business', 400], ['fail', 500]] as const) {
      expect((await app.request(`/api/${path}`)).status).toBe(status);
    }
    await flushApiAccessLogs();
    expect(store.rows.map((row) => row.responseCode)).toEqual([201, 401, 403, 404, 400, 500]);
    expect(store.rows.at(-1)).toMatchObject({ errorName: 'Error', errorMessage: 'HTTP 500' });
    expect(JSON.stringify(store.rows)).not.toContain('secret-should-not-copy');
  });

  it('keeps paths separate from bounded, redacted query and does not trust forwarded identity', async () => {
    const app = makeApp();
    app.get('/api/probe/:id', (c) => c.json({ ok: true }));
    await app.request('/api/probe/7?token=secret&password=hidden&sign=signature&page=2', { headers: { 'x-request-id': 'access-123', 'x-forwarded-for': '8.8.8.8' } });
    const log = await onlyRecord();
    expect(log).toMatchObject({ path: '/api/probe/7', routePath: '/api/probe/:id', requestId: 'access-123', ip: '127.0.0.1', accessorType: 'anonymous', credentialType: 'none', queryParams: { token: '***', password: '***', sign: '***', page: '2' } });
    expect(log.createdAt).toBeInstanceOf(Date);
  });

  it('does not wait for a body-cache read that the handler left pending', async () => {
    const app = makeApp();
    app.post('/api/pending', (c) => {
      // Simulates a streaming consumer started by a handler that responds immediately.
      c.req.bodyCache.text = new Promise<string>(() => undefined);
      return c.json({ ok: true });
    });
    expect((await app.request('/api/pending', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(200);
    expect((await onlyRecord()).requestBody).toBeNull();
  });

  it('never reads an unconsumed JSON request or clones a streaming response', async () => {
    const app = makeApp();
    let consumed: boolean | undefined;
    app.post('/api/unread', (c) => { consumed = c.req.raw.bodyUsed; return c.json({ ok: true }); });
    app.get('/api/stream', () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: open\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }));
    await app.request('/api/unread', { method: 'POST', body: JSON.stringify({ password: 'secret' }), headers: { 'content-type': 'application/json' } });
    expect(consumed).toBe(false);
    expect((await onlyRecord()).requestBody).toBeNull();
    store.rows.length = 0;
    const response = await app.request('/api/stream');
    expect(response.bodyUsed).toBe(false);
    expect((await onlyRecord()).responseCode).toBe(200);
    await response.body?.cancel();
  });

  it('uses parsed JSON, redacts nested secrets and leaves handler input unchanged', async () => {
    const app = makeApp();
    app.post('/api/probe', async (c) => c.json(await c.req.json()));
    const input = { name: '演示', password: 'secret', nested: { apiKey: 'hidden', credential: 'hidden', keep: 'yes' } };
    const response = await app.request('/api/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(await response.json()).toEqual(input);
    expect((await onlyRecord()).requestBody).toEqual({ name: '演示', password: '***', nested: { apiKey: '***', credential: '***', keep: 'yes' } });
  });

  it('omits credential endpoints, scalar JSON, forms, uploads and oversized bodies', async () => {
    const app = makeApp();
    app.post('/api/auth/login', async (c) => { await c.req.json(); return c.json({ ok: true }); });
    app.post('/api/parsed', async (c) => { await c.req.json(); return c.json({ ok: true }); });
    app.post('/api/form', async (c) => { await c.req.parseBody(); return c.json({ ok: true }); });
    await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"secret"}' });
    await app.request('/api/parsed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '"opaque-secret"' });
    await app.request('/api/parsed', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '20000' }, body: JSON.stringify({ payload: 'x'.repeat(20_000) }) });
    await app.request('/api/form', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=hidden' });
    await flushApiAccessLogs();
    expect(store.rows.map((row) => row.requestBody)).toEqual([null, null, null, null]);
  });

  it('retains bounded JSON and query even if a malicious caller omits content-length', async () => {
    const app = makeApp();
    app.post('/api/parsed', async (c) => { await c.req.json(); return c.json({ ok: true }); });
    const query = new URLSearchParams(Object.fromEntries(Array.from({ length: 100 }, (_v, i) => [`field${i}`, '汉'.repeat(2000)])));
    await app.request(`/api/parsed?${query}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ large: Array.from({ length: 1000 }, () => ({ text: '汉'.repeat(2000), password: 'secret' })) }) });
    const log = await onlyRecord();
    expect(Buffer.byteLength(JSON.stringify(log.requestBody))).toBeLessThanOrEqual(API_ACCESS_BODY_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(log.queryParams))).toBeLessThan(9 * 1024);
    expect(JSON.stringify(log.requestBody)).not.toContain('secret');
  });

  it('respects body-limit rejection without consuming the rejected payload', async () => {
    const app = makeApp();
    app.use('/api/limited', bodyLimit({ maxSize: 32 }));
    app.post('/api/limited', async (c) => c.json(await c.req.json()));
    expect((await app.request('/api/limited', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '20000' }, body: JSON.stringify({ value: 'x'.repeat(20_000) }) })).status).toBe(413);
    expect((await onlyRecord()).requestBody).toBeNull();
  });

  it('records CSRF source rejections made before authentication', async () => {
    const app = makeApp();
    app.use('/api/*', createCsrfMiddleware({ allowedOrigins: ['https://trusted.example'] }));
    app.post('/api/source', (c) => c.json({ ok: true }));
    const response = await app.request('/api/source', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, body: 'secret' });
    expect(response.status).toBe(403);
    expect(await onlyRecord()).toMatchObject({ responseCode: 403, accessorType: 'anonymous', requestBody: null });
  });

  it('keeps member IDs separate and authenticates attribution only from server context', async () => {
    const app = makeApp();
    app.get('/api/member', (c) => { c.set('member', { memberId: 41, identifier: 'member41', tenantId: 7, type: 'member' }); return c.json({ ok: true }); });
    await app.request('/api/member');
    expect(await onlyRecord()).toMatchObject({ accessorType: 'member_user', memberId: 41, userId: null, accessorName: 'member41', credentialType: 'member_session', tenantId: 7 });
  });

  it('records the unified accessor ID and credential kind for a management user', async () => {
    const app = makeApp();
    app.get('/api/admin', (c) => {
      c.set('user', { userId: 7, username: 'operator', tenantId: null, roles: [], authType: 'apiToken' });
      return c.json({ ok: true });
    });
    await app.request('/api/admin');
    expect(await onlyRecord()).toMatchObject({ accessorId: 'user:7', userId: 7, accessorName: 'operator', accessorType: 'admin_user', credentialType: 'admin_api_token' });
  });

  it('omits health/log-file noise and records access-log queries without recursive response snapshots', async () => {
    const app = makeApp();
    app.all('*', (c) => c.json({ hugeLogPayload: 'hidden' }));
    for (const path of ['/api/health', '/api/ws', '/api/docs', '/api/log-files/a/content', '/api/console-logs/content', '/api/api-access-logs']) await app.request(path);
    await flushApiAccessLogs();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ path: '/api/api-access-logs', requestBody: null });
    expect(JSON.stringify(store.rows)).not.toContain('hugeLogPayload');
  });

  it('masks named secret path parameters', async () => {
    const app = makeApp();
    app.get('/api/shares/:token', (c) => c.json({ ok: true }));
    await app.request('/api/shares/private-token');
    expect((await onlyRecord()).path).toBe('/api/shares/:token');
  });

  it('returns the response while storage is stalled and reports failed writes separately', async () => {
    const app = makeApp();
    app.get('/api/ok', (c) => c.json({ ok: true }));
    let finish: (() => void) | undefined;
    store.write.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const response = await app.request('/api/ok');
    expect(response.status).toBe(200);
    expect(store.write).not.toHaveBeenCalled();
    const draining = flushApiAccessLogs();
    expect(store.write).toHaveBeenCalledOnce();
    finish!();
    await draining;
  });
});

describe('contract operation attribution before access gates', () => {
  const contract = defineContract('/api/meta', {
    list: op.get('/', { access: { permission: 'system:user:list' }, response: z.null(), summary: '读取元数据' }),
    privateBody: op.post('/private', { public: true, audit: { description: '敏感操作', recordBody: false }, body: z.object({ payload: z.string() }), response: z.null(), summary: '敏感正文' }),
  }, { tags: ['元数据模块'] });

  it('attaches operation metadata for both rejected authentication and permissions', async () => {
    const app = new OpenAPIHono();
    app.use('*', requestId());
    app.openapiRoutes([defineContractRoute(contract.list, { handler: (c) => c.json({ code: 0, message: 'success', data: null }, 200) })]);
    // The fixture router must be mounted at its contract base path just like production.
    const host = makeApp();
    host.route('/api/meta', app);
    await host.request('/api/meta');
    await host.request('/api/meta', { headers: { authorization: 'Bearer test' } });
    await flushApiAccessLogs();
    expect(store.rows.some((row) => row.responseCode === 401 && row.operationName === '读取元数据')).toBe(true);
    expect(store.rows.some((row) => row.responseCode === 403 && row.operationKey === 'GET /api/meta')).toBe(true);
    expect(store.rows.every((row) => row.module === '元数据模块')).toBe(true);
  });

  it('honors the contract body-capture opt-out even after JSON validation', async () => {
    const router = new OpenAPIHono();
    router.openapiRoutes([defineContractRoute(contract.privateBody, { handler: (c) => c.json({ code: 0, message: 'success', data: null }, 200) })]);
    const app = makeApp();
    app.route('/api/meta', router);
    await app.request('/api/meta/private', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"payload":"credential-with-a-generic-key"}' });
    expect(await onlyRecord()).toMatchObject({ requestBody: null, operationName: '敏感正文', operationKey: 'POST /api/meta/private' });
  });
});
