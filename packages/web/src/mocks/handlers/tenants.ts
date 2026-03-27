import { http, HttpResponse } from 'msw';
import { mockTenants, getNextTenantId } from '@/mocks/data/tenants';
import type { Tenant } from '@zenith/shared';

export const tenantsHandlers = [
  // 租户列表（分页）
  http.get('/api/tenants', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    let filtered = mockTenants.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !t.code.includes(keyword)) return false;
      if (status && t.status !== status) return false;
      return true;
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const list = filtered.slice(start, start + pageSize);

    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 获取单个租户
  http.get('/api/tenants/:id', ({ params }) => {
    const tenant = mockTenants.find((t) => t.id === Number(params.id));
    if (!tenant) return HttpResponse.json({ code: 404, message: '租户不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: tenant });
  }),

  // 新增租户
  http.post('/api/tenants', async ({ request }) => {
    const body = await request.json() as Partial<Tenant>;
    const newTenant: Tenant = {
      id: getNextTenantId(),
      name: body.name ?? '',
      code: body.code ?? '',
      logo: body.logo ?? null,
      contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ?? null,
      status: body.status ?? 'active',
      expireAt: body.expireAt ?? null,
      maxUsers: body.maxUsers ?? null,
      remark: body.remark ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockTenants.push(newTenant);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newTenant });
  }),

  // 更新租户
  http.put('/api/tenants/:id', async ({ params, request }) => {
    const tenant = mockTenants.find((t) => t.id === Number(params.id));
    if (!tenant) return HttpResponse.json({ code: 404, message: '租户不存在', data: null });
    const body = await request.json() as Partial<Tenant>;
    Object.assign(tenant, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: tenant });
  }),

  // 删除租户
  http.delete('/api/tenants/:id', ({ params }) => {
    const index = mockTenants.findIndex((t) => t.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '租户不存在', data: null });
    mockTenants.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 导出
  http.get('/api/tenants/export', () => {
    return new HttpResponse(new Blob(['mock-excel-data']), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });
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
