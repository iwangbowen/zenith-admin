import { describe, it, expect, beforeEach, vi, expectTypeOf } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as z from 'zod';
import { defineContract, fileField, idParam, multipart, op, paginated, paginationQuery, batchIdsBody } from '@zenith/shared/core';
import {
  ApiRecorder,
  type RecordedCall,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  getCacheEntry,
  isFresh,
} from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { api, apiQueryOptions, contractKey, createResourceQueries, urlOf, useApiMutation } from './contract-query';

const itemSchema = z.object({ id: z.int(), name: z.string() });
const itemContract = defineContract('/api/items', {
  list: op.get('/', { query: paginationQuery.extend({ keyword: z.string().optional() }), response: paginated(itemSchema), summary: '列表' }),
  all: op.get('/all', { response: z.array(itemSchema.pick({ id: true, name: true })), summary: '全部' }),
  detail: op.get('/{id}', { params: idParam, response: itemSchema, summary: '详情' }),
  create: op.post('/', { body: z.object({ name: z.string() }), response: itemSchema, summary: '创建' }),
  update: op.put('/{id}', { params: idParam, body: z.object({ name: z.string().optional() }), response: itemSchema, summary: '更新' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除' }),
  archive: op.post('/{id}/archive', { params: idParam, body: z.object({ reason: z.string() }), summary: '归档' }),
  exportFile: op.get('/export', { kind: 'excel', summary: '导出' }),
  upload: op.post('/upload', { body: multipart(z.object({ file: fileField() })), response: itemSchema, summary: '上传' }),
  refund: op.post('/{id}/refund', {
    params: idParam,
    headers: z.object({ 'x-idempotency-key': z.string().min(8) }),
    body: z.object({ amount: z.number().int() }),
    response: itemSchema,
    summary: '退款（幂等）',
  }),
});

/** UUID 主键资源：id 类型由契约 detail 的路径参数推导 */
const docSchema = z.object({ id: z.string(), title: z.string() });
const docContract = defineContract('/api/docs', {
  list: op.get('/', { query: paginationQuery, response: paginated(docSchema), summary: '列表' }),
  detail: op.get('/{id}', { params: z.object({ id: z.string() }), response: docSchema, summary: '详情' }),
  create: op.post('/', { body: z.object({ title: z.string() }), response: docSchema, summary: '创建' }),
  update: op.put('/{id}', { params: z.object({ id: z.string() }), body: z.object({ title: z.string().optional() }), response: docSchema, summary: '更新' }),
  remove: op.delete('/{id}', { params: z.object({ id: z.string() }), summary: '删除' }),
});

beforeEach(() => {
  recorder.reset();
  recorder
    .on('GET', '/api/items', (call: RecordedCall) => ({ list: [{ id: 1, name: call.url }], total: 1, page: 1, pageSize: 10 }))
    .on('GET', '/api/items/all', [{ id: 1, name: 'one' }])
    .on('GET', /\/api\/items\/\d+$/, (call: RecordedCall) => ({ id: Number(call.url.split('/').pop()), name: 'one' }))
    .on('POST', '/api/items', (call: RecordedCall) => ({ id: 9, ...(call.body as object) }))
    .on('PUT', /\/api\/items\/\d+$/, (call: RecordedCall) => ({ id: Number(call.url.split('/').pop()), ...(call.body as object) }))
    .on('DELETE', /\/api\/items\/\d+$/, null)
    .on('DELETE', '/api/items/batch', null)
    .on('POST', /\/api\/items\/\d+\/archive$/, null)
    .on('POST', /\/api\/items\/\d+\/refund$/, (call: RecordedCall) => ({ id: Number(call.url.split('/').at(-2)), name: call.headers?.['x-idempotency-key'] ?? '' }))
    .on('GET', /\/api\/docs\/[\w-]+$/, (call: RecordedCall) => ({ id: call.url.split('/').pop(), title: 'doc' }))
    .on('DELETE', /\/api\/docs\/[\w-]+$/, null);
});

describe('urlOf / contractKey', () => {
  it('fills path params and appends the query string', () => {
    expect(urlOf(itemContract.detail, { params: { id: 7 } })).toBe('/api/items/7');
    expect(urlOf(itemContract.list, { query: { page: 2, pageSize: 20, keyword: '' } })).toBe('/api/items?page=2&pageSize=20');
    expect(urlOf(itemContract.all)).toBe('/api/items/all');
    // 带 body 的操作只需要 params / query 段即可构造 URL（上传组件、postForm 只消费 URL）
    expect(urlOf(itemContract.upload)).toBe('/api/items/upload');
    expect(urlOf(itemContract.archive, { params: { id: 3 } })).toBe('/api/items/3/archive');
    expect(contractKey(itemContract.detail, { params: { id: 7 } })).toEqual(['items', 'detail', { params: { id: 7 } }]);
    expect(contractKey(itemContract.all)).toEqual(['items', 'all']);
    // 省略 input 得到该操作的公共前缀
    expect(contractKey(itemContract.list)).toEqual(['items', 'list']);
  });
});

describe('api', () => {
  it('sends the method, url and body derived from the contract and unwraps data', async () => {
    const created = await api(itemContract.create, { body: { name: 'new' } });
    expect(created).toEqual({ id: 9, name: 'new' });
    expect(recorder.calls).toEqual([{ method: 'POST', url: '/api/items', body: { name: 'new' } }]);

    recorder.resetCalls();
    await api(itemContract.archive, { params: { id: 3 }, body: { reason: 'x' } });
    expect(recorder.calls).toEqual([{ method: 'POST', url: '/api/items/3/archive', body: { reason: 'x' } }]);

    recorder.resetCalls();
    await api(itemContract.removeBatch, { body: { ids: [1, 2] } });
    expect(recorder.calls).toEqual([{ method: 'DELETE', url: '/api/items/batch', body: { ids: [1, 2] } }]);
  });

  it('accepts request options as the trailing argument', async () => {
    const all = await api(itemContract.all, { silent: true });
    expect(all).toEqual([{ id: 1, name: 'one' }]);
    expect(recorder.calls).toEqual([{ method: 'GET', url: '/api/items/all' }]);
  });

  it('sends contract headers from the input and keeps them out of the query key', async () => {
    const refunded = await api(itemContract.refund, { params: { id: 5 }, headers: { 'x-idempotency-key': 'idem-key-0001' }, body: { amount: 100 } }, { silent: true });
    expect(refunded).toEqual({ id: 5, name: 'idem-key-0001' });
    expect(recorder.calls).toEqual([{ method: 'POST', url: '/api/items/5/refund', body: { amount: 100 }, headers: { 'x-idempotency-key': 'idem-key-0001' } }]);
    expect(contractKey(itemContract.refund, { params: { id: 5 }, headers: { 'x-idempotency-key': 'k' }, body: { amount: 1 } }))
      .toEqual(['items', 'refund', { params: { id: 5 }, body: { amount: 1 } }]);
    expectTypeOf<Parameters<typeof api<typeof itemContract.refund>>[1]>().toEqualTypeOf<{ params: { id: number }; headers: { 'x-idempotency-key': string }; body: { amount: number } }>();
  });

  it('refuses binary operations', async () => {
    await expect(api(itemContract.exportFile)).rejects.toThrow(/excel/);
  });
});

describe('apiQueryOptions', () => {
  it('produces stable keys and a fetching queryFn', async () => {
    const opts = apiQueryOptions(itemContract.detail, { params: { id: 5 } });
    expect(opts.queryKey).toEqual(['items', 'detail', { params: { id: 5 } }]);
    const qc = createTestQueryClient();
    await expect(qc.fetchQuery(opts)).resolves.toEqual({ id: 5, name: 'one' });
  });
});

describe('createResourceQueries', () => {
  const items = createResourceQueries(itemContract);

  it('derives keys from the base path', () => {
    expect(items.keys.all).toEqual(['items']);
    expect(items.keys.lists).toEqual(['items', 'list']);
    expect(items.keys.detail(3)).toEqual(['items', 'detail', 3]);
    expect(items.keys.lookup).toEqual(['items', 'all']);
  });

  it('lists with the query string and fetches details by id', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: items.useList({ page: 1, pageSize: 10, keyword: 'k' }), detail: items.useDetail(4), lookup: items.useLookup() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
    });
    expect(recorder.urls('GET')).toEqual(['/api/items?page=1&pageSize=10&keyword=k', '/api/items/4', '/api/items/all']);
    expect(result.current.detail.data).toEqual({ id: 4, name: 'one' });
  });

  it('saves via POST without id and PUT with id, then invalidates list, detail and lookup', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: items.useList({ page: 1, pageSize: 10 }), detail: items.useDetail(9), lookup: items.useLookup(), save: items.useSave() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.lookup.isSuccess && result.current.detail.isSuccess && result.current.list.isSuccess).toBe(true));
    recorder.resetCalls();

    const created = await result.current.save.mutateAsync({ values: { name: 'a' } });
    expect(created).toEqual({ id: 9, name: 'a' });
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));
    expect(recorder.calls[0]).toEqual({ method: 'POST', url: '/api/items', body: { name: 'a' } });
    expect(recorder.countOf('GET', '/api/items')).toBe(1);
    expect(recorder.countOf('GET', '/api/items/9')).toBe(1);
    expect(recorder.countOf('GET', '/api/items/all')).toBe(1);

    recorder.resetCalls();
    await result.current.save.mutateAsync({ id: 9, values: { name: 'b' } });
    expect(recorder.calls[0]).toEqual({ method: 'PUT', url: '/api/items/9', body: { name: 'b' } });
  });

  it('deletes one by id, many via batch, and drops detail cache entries', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ detail: items.useDetail(2), remove: items.useDelete() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));
    expect(getCacheEntry(qc, items.keys.detail(2))).toBeDefined();
    recorder.resetCalls();

    await result.current.remove.mutateAsync([2]);
    expect(recorder.calls[0]).toEqual({ method: 'DELETE', url: '/api/items/2' });

    recorder.resetCalls();
    await result.current.remove.mutateAsync([3, 4]);
    expect(recorder.calls[0]).toEqual({ method: 'DELETE', url: '/api/items/batch', body: { ids: [3, 4] } });
    expect(isFresh(qc, items.keys.detail(3))).toBe(false);
  });
});

describe('createResourceQueries · 字符串主键', () => {
  const docs = createResourceQueries(docContract);

  it('derives the id type from the detail contract and passes it through', async () => {
    expect(docs.keys.detail('a1')).toEqual(['docs', 'detail', 'a1']);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({ detail: docs.useDetail('a1'), remove: docs.useDelete() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));
    expect(result.current.detail.data).toEqual({ id: 'a1', title: 'doc' });
    recorder.resetCalls();
    await result.current.remove.mutateAsync(['a1']);
    expect(recorder.calls[0]).toEqual({ method: 'DELETE', url: '/api/docs/a1' });
  });
});

describe('createResourceQueries · 无 detail 端点', () => {
  const tagSchema = z.object({ id: z.int(), name: z.string() });
  const tagContract = defineContract('/api/tags', {
    list: op.get('/', { query: paginationQuery, response: paginated(tagSchema), summary: '列表' }),
    all: op.get('/all', { response: z.array(tagSchema), summary: '全部' }),
    create: op.post('/', { body: z.object({ name: z.string() }), response: tagSchema, summary: '创建' }),
    update: op.put('/{id}', { params: idParam, body: z.object({ name: z.string().optional() }), response: tagSchema, summary: '更新' }),
    remove: op.delete('/{id}', { params: idParam, summary: '删除' }),
  });
  const tags = createResourceQueries(tagContract);

  it('derives entity from the list item and id from update params; useDetail is not offered', async () => {
    expectTypeOf(tags.keys.detail).parameter(0).toEqualTypeOf<number | undefined>();
    // @ts-expect-error 契约未声明 detail，工厂不提供 useDetail
    void tags.useDetail;
    recorder.on('GET', '/api/tags', { list: [{ id: 1, name: 't' }], total: 1, page: 1, pageSize: 10 }).on('PUT', '/api/tags/1', { id: 1, name: 'u' });
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({ list: tags.useList({ page: 1, pageSize: 10 }), save: tags.useSave() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const saved = await result.current.save.mutateAsync({ id: 1, values: { name: 'u' } });
    expectTypeOf(saved).toEqualTypeOf<{ id: number; name: string }>();
    expect(saved).toEqual({ id: 1, name: 'u' });
  });
});

describe('useApiMutation', () => {
  it('uses the contract input as mutation variables and runs invalidate on success', async () => {
    const qc = createTestQueryClient();
    const invalidate = vi.fn();
    const { result } = renderHook(() => useApiMutation(itemContract.archive, { invalidate }), { wrapper: createWrapper(qc) });
    await result.current.mutateAsync({ params: { id: 8 }, body: { reason: 'done' } });
    expect(recorder.calls).toEqual([{ method: 'POST', url: '/api/items/8/archive', body: { reason: 'done' } }]);
    expect(invalidate).toHaveBeenCalledWith(qc, null, { params: { id: 8 }, body: { reason: 'done' } });
  });
});
