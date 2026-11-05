/**
 * HTTP 采集入口：全局 onError 里 ≥500 的异常进入异常日志（含脱敏请求快照、路由模板、状态码），
 * 4xx 业务失败不记；500 响应体回传 correlationId；显式采集先于 logger.error 兜底网打标，不会重复记录。
 * 用与 app.ts 相同的 onError 逻辑搭一个最小 hono 应用，store 与设置 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { HTTPException } from 'hono/http-exception';

const mocks = vi.hoisted(() => ({
  recordErrorEventBatch: vi.fn(async (inputs: unknown[]) => inputs.map(() => ({ groupId: 1, isNewGroup: true, count: 1 }))),
  bumpErrorGroupCounts: vi.fn(async () => undefined),
}));

vi.mock('./store', () => ({ recordErrorEventBatch: mocks.recordErrorEventBatch, bumpErrorGroupCounts: mocks.bumpErrorGroupCounts }));
vi.mock('../settings', () => ({ getSettings: async () => { throw new Error('unavailable'); } }));
vi.mock('../context', () => ({ currentUserOrNull: () => ({ userId: 9, username: 'ops', tenantId: 2 }) }));
vi.mock('../member-context', () => ({ currentMemberOrNull: () => undefined }));
vi.mock('../trace-context', () => ({ currentCorrelationId: () => 'trace-from-als' }));
vi.mock('../fatal-handlers', () => ({ isFatalShutdownInProgress: () => false }));
vi.mock('../process-identity', () => ({ PROCESS_HOSTNAME: 'host-a', PROCESS_PID: 1 }));
vi.mock('../../config', () => ({
  config: { nodeEnv: 'production', roles: { label: 'api' }, otel: { enabled: false, serviceVersion: 'test' }, log: { level: 'error', dir: 'logs', maxFiles: 1, pretty: false } },
}));

import logger from '../logger';
import { errBody, internalErrorBody } from '../openapi-schemas';
import { __resetErrorReporterForTests, captureRequestException, flushErrorReporter, startErrorReporter, stopErrorReporter } from './reporter';
import type { ErrorEventInput } from './types';

function buildApp() {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use('*', requestId());
  app.post('/api/probe/:id', async (c) => {
    await c.req.json();
    throw new TypeError('Cannot read properties of undefined');
  });
  app.get('/api/probe/business', () => { throw new HTTPException(400, { message: '参数错误' }); });
  app.get('/api/probe/upstream', () => { throw new HTTPException(502, { message: '上游不可用' }); });
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      if (err.status >= 500) void captureRequestException(err, c, { status: err.status });
      return c.json(errBody(err.message, err.status), err.status);
    }
    void captureRequestException(err, c, { status: 500 });
    logger.error('[Unhandled Error]', err);
    return c.json(internalErrorBody(c.get('requestId')), 500);
  });
  return app;
}

function stored(): ErrorEventInput[] {
  return mocks.recordErrorEventBatch.mock.calls.flatMap((call) => call[0] as ErrorEventInput[]);
}

describe('HTTP 异常采集', () => {
  beforeEach(() => {
    mocks.recordErrorEventBatch.mockClear();
    __resetErrorReporterForTests();
    startErrorReporter();
  });
  afterEach(async () => { await stopErrorReporter(10); });

  it('未捕获异常 → 500 带 correlationId；事件含路由模板 / 状态 / 脱敏请求体，且不被 logger 兜底网重复记录', async () => {
    const res = await buildApp().request('http://localhost/api/probe/42?token=abc&page=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret', 'x-request-id': 'req-abc' },
      body: JSON.stringify({ username: 'alice', password: 'p@ss', nested: { apiKey: 'k' } }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 500, message: '服务器内部错误', data: null, correlationId: 'req-abc' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushErrorReporter();
    const inputs = stored();
    expect(inputs).toHaveLength(1);
    const [input] = inputs;
    expect(input).toMatchObject({ errorType: 'server_exception', level: 'error', message: 'Cannot read properties of undefined', identity: 'u:9' });
    expect(input.event).toMatchObject({ route: '/api/probe/:id', httpStatus: 500, httpMethod: 'POST', errorName: 'TypeError', correlationId: 'trace-from-als', affectedTenantId: 2 });
    const request = (input.event.context as { request: Record<string, unknown> }).request;
    expect(request.headers).toEqual({ 'content-type': 'application/json', 'x-request-id': 'req-abc' });
    expect(request.query).toEqual({ token: '***', page: '1' });
    expect(request.params).toEqual({ id: '42' });
    expect(request.body).toEqual({ username: 'alice', password: '***', nested: { apiKey: '***' } });
  });

  it('HTTPException：4xx 不记，5xx 记', async () => {
    const app = buildApp();
    const bad = await app.request('http://localhost/api/probe/business');
    expect(bad.status).toBe(400);
    const upstream = await app.request('http://localhost/api/probe/upstream');
    expect(upstream.status).toBe(502);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushErrorReporter();
    expect(stored().map((i) => [i.message, i.event.httpStatus])).toEqual([['上游不可用', 502]]);
  });
});
