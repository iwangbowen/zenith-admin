import { describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';

const seen = vi.hoisted(() => ({ guardCalls: [] as unknown[], platformCalls: [] as unknown[], featureCalls: [] as string[] }));
vi.mock('../middleware/auth', () => ({ authMiddleware: Object.assign(async () => {}, { __name: 'auth' }) }));
vi.mock('../middleware/guard', () => ({
  guard: (options: unknown) => { seen.guardCalls.push(options); return Object.assign(async () => {}, { __name: 'guard' }); },
}));
vi.mock('../middleware/platform-admin', () => ({
  platformAdminOnly: (options: unknown) => { seen.platformCalls.push(options); return Object.assign(async () => {}, { __name: 'platform' }); },
}));
vi.mock('./data-mask/boundary', () => ({ withDataMasking: (_op: unknown, handler: unknown) => handler }));
vi.mock('./licensing', () => ({
  licenseFeatureGate: (feature: string) => { seen.featureCalls.push(feature); return Object.assign(async () => {}, { __name: 'license' }); },
}));

import { defineContract, op } from '@zenith/shared/core';
import { resolveRouteMiddleware } from './contract-route';

const named = (mw: MiddlewareHandler) => (mw as unknown as { __name?: string }).__name ?? 'custom';
const custom = Object.assign(async () => {}, { __name: 'custom' }) as unknown as MiddlewareHandler;
const rate = Object.assign(async () => {}, { __name: 'rate' }) as unknown as MiddlewareHandler;

const contract = defineContract('/api/demo', {
  me: op.get('/me', { access: 'authenticated', summary: '登录即可' }),
  list: op.get('/', { access: { permission: 'system:user:list' }, summary: '权限码' }),
  create: op.post('/', { access: { permission: ['system:user:create', 'system:user:update'] }, audit: '创建', summary: '任一即可 + 审计' }),
  tenants: op.get('/tenants', { access: { permission: 'system:tenant:list', platformOnly: true }, summary: '平台超管 + 权限码' }),
  menus: op.put('/menus', { access: { platformOnly: 'multi-tenant' }, audit: { description: '改菜单', recordBody: false }, summary: '仅多租户下限定平台' }),
  gated: op.get('/gated', { access: 'authenticated', feature: 'drive', summary: '功能门控' }),
  pub: op.get('/pub', { public: true, summary: '公开' }),
  device: op.post('/telemetry', { security: 'device-signature', summary: '设备签名' }),
}, { auditModule: '演示' });

const memberContract = defineContract('/api/member/demo', {
  me: op.get('/me', { summary: '会员自视图' }),
  campaign: op.get('/campaign', { feature: 'growth', summary: '会员营销' }),
}, { security: 'member-bearer' });

describe('resolveRouteMiddleware（契约 access → 门禁链装配）', () => {
  it('非后台令牌操作未声明 feature：保留凭证中间件；preAuth 无意义即报错', () => {
    expect(resolveRouteMiddleware(memberContract.me, { middleware: [custom] }).map(named)).toEqual(['custom']);
    expect(resolveRouteMiddleware(contract.device, { middleware: [custom] }).map(named)).toEqual(['custom']);
    expect(() => resolveRouteMiddleware(memberContract.me, { preAuth: [rate] })).toThrow(/preAuth/);
  });

  it('非 bearer 操作声明 feature：在凭证校验之后追加 License 门控，未知功能仍在装配期拒绝', () => {
    seen.featureCalls.length = 0;
    expect(resolveRouteMiddleware(memberContract.campaign, { middleware: [custom] }).map(named)).toEqual(['custom', 'license']);
    expect(seen.featureCalls).toEqual(['growth']);
    for (const security of ['none', 'member-bearer', 'device-signature', 'open-gateway'] as const) {
      const bad = defineContract('/api/bad-feature', { x: op.get('/', { security, feature: 'no-such-feature', summary: 'x' }) });
      expect(() => resolveRouteMiddleware(bad.x, { middleware: [custom] })).toThrow(/License 功能/);
    }
  });

  it('绕过 defineContract 的裸 bearer 操作缺少 access：装配期报错', () => {
    const bare = { ...op.get('/bare', { summary: 'x' }), name: 'bare', basePath: '/api/demo', fullPath: '/api/demo/bare', tags: [] };
    expect(() => resolveRouteMiddleware(bare as never, {})).toThrow(/缺少 access/);
  });

  it('公开操作不注入认证', () => {
    expect(resolveRouteMiddleware(contract.pub, {}).map(named)).toEqual([]);
  });

  it("'authenticated'：preAuth → auth → 追加中间件，无 guard", () => {
    seen.guardCalls.length = 0;
    expect(resolveRouteMiddleware(contract.me, { preAuth: [rate], middleware: [custom] }).map(named)).toEqual(['rate', 'auth', 'custom']);
    expect(seen.guardCalls).toEqual([]);
  });

  it('权限码：auth → guard({ permission })', () => {
    seen.guardCalls.length = 0;
    expect(resolveRouteMiddleware(contract.list, {}).map(named)).toEqual(['auth', 'guard']);
    expect(seen.guardCalls).toEqual([{ permission: ['system:user:list'] }]);
  });

  it('任一即可数组 + 契约审计（module 取契约组 auditModule）', () => {
    seen.guardCalls.length = 0;
    resolveRouteMiddleware(contract.create, {});
    expect(seen.guardCalls).toEqual([{ permission: ['system:user:create', 'system:user:update'], audit: { description: '创建', module: '演示' } }]);
  });

  it('platformOnly：auth → platformAdminOnly → guard；multi-tenant 形态透传 onlyInMultiTenant', () => {
    seen.guardCalls.length = 0;
    seen.platformCalls.length = 0;
    expect(resolveRouteMiddleware(contract.tenants, {}).map(named)).toEqual(['auth', 'platform', 'guard']);
    expect(seen.platformCalls).toEqual([undefined]);
    expect(resolveRouteMiddleware(contract.menus, {}).map(named)).toEqual(['auth', 'platform', 'guard']);
    expect(seen.platformCalls[1]).toEqual({ onlyInMultiTenant: true });
    // 仅平台限定 + 审计：guard 只带 audit（recordBody: false 透传）
    expect(seen.guardCalls[1]).toEqual({ audit: { description: '改菜单', module: '演示', recordBody: false } });
  });

  it('feature 进入 guard；未登记的功能键在装配期报错', () => {
    seen.guardCalls.length = 0;
    resolveRouteMiddleware(contract.gated, {});
    expect(seen.guardCalls).toEqual([{ feature: 'drive' }]);
    const bad = defineContract('/api/bad', { x: op.get('/', { access: 'authenticated', feature: 'no-such-feature', summary: 'x' }) });
    expect(() => resolveRouteMiddleware(bad.x, {})).toThrow(/License 功能/);
  });

  it('非 bearer 操作声明 access、bearer 操作缺 access 都在契约构造期即被拒绝', () => {
    expect(() => defineContract('/api/bad2', { x: op.get('/', { public: true, access: 'authenticated', summary: 'x' }) })).toThrow(/access 只能声明/);
    expect(() => defineContract('/api/bad3', { x: op.get('/', { summary: 'x' }) })).toThrow(/必须声明 access/);
  });
});
