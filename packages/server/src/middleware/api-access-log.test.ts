import { Hono } from 'hono';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  capture: vi.fn(async (c: Context) => ({ method: c.req.method, url: c.req.url, route: c.req.routePath ?? null, status: null, ip: null, headers: {}, query: c.req.query(), params: null, body: undefined })),
  build: vi.fn((_c: Context, snapshot: Record<string, unknown>) => ({ ...snapshot, responseCode: 200 })),
  enqueue: vi.fn(),
}));

vi.mock('../lib/api-access-log', () => ({
  captureApiAccessRequest: captured.capture,
  buildApiAccessLogEntry: captured.build,
  enqueueApiAccessLog: captured.enqueue,
}));

import { apiAccessLogMiddleware } from './api-access-log';

describe('api access log middleware', () => {
  beforeEach(() => {
    captured.capture.mockClear();
    captured.build.mockClear();
    captured.enqueue.mockClear();
  });

  it('records successful API requests without delaying the response', async () => {
    const app = new Hono();
    app.use('/api/*', apiAccessLogMiddleware);
    app.get('/api/users/:id', (c) => c.json({ ok: true }));

    const response = await app.request('/api/users/7?keyword=alice');

    expect(response.status).toBe(200);
    expect(captured.capture).toHaveBeenCalledOnce();
    expect(captured.build).toHaveBeenCalledOnce();
    expect(captured.enqueue).toHaveBeenCalledWith(expect.objectContaining({ responseCode: 200 }));
  });

  it('still enqueues a record when the downstream handler throws', async () => {
    const app = new Hono();
    app.use('/api/*', apiAccessLogMiddleware);
    app.get('/api/fail', () => { throw new Error('boom'); });
    app.onError((_error, c) => c.json({ ok: false }, 500));

    const response = await app.request('/api/fail');

    expect(response.status).toBe(500);
    expect(captured.enqueue).toHaveBeenCalledOnce();
  });
});

