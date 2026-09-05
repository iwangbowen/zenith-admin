import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import * as z from 'zod';
import { defineContract, fileField, idParam, multipart, op, paginated, paginationQuery } from '@zenith/shared/core';
import { CONTRACT_SECURITY_SCHEMES, defineContractRoute, toRoute } from './contract-route';
import { conflictResponse, okBody, validationHook } from './openapi-schemas';

const itemSchema = z.object({ id: z.int(), name: z.string() }).meta({ id: 'ContractProbeItem' });

const probe = defineContract('/api/contract-probe', {
  list: op.get('/', {
    query: paginationQuery.extend({ keyword: z.string().optional().meta({ description: '关键字' }) }),
    response: paginated(itemSchema),
    summary: '列表',
  }),
  detail: op.get('/{id}', { params: idParam, response: itemSchema, summary: '详情', public: true }),
  create: op.post('/', { body: z.object({ name: z.string().min(1) }), response: itemSchema, summary: '创建' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除', description: '不可恢复' }),
  exportFile: op.get('/export', { kind: 'excel', summary: '导出' }),
  upload: op.post('/upload', { body: multipart(z.object({ file: fileField() })), response: itemSchema, summary: '上传' }),
  refund: op.post('/{id}/refund', {
    params: idParam,
    headers: z.object({ 'x-idempotency-key': z.string().min(8).max(128) }),
    response: itemSchema,
    summary: '退款（幂等）',
  }),
});

const store = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }];

function buildApp() {
  const router = new OpenAPIHono({ defaultHook: validationHook });
  router.openapiRoutes([
    defineContractRoute(probe.list, {
      middleware: [],
      handler: async (c) => {
        const { page, pageSize, keyword } = c.req.valid('query');
        const list = store.filter((x) => !keyword || x.name.includes(keyword));
        return c.json(okBody({ list, total: list.length, page, pageSize }), 200);
      },
    }),
    defineContractRoute(probe.detail, {
      middleware: [],
      handler: async (c) => c.json(okBody(store.find((x) => x.id === c.req.valid('param').id) ?? store[0]), 200),
    }),
    defineContractRoute(probe.create, {
      middleware: [],
      responses: conflictResponse,
      handler: async (c) => c.json(okBody({ id: 3, name: c.req.valid('json').name }, '创建成功'), 200),
    }),
    defineContractRoute(probe.remove, {
      middleware: [],
      handler: async (c) => {
        c.req.valid('param');
        return c.json(okBody(null, '删除成功'), 200);
      },
    }),
    defineContractRoute(probe.refund, {
      middleware: [],
      handler: async (c) => {
        const key = c.req.valid('header')['x-idempotency-key'];
        return c.json(okBody({ id: c.req.valid('param').id, name: key }), 200);
      },
    }),
  ] as const);
  const app = new OpenAPIHono();
  app.route(probe.basePath, router);
  return app;
}

interface Doc {
  paths: Record<string, Record<string, {
    security?: unknown[];
    tags?: string[];
    summary?: string;
    description?: string;
    parameters?: Array<{ name: string; in: string; required?: boolean }>;
    requestBody?: { required?: boolean; content: Record<string, { schema: unknown }> };
    responses: Record<string, { content?: Record<string, { schema: { properties?: Record<string, { $ref?: string; properties?: Record<string, { items?: { $ref?: string } }> }> } }> }>;
  }>>;
  components?: { schemas?: Record<string, unknown> };
}

describe('toRoute', () => {
  it('maps every contract field onto the route config', () => {
    const route = toRoute(probe.detail, { middleware: [] });
    expect(route.method).toBe('get');
    expect(route.path).toBe('/{id}');
    expect(route.tags).toEqual(['ContractProbe']);
    expect(route.security).toEqual([]);
    expect(route.request.params).toBe(idParam);
    expect(Object.keys(route.responses).sort()).toEqual(['200', '400', '401', '403', '404', '500']);
  });

  it('declares Bearer security by default and maps binary kinds to file responses', () => {
    expect(toRoute(probe.list, { middleware: [] }).security).toEqual([{ BearerAuth: [] }]);
    const file = toRoute(probe.exportFile, { middleware: [] });
    expect(Object.keys(file.responses[200].content)).toEqual(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
  });

  it('declares multipart request bodies', () => {
    const upload = toRoute(probe.upload, { middleware: [] });
    expect(Object.keys(upload.request.body.content)).toEqual(['multipart/form-data']);
  });

  it('maps non-bearer credential schemes onto registered securitySchemes', () => {
    const secured = defineContract('/api/contract-probe-secured', {
      telemetry: op.post('/telemetry', { summary: '上报', security: 'device-signature' }),
      ping: op.get('/ping', { summary: 'ping', security: 'open-gateway' }),
    });
    const device = toRoute(secured.telemetry, { middleware: [] });
    expect(device.security).toEqual([{ IotDeviceSignature: [] }]);
    const gateway = toRoute(secured.ping, { middleware: [] });
    expect(gateway.security).toEqual([{ OpenGatewayToken: [] }, { OpenGatewaySignature: [] }]);
    for (const requirement of [...device.security, ...gateway.security]) {
      for (const name of Object.keys(requirement)) expect(name in CONTRACT_SECURITY_SCHEMES).toBe(true);
    }
  });
});

describe('defineContractRoute', () => {
  const app = buildApp();

  it('produces an OpenAPI document that references contract components by meta id', async () => {
    const doc = app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 't', version: '0' } }) as unknown as Doc;
    expect(Object.keys(doc.components?.schemas ?? {})).toContain('ContractProbeItem');

    const detail = doc.paths['/api/contract-probe/{id}'].get;
    expect(detail.security).toEqual([]);
    expect(detail.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true })]);
    expect(detail.responses['200'].content?.['application/json'].schema.properties?.data.$ref).toBe('#/components/schemas/ContractProbeItem');

    const list = doc.paths['/api/contract-probe'].get;
    expect(list.security).toEqual([{ BearerAuth: [] }]);
    expect(list.parameters?.map((p) => p.name)).toEqual(['page', 'pageSize', 'keyword']);
    expect(list.responses['200'].content?.['application/json'].schema.properties?.data.properties?.list.items?.$ref)
      .toBe('#/components/schemas/ContractProbeItem');

    const create = doc.paths['/api/contract-probe'].post;
    expect(create.requestBody?.required).toBe(true);
    expect(Object.keys(create.responses).sort()).toEqual(['200', '400', '401', '403', '404', '409', '500']);

    expect(doc.paths['/api/contract-probe/{id}'].delete.description).toBe('不可恢复');
  });

  it('validates input against the contract and wraps output in the envelope', async () => {
    const ok = await app.request('/api/contract-probe?keyword=tw&pageSize=5');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ code: 0, message: 'success', data: { list: [{ id: 2, name: 'two' }], total: 1, page: 1, pageSize: 5 } });

    const bad = await app.request('/api/contract-probe?page=0');
    expect(bad.status).toBe(400);

    const badBody = await app.request('/api/contract-probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '' }),
    });
    expect(badBody.status).toBe(400);

    const removed = await app.request('/api/contract-probe/1', { method: 'DELETE' });
    expect(await removed.json()).toEqual({ code: 0, message: '删除成功', data: null });
  });

  it('declares and validates business headers', async () => {
    const doc = app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 't', version: '0' } }) as unknown as Doc;
    const refund = doc.paths['/api/contract-probe/{id}/refund'].post;
    expect(refund.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'x-idempotency-key', in: 'header', required: true })]));

    const missing = await app.request('/api/contract-probe/1/refund', { method: 'POST' });
    expect(missing.status).toBe(400);
    const short = await app.request('/api/contract-probe/1/refund', { method: 'POST', headers: { 'x-idempotency-key': 'abc' } });
    expect(short.status).toBe(400);
    const accepted = await app.request('/api/contract-probe/1/refund', { method: 'POST', headers: { 'x-idempotency-key': 'idem-key-0001' } });
    expect(await accepted.json()).toEqual({ code: 0, message: 'success', data: { id: 1, name: 'idem-key-0001' } });
  });
});
