import { tenantPackageContract } from '@zenith/shared/identity';
import type { TenantPackage } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockTenantPackages, getNextTenantPackageId } from '@/mocks/data/tenant-packages';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

const withFeatureCount = (p: TenantPackage): TenantPackage => ({ ...p, featureCount: (p.features ?? []).length });

export const tenantPackagesHandlers = [
  mock(tenantPackageContract.all, ({ ok }) => ok(mockTenantPackages.map(({ id, name, status }) => ({ id, name, status })))),

  mock(tenantPackageContract.list, ({ query, ok, paginate }) => {
    const filtered = mockTenantPackages.filter((p) => {
      if (query.keyword && !includesKeyword(query.keyword, p.name)) return false;
      if (query.status && p.status !== query.status) return false;
      return true;
    });
    const page = paginate(filtered);
    return ok({ ...page, list: page.list.map(withFeatureCount) });
  }),

  mock(tenantPackageContract.detail, ({ params, ok }) => {
    const pkg = mockTenantPackages.find((p) => p.id === params.id);
    return pkg ? ok(withFeatureCount(pkg)) : notFound('套餐不存在');
  }),

  mock(tenantPackageContract.create, ({ body, ok }) => {
    const newPkg: TenantPackage = {
      id: getNextTenantPackageId(),
      name: body.name,
      status: body.status,
      quotas: body.quotas ?? null,
      remark: body.remark ?? null,
      features: [],
      featureCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockTenantPackages.push(newPkg);
    return ok(newPkg, '创建成功');
  }),

  mock(tenantPackageContract.update, ({ params, body, ok }) => {
    const pkg = mockTenantPackages.find((p) => p.id === params.id);
    if (!pkg) return notFound('套餐不存在');
    Object.assign(pkg, body, { updatedAt: mockDateTime() });
    return ok(withFeatureCount(pkg), '更新成功');
  }),

  mock(tenantPackageContract.assignFeatures, ({ params, body, ok }) => {
    const pkg = mockTenantPackages.find((p) => p.id === params.id);
    if (!pkg) return notFound('套餐不存在');
    pkg.features = body.features;
    pkg.featureCount = pkg.features.length;
    pkg.updatedAt = mockDateTime();
    return ok(null, '功能已更新');
  }),

  // DELETE /batch 必须先于 DELETE /:id 注册
  mock(tenantPackageContract.removeBatch, ({ body, ok }) => {
    for (const id of body.ids) {
      const idx = mockTenantPackages.findIndex((p) => p.id === id);
      if (idx !== -1) mockTenantPackages.splice(idx, 1);
    }
    return ok(null, `已删除 ${body.ids.length} 条记录`);
  }),

  mock(tenantPackageContract.remove, ({ params, ok }) => {
    const idx = mockTenantPackages.findIndex((p) => p.id === params.id);
    if (idx === -1) return notFound('套餐不存在');
    mockTenantPackages.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
