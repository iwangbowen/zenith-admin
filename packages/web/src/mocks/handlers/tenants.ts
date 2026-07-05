import { http, HttpResponse } from 'msw';
import { mockTenants, getNextTenantId } from '@/mocks/data/tenants';
import { mockTenantPackages } from '@/mocks/data/tenant-packages';
import { mockDateTime } from '@/mocks/utils/date';
import type { Tenant } from '@zenith/shared';

function withPackageName(t: Tenant): Tenant {
  return {
    ...t,
    packageName: t.packageId ? (mockTenantPackages.find((p) => p.id === t.packageId)?.name ?? null) : null,
  };
}

/** 稳定的演示用户数 */
function mockUserCount(t: Tenant): number {
  return ((t.id * 7) % 30) + 2;
}

export const tenantsHandlers = [
  // 租户列表（分页）
  http.get('/api/tenants', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    const filtered = mockTenants.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !t.code.includes(keyword)) return false;
      if (status && t.status !== status) return false;
      return true;
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const list = filtered.slice(start, start + pageSize).map((t) => ({ ...withPackageName(t), userCount: mockUserCount(t) }));

    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 租户用量概览（必须在 /:id 之前不强制，但保持靠前）
  http.get('/api/tenants/:id/stats', ({ params }) => {
    const t = mockTenants.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '租户不存在', data: null });
    const pkg = t.packageId ? mockTenantPackages.find((p) => p.id === t.packageId) : null;
    const expireAt = t.expireAt ?? null;
    const daysToExpire = expireAt
      ? Math.ceil((new Date(expireAt.replace(' ', 'T')).getTime() - Date.now()) / 86_400_000)
      : null;
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        id: t.id, name: t.name, code: t.code, status: t.status,
        userCount: mockUserCount(t), maxUsers: t.maxUsers ?? null,
        departmentCount: 4, roleCount: 3, positionCount: 5,
        packageId: t.packageId ?? null, packageName: pkg?.name ?? null, packageMenuCount: pkg?.menuIds?.length ?? 0,
        expireAt, daysToExpire,
      },
    });
  }),

  // 获取单个租户
  http.get('/api/tenants/:id', ({ params }) => {
    const tenant = mockTenants.find((t) => t.id === Number(params.id));
    if (!tenant) return HttpResponse.json({ code: 404, message: '租户不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: withPackageName(tenant) });
  }),

  // 新增租户（支持初始管理员自动初始化）
  http.post('/api/tenants', async ({ request }) => {
    const body = await request.json() as Partial<Tenant> & { adminUsername?: string; adminPassword?: string; adminEmail?: string };
    const newTenant: Tenant = {
      id: getNextTenantId(),
      name: body.name ?? '',
      code: body.code ?? '',
      logo: body.logo ?? null,
      contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ?? null,
      status: body.status ?? 'enabled',
      expireAt: body.expireAt ?? null,
      maxUsers: body.maxUsers ?? null,
      packageId: body.packageId ?? null,
      remark: body.remark ?? null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockTenants.push(newTenant);
    const initialAdmin = body.adminUsername
      ? {
          username: body.adminUsername,
          email: body.adminEmail || `${body.adminUsername}@${newTenant.code}.tenant`,
          password: body.adminPassword || 'Mock#Passw0rd16',
        }
      : undefined;
    return HttpResponse.json({
      code: 0,
      message: '新增成功',
      data: { ...withPackageName(newTenant), ...(initialAdmin ? { initialAdmin } : {}) },
    });
  }),

  // 更新租户
  http.put('/api/tenants/:id', async ({ params, request }) => {
    const tenant = mockTenants.find((t) => t.id === Number(params.id));
    if (!tenant) return HttpResponse.json({ code: 404, message: '租户不存在', data: null });
    const body = await request.json() as Partial<Tenant>;
    Object.assign(tenant, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: withPackageName(tenant) });
  }),

  // 删除租户
  http.delete('/api/tenants/:id', ({ params }) => {
    const index = mockTenants.findIndex((t) => t.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '租户不存在', data: null });
    mockTenants.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 切换租户
  http.post('/api/auth/switch-tenant', () => {
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        accessToken: 'mock-access-token-switched',
        refreshToken: 'mock-refresh-token-switched',
      },
    });
  }),
];
