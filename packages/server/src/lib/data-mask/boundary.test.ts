/**
 * 契约路由脱敏边界单测：
 * 响应出口按查看者策略打码（顶层 / 分页 / 嵌套实体）、超管与豁免权限放行、策略停用与类型覆盖、
 * `unmasked` 自视图不打码、写操作拒绝回写脱敏值、缓存失效即时生效、注册表汇总。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import * as z from 'zod';
import { defineContract, idParam, op, paginated, sensitive } from '@zenith/shared/core';

const { dbState, ctx } = vi.hoisted(() => ({
  dbState: { policies: [] as Record<string, unknown>[] },
  ctx: {
    user: null as { userId: number; username: string; roles: string[]; tenantId: number | null } | null,
    permissions: [] as string[],
  },
}));

vi.mock('../../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(dbState.policies).then(resolve, reject),
  };
  return { db: { select: vi.fn(() => chain) }, pgClient: { listen: vi.fn() } };
});
vi.mock('../context', () => ({
  currentUserOrNull: () => ctx.user ?? undefined,
  currentCmsOpenApiAccess: () => undefined,
  hasPermission: async (...codes: string[]) => codes.some((code) => ctx.permissions.includes(code)),
}));
vi.mock('../permissions', () => ({
  isSuperAdmin: (user: { roles: string[]; tenantId?: number | null }) => user.roles.includes('super_admin') && (user.tenantId ?? null) === null,
}));

import { HTTPException } from 'hono/http-exception';
import { defineContractRoute } from '../contract-route';
import { errBody, okBody, validationHook } from '../openapi-schemas';
import { dispatchInvalidation } from '../invalidation-bus';
import { resetPolicyCacheForTest } from './policies';
import { listSensitiveFieldEntries, resetSensitiveFieldRegistryForTest } from './registry';

const contactSchema = z.object({ email: sensitive(z.string().nullable(), 'email') }).meta({ id: 'ProbeContact' });
const personSchema = z.object({
  id: z.int(),
  name: z.string(),
  phone: sensitive(z.string().nullable(), 'phone').optional(),
  contacts: z.array(contactSchema).optional(),
}).meta({ id: 'ProbePerson' });

const probe = defineContract('/api/mask-probe', {
  list: op.get('/', { response: paginated(personSchema), summary: '列表' }),
  detail: op.get('/{id}', { params: idParam, response: personSchema, summary: '详情' }),
  me: op.get('/me', { response: personSchema, summary: '自视图', unmasked: true }),
  update: op.put('/{id}', { params: idParam, body: z.object({ name: z.string().optional(), phone: z.string().optional() }), response: personSchema, summary: '更新' }),
  plain: op.get('/plain', { response: z.object({ ok: z.boolean() }), summary: '无敏感字段' }),
});

const person = { id: 1, name: '张三', phone: '13812341234', contacts: [{ email: 'admin@example.com' }, { email: null }] };

function buildApp() {
  const router = new OpenAPIHono({ defaultHook: validationHook });
  router.openapiRoutes([
    defineContractRoute(probe.list, {
      middleware: [],
      handler: async (c) => c.json(okBody({ list: [person, { id: 2, name: '李四', phone: null }], total: 2, page: 1, pageSize: 10 }), 200),
    }),
    // 静态 /me 必须早于 /{id}
    defineContractRoute(probe.me, { middleware: [], handler: async (c) => c.json(okBody(person), 200) }),
    defineContractRoute(probe.plain, { middleware: [], handler: async (c) => c.json(okBody({ ok: true }), 200) }),
    defineContractRoute(probe.detail, { middleware: [], handler: async (c) => { c.req.valid('param'); return c.json(okBody(person), 200); } }),
    defineContractRoute(probe.update, {
      middleware: [],
      handler: async (c) => c.json(okBody({ ...person, ...c.req.valid('json') }), 200),
    }),
  ] as const);
  const app = new OpenAPIHono();
  app.route(probe.basePath, router);
  // 与 app.ts 一致：HTTPException → 统一错误信封
  app.onError((err, c) => (err instanceof HTTPException ? c.json(errBody(err.message, err.status), err.status) : c.json(errBody('服务器内部错误', 500), 500)));
  return app;
}

async function getData(app: OpenAPIHono, path: string, init?: RequestInit) {
  const res = await app.request(path, init);
  const body = await res.json() as { code: number; message: string; data: unknown };
  return { status: res.status, ...body };
}

describe('契约路由脱敏边界', () => {
  beforeEach(() => {
    dbState.policies = [];
    ctx.user = { userId: 9, username: 'ops', roles: ['ops'], tenantId: null };
    ctx.permissions = [];
    resetPolicyCacheForTest();
    resetSensitiveFieldRegistryForTest();
  });

  it('普通用户：顶层 / 嵌套实体 / 分页列表按契约默认类型打码，未声明字段与 null 不受影响', async () => {
    const app = buildApp();
    const detail = await getData(app, '/api/mask-probe/1');
    expect(detail.data).toEqual({ id: 1, name: '张三', phone: '138****1234', contacts: [{ email: 'ad***@example.com' }, { email: null }] });

    const list = await getData(app, '/api/mask-probe');
    expect((list.data as { list: unknown[] }).list).toEqual([
      { id: 1, name: '张三', phone: '138****1234', contacts: [{ email: 'ad***@example.com' }, { email: null }] },
      { id: 2, name: '李四', phone: null },
    ]);

    // handler 持有的原始对象不能被改写（可能是缓存 / 共享数据）
    expect(person.phone).toBe('13812341234');
  });

  it('平台超管一律明文；租户自建同名角色不算超管', async () => {
    const app = buildApp();
    ctx.user = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
    expect((await getData(app, '/api/mask-probe/1')).data).toEqual(person);

    ctx.user = { userId: 2, username: 'fake', roles: ['super_admin'], tenantId: 7 };
    expect(((await getData(app, '/api/mask-probe/1')).data as { phone: string }).phone).toBe('138****1234');
  });

  it('策略覆盖：豁免权限放行、停用不打码、类型与自定义规则可改；缓存随失效通知即时刷新', async () => {
    const app = buildApp();
    dbState.policies = [
      { id: 1, entity: 'ProbePerson', field: 'phone', maskType: 'custom', customRule: { prefixKeep: 0, suffixKeep: 2, maskChar: '#' }, exemptPermissions: ['probe:phone:view'], enabled: true, remark: null, updatedAt: new Date() },
      { id: 2, entity: 'ProbeContact', field: 'email', maskType: 'email', customRule: null, exemptPermissions: [], enabled: false, remark: null, updatedAt: new Date() },
    ];
    const first = (await getData(app, '/api/mask-probe/1')).data as typeof person;
    expect(first.phone).toBe('#########34');
    expect(first.contacts).toEqual(person.contacts);

    ctx.permissions = ['probe:phone:view'];
    expect(((await getData(app, '/api/mask-probe/1')).data as typeof person).phone).toBe('13812341234');

    // 策略被其他实例改回默认：LISTEN/NOTIFY 失效后立即按新策略打码
    ctx.permissions = [];
    dbState.policies = [];
    expect(((await getData(app, '/api/mask-probe/1')).data as typeof person).phone).toBe('#########34');
    dispatchInvalidation({ topic: 'data_mask_policies', key: null });
    expect(((await getData(app, '/api/mask-probe/1')).data as typeof person).phone).toBe('138****1234');
  });

  it('unmasked 自视图端点与无敏感字段端点原样返回', async () => {
    const app = buildApp();
    expect((await getData(app, '/api/mask-probe/me')).data).toEqual(person);
    expect((await getData(app, '/api/mask-probe/plain')).data).toEqual({ ok: true });
  });

  it('匿名 / 会员端请求（无后台用户）按最严格口径打码', async () => {
    const app = buildApp();
    ctx.user = null;
    expect(((await getData(app, '/api/mask-probe/1')).data as typeof person).phone).toBe('138****1234');
  });

  it('写操作：请求体带脱敏输出的值一律 400，正常值放行且响应同样打码', async () => {
    const app = buildApp();
    const echo = await getData(app, '/api/mask-probe/1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '张三', phone: '138****1234' }),
    });
    expect(echo.status).toBe(400);
    expect(echo.message).toContain('脱敏后的值');

    const ok = await getData(app, '/api/mask-probe/1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '张三', phone: '13900001111' }),
    });
    expect(ok.status).toBe(200);
    expect((ok.data as typeof person).phone).toBe('139****1111');

    // 自定义掩码字符按策略判定
    dbState.policies = [{ id: 1, entity: 'ProbePerson', field: 'phone', maskType: 'custom', customRule: { prefixKeep: 1, suffixKeep: 1, maskChar: '#' }, exemptPermissions: [], enabled: true, remark: null, updatedAt: new Date() }];
    resetPolicyCacheForTest();
    const customEcho = await getData(app, '/api/mask-probe/1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '1#########4' }),
    });
    expect(customEcho.status).toBe(400);
  });

  it('注册表汇总本进程暴露的敏感字段及其操作，unmasked 操作不计入', async () => {
    buildApp();
    const entries = listSensitiveFieldEntries();
    expect(entries.map((e) => e.key)).toEqual(['ProbeContact.email', 'ProbePerson.phone']);
    const phone = entries.find((e) => e.key === 'ProbePerson.phone')!;
    expect(phone.kind).toBe('phone');
    expect(phone.operations).toEqual(['GET /api/mask-probe', 'GET /api/mask-probe/{id}', 'PUT /api/mask-probe/{id}']);
  });
});
