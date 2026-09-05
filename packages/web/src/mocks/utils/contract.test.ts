import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import type { HttpHandler } from 'msw';
import { defineContract, idParam, op, paginated, paginationQuery } from '@zenith/shared/core';
import { mock } from './contract';
import { notFound } from './handlers';

const itemSchema = z.object({ id: z.int(), name: z.string() });
const itemContract = defineContract('/api/items', {
  list: op.get('/', { query: paginationQuery.extend({ keyword: z.string().optional() }), response: paginated(itemSchema), summary: '列表' }),
  detail: op.get('/{id}', { params: idParam, response: itemSchema, summary: '详情' }),
  create: op.post('/', { body: z.object({ name: z.string().min(1, '名称不能为空') }), response: itemSchema, summary: '创建' }),
  clone: op.post('/{id}/clone', { params: idParam, body: z.object({ name: z.string().optional() }), response: itemSchema, summary: '克隆' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除' }),
});

const ORIGIN = window.location.origin;

const store = [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }, { id: 3, name: 'gamma' }];

const handlers: HttpHandler[] = [
  mock(itemContract.list, ({ query, ok, paginate }) =>
    ok(paginate(store.filter((x) => !query.keyword || x.name.includes(query.keyword))))),
  mock(itemContract.detail, ({ params, ok }) => {
    const item = store.find((x) => x.id === params.id);
    return item ? ok(item) : notFound('不存在', { status: 404 });
  }),
  mock(itemContract.create, ({ body, ok }) => ok({ id: 99, name: body.name }, '创建成功')),
  mock(itemContract.clone, ({ params, body, ok }) => ok({ id: params.id + 100, name: body.name ?? 'copy' })),
  mock(itemContract.remove, ({ ok }) => ok(null, '删除成功')),
];

async function call(method: string, path: string, body?: unknown, init?: { json?: boolean }) {
  for (const handler of handlers) {
    const request = new Request(`${ORIGIN}${path}`, {
      method,
      headers: init?.json === false ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await (handler as unknown as {
      run: (args: unknown) => Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `contract-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as { code: number; message: string; data: unknown } };
  }
  return null;
}

describe('mock(op, resolver)', () => {
  it('matches the contract path with :param syntax and coerces path params', async () => {
    const res = await call('GET', '/api/items/2');
    expect(res).toEqual({ status: 200, body: { code: 0, message: 'ok', data: { id: 2, name: 'beta' } } });
  });

  it('parses query with contract defaults and paginates', async () => {
    const res = await call('GET', '/api/items?keyword=e&pageSize=1');
    expect(res?.body.data).toEqual({ list: [{ id: 2, name: 'beta' }], total: 1, page: 1, pageSize: 1 });
    const defaults = await call('GET', '/api/items');
    expect(defaults?.body.data).toMatchObject({ total: 3, page: 1, pageSize: 10 });
  });

  it('rejects invalid params, query and body with 400 like the server', async () => {
    expect((await call('GET', '/api/items/abc'))?.status).toBe(400);
    expect((await call('GET', '/api/items?page=0'))?.status).toBe(400);
    const badBody = await call('POST', '/api/items', { name: '' });
    expect(badBody?.status).toBe(400);
    expect(badBody?.body.message).toContain('名称不能为空');
  });

  it('passes the parsed body to the resolver and wraps the envelope', async () => {
    const res = await call('POST', '/api/items', { name: 'delta' });
    expect(res).toEqual({ status: 200, body: { code: 0, message: '创建成功', data: { id: 99, name: 'delta' } } });
    const removed = await call('DELETE', '/api/items/1');
    expect(removed?.body).toEqual({ code: 0, message: '删除成功', data: null });
  });

  it('treats a request without JSON content-type as an empty body, like the server validator', async () => {
    const noBody = await call('POST', '/api/items/1/clone', undefined, { json: false });
    expect(noBody).toEqual({ status: 200, body: { code: 0, message: 'ok', data: { id: 101, name: 'copy' } } });
    // 必填字段的 schema 对空体同样 400
    expect((await call('POST', '/api/items', undefined, { json: false }))?.status).toBe(400);
    // 带 JSON 头但报文为空 → 非法 JSON → 400
    expect((await call('POST', '/api/items/1/clone'))?.status).toBe(400);
  });

  it('does not match paths outside the contract', async () => {
    expect(await call('GET', '/api/items/1/extra')).toBeNull();
    expect(await call('PATCH', '/api/items/1')).toBeNull();
  });
});
