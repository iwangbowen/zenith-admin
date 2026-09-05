import { describe, it, expect, expectTypeOf } from 'vitest';
import * as z from 'zod';
import {
  contractOperations,
  defineContract,
  fileField,
  fillPath,
  isMultipart,
  multipart,
  op,
  pathParamNames,
  resourceKeyOf,
  toColonPath,
  type HeadersOf,
  type InputOf,
  type OutputOf,
  type QueryOf,
} from './contract';
import { idParam, paginated, paginationQuery } from './api-schemas';

const itemSchema = z.object({ id: z.int(), name: z.string() }).meta({ id: 'Item' });

const contract = defineContract('/api/items', {
  list: op.get('/', {
    query: paginationQuery.extend({ keyword: z.string().optional() }),
    response: paginated(itemSchema),
    summary: '列表',
  }),
  detail: op.get('/{id}', { params: idParam, response: itemSchema, summary: '详情' }),
  create: op.post('/', { body: z.object({ name: z.string(), status: z.enum(['a', 'b']).default('a') }), response: itemSchema, summary: '创建' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除' }),
  exportFile: op.get('/export', { kind: 'excel', summary: '导出', public: true, tags: ['Export'] }),
  upload: op.post('/upload', { body: multipart(z.object({ file: fileField('文件') })), response: itemSchema, summary: '上传' }),
});

describe('defineContract', () => {
  it('binds base path, full path, name and default tags', () => {
    expect(contract.basePath).toBe('/api/items');
    expect(contract.list.fullPath).toBe('/api/items');
    expect(contract.detail.fullPath).toBe('/api/items/{id}');
    expect(contract.detail.name).toBe('detail');
    expect(contract.detail.tags).toEqual(['Items']);
    expect(contract.exportFile.tags).toEqual(['Export']);
  });

  it('defaults response to null, kind to json and security to bearer', () => {
    expect(contract.remove.response).toBeInstanceOf(z.ZodNull);
    expect(contract.remove.kind).toBe('json');
    expect(contract.remove.public).toBe(false);
    expect(contract.remove.security).toBe('bearer');
    expect(contract.exportFile.kind).toBe('excel');
    expect(contract.exportFile.public).toBe(true);
    expect(contract.exportFile.security).toBe('none');
  });

  it('carries non-bearer credential schemes and rejects public + security together', () => {
    const device = op.post('/telemetry', { summary: '上报', security: 'device-signature' });
    expect(device.security).toBe('device-signature');
    expect(device.public).toBe(false);
    expect(() => op.get('/x', { summary: 'x', public: true, security: 'open-gateway' })).toThrow();
  });

  it('derives PaymentSharing-style tags from nested base paths', () => {
    const nested = defineContract('/api/payment/sharing-orders', { list: op.get('/', { summary: 'x' }) });
    expect(nested.list.tags).toEqual(['PaymentSharingOrders']);
  });

  it('rejects malformed paths', () => {
    expect(() => defineContract('api/items', {})).toThrow();
    expect(() => defineContract('/api/items/', {})).toThrow();
    expect(() => op.get('no-slash', { summary: 'x' })).toThrow();
  });

  it('lists operations without the basePath field', () => {
    expect(contractOperations(contract).map((o) => o.name)).toEqual(['list', 'detail', 'create', 'remove', 'exportFile', 'upload']);
  });

  it('marks multipart bodies', () => {
    expect(isMultipart(contract.upload.body)).toBe(true);
    expect(isMultipart(contract.create.body)).toBe(false);
    expect(isMultipart(undefined)).toBe(false);
  });
});

describe('path helpers', () => {
  it('fills and encodes placeholders', () => {
    expect(fillPath('/api/a/{id}/b/{code}', { id: 3, code: 'x/y' })).toBe('/api/a/3/b/x%2Fy');
    expect(pathParamNames('/api/a/{id}/b/{code}')).toEqual(['id', 'code']);
    expect(toColonPath('/api/a/{id}/b/{code}')).toBe('/api/a/:id/b/:code');
    expect(resourceKeyOf('/api/payment/sharing')).toBe('payment/sharing');
  });

  it('throws on missing params instead of emitting undefined', () => {
    expect(() => fillPath('/api/a/{id}', {})).toThrow(/id/);
    expect(() => fillPath('/api/a/{id}', { id: '' })).toThrow(/id/);
  });
});

describe('type inference', () => {
  it('derives client-side input and output shapes', () => {
    expectTypeOf<InputOf<typeof contract.detail>>().toEqualTypeOf<{ params: { id: number } }>();
    expectTypeOf<QueryOf<typeof contract.list>>().toEqualTypeOf<{ page?: number; pageSize?: number; keyword?: string | undefined }>();
    expectTypeOf<InputOf<typeof contract.create>>().toEqualTypeOf<{ body: { name: string; status?: 'a' | 'b' | undefined } }>();
    expectTypeOf<InputOf<typeof contract.remove>>().toEqualTypeOf<{ params: { id: number } }>();
    expectTypeOf<InputOf<typeof contract.exportFile>>().toEqualTypeOf<EmptyInput>();
    expectTypeOf<OutputOf<typeof contract.detail>>().toEqualTypeOf<{ id: number; name: string }>();
    expectTypeOf<OutputOf<typeof contract.remove>>().toEqualTypeOf<null>();
    expectTypeOf<OutputOf<typeof contract.list>['list']>().toEqualTypeOf<{ id: number; name: string }[]>();
    expectTypeOf<InputOf<typeof contract.upload>>().toEqualTypeOf<{ body: FormData }>();
  });

  it('exposes declared business headers as an input segment', () => {
    const secured = defineContract('/api/refunds', {
      create: op.post('/', {
        headers: z.object({ 'x-idempotency-key': z.string().min(8) }),
        body: z.object({ orderNo: z.string() }),
        response: itemSchema,
        summary: '退款',
      }),
    });
    expect(secured.create.headers?.shape['x-idempotency-key']).toBeDefined();
    expect(contract.create.headers).toBeUndefined();
    expectTypeOf<InputOf<typeof secured.create>>().toEqualTypeOf<{ headers: { 'x-idempotency-key': string }; body: { orderNo: string } }>();
    expectTypeOf<HeadersOf<typeof contract.create>>().toEqualTypeOf<undefined>();
  });
});
