import { tenantContract } from '@zenith/shared/identity';
import type { Tenant } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { notFound } from '@/mocks/utils/handlers';
import { mockTenants, getNextTenantId } from '@/mocks/data/tenants';
import { mockTenantPackages } from '@/mocks/data/tenant-packages';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

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
  mock(tenantContract.list, ({ query, ok, paginate }) => {
    const filtered = mockTenants.filter((t) => {
      if (query.keyword && !includesKeyword(query.keyword, t.name, t.code)) return false;
      if (query.status && t.status !== query.status) return false;
      return true;
    });
    const page = paginate(filtered);
    return ok({ ...page, list: page.list.map((t) => ({ ...withPackageName(t), userCount: mockUserCount(t) })) });
  }),

  mock(tenantContract.all, ({ ok }) => ok(mockTenants.map(({ id, name, code, status }) => ({ id, name, code, status })))),

  mock(tenantContract.stats, ({ params, ok }) => {
    const t = requireItem(mockTenants, params.id, '租户不存在');
    const pkg = t.packageId ? mockTenantPackages.find((p) => p.id === t.packageId) : null;
    const expireAt = t.expireAt ?? null;
    const daysToExpire = expireAt
      ? Math.ceil((new Date(expireAt.replace(' ', 'T')).getTime() - Date.now()) / 86_400_000)
      : null;
    return ok({
      id: t.id, name: t.name, code: t.code, status: t.status,
      userCount: mockUserCount(t), maxUsers: t.maxUsers ?? null,
      departmentCount: 4, roleCount: 3, positionCount: 5,
      packageId: t.packageId ?? null, packageName: pkg?.name ?? null, packageFeatureCount: pkg?.features?.length ?? 0,
      expireAt, daysToExpire,
    });
  }),

  mock(tenantContract.detail, ({ params, ok }) => {
    const tenant = mockTenants.find((t) => t.id === params.id);
    return tenant ? ok(withPackageName(tenant)) : notFound('租户不存在');
  }),

  // 新增租户（支持初始管理员自动初始化）
  mock(tenantContract.create, ({ body, ok }) => {
    const newTenant: Tenant = {
      id: getNextTenantId(),
      name: body.name,
      code: body.code,
      logo: body.logo ?? null,
      contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ?? null,
      status: body.status,
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
    return ok({ ...withPackageName(newTenant), ...(initialAdmin ? { initialAdmin } : {}) }, '新增成功');
  }),

  mock(tenantContract.update, ({ params, body, ok }) => {
    const tenant = requireItem(mockTenants, params.id, '租户不存在');
    Object.assign(tenant, body, { updatedAt: mockDateTime() });
    return ok(withPackageName(tenant), '更新成功');
  }),

  mock(tenantContract.remove, ({ params, ok }) => {
    requireItem(mockTenants, params.id, '租户不存在');
    removeByIds(mockTenants, [params.id]);
    return ok(null, '删除成功');
  }),
];
