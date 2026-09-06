import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { tenantPackages, tenantPackageFeatures, tenants, type TenantPackageRow } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { clearUserPermissionCache } from '../../lib/permissions';
import { formatDateTime } from '../../lib/datetime';
import { isLicenseFeatureKey, type TenantPackageQuotas } from '@zenith/shared/licensing';

export function mapTenantPackage(
  row: TenantPackageRow,
  opts?: { features?: string[] },
) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    quotas: row.quotas ?? null,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
    ...(opts?.features === undefined ? {} : { features: opts.features, featureCount: opts.features.length }),
  };
}

/** 先删后插，原子性更新套餐的功能分配（调用方需传入 tx 或 db） */
async function setPackageFeatures(executor: DbExecutor, packageId: number, features: string[]): Promise<void> {
  await executor.delete(tenantPackageFeatures).where(eq(tenantPackageFeatures.packageId, packageId));
  if (features.length > 0) {
    await executor.insert(tenantPackageFeatures).values(features.map((featureKey) => ({ packageId, featureKey })));
  }
}

function normalizeFeatures(features: string[]): string[] {
  const unique = Array.from(new Set(features));
  const invalid = unique.filter((f) => !isLicenseFeatureKey(f));
  if (invalid.length > 0) {
    throw new HTTPException(400, { message: `无效的功能标识：${invalid.join(', ')}` });
  }
  return unique;
}

export interface ListTenantPackagesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

export async function listTenantPackages(q: ListTenantPackagesQuery) {
  const { page = 1, pageSize = 10, keyword, status } = q;
  const conditions = [];
  conditions.push(keywordCondition(keyword, [tenantPackages.name]));
  if (status === 'enabled' || status === 'disabled') conditions.push(eq(tenantPackages.status, status));
  const where = and(...conditions);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(tenantPackages, where),
    rows: () => db.query.tenantPackages.findMany({
      where,
      orderBy: desc(tenantPackages.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: { packageFeatures: { columns: { featureKey: true } } },
    }),
    map: (row) => mapTenantPackage(row, { features: row.packageFeatures.map((f) => f.featureKey) }),
  });
}

export async function listAllTenantPackages() {
  return db
    .select({ id: tenantPackages.id, name: tenantPackages.name, status: tenantPackages.status })
    .from(tenantPackages)
    .orderBy(tenantPackages.id);
}

export async function getTenantPackage(id: number) {
  const row = requireRow(await db.query.tenantPackages.findFirst({
    where: eq(tenantPackages.id, id),
    with: { packageFeatures: { columns: { featureKey: true } } },
  }), '套餐不存在');
  return mapTenantPackage(row, { features: row.packageFeatures.map((f) => f.featureKey) });
}

export async function getTenantPackageBeforeAudit(id: number) {
  const row = await db.query.tenantPackages.findFirst({
    where: eq(tenantPackages.id, id),
    with: { packageFeatures: { columns: { featureKey: true } } },
  });
  if (!row) return null;
  return mapTenantPackage(row, { features: row.packageFeatures.map((f) => f.featureKey) });
}

export async function getTenantPackagesBeforeAudit(ids: number[]) {
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return [];
  const rows = await db.query.tenantPackages.findMany({
    where: inArray(tenantPackages.id, validIds),
    with: { packageFeatures: { columns: { featureKey: true } } },
    orderBy: tenantPackages.id,
  });
  return rows.map((row) => mapTenantPackage(row, { features: row.packageFeatures.map((f) => f.featureKey) }));
}

export async function ensureTenantPackageExists(id: number) {
  const [row] = await db.select().from(tenantPackages).where(eq(tenantPackages.id, id)).limit(1);
  return mapTenantPackage(requireRow(row, '套餐不存在'));
}

interface TenantPackageInput {
  name: string;
  status?: 'enabled' | 'disabled';
  quotas?: TenantPackageQuotas | null;
  remark?: string;
}

export async function createTenantPackage(data: TenantPackageInput) {
  try {
    const [row] = await db.insert(tenantPackages).values(data).returning();
    return mapTenantPackage(row, { features: [] });
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '套餐名称已存在');
  }
}

export async function updateTenantPackage(id: number, data: Partial<TenantPackageInput>) {
  try {
    const [row] = await db.update(tenantPackages).set(data).where(eq(tenantPackages.id, id)).returning();
    requireRow(row, '套餐不存在');
    // 套餐状态（启用/禁用）影响绑定租户的功能集解析（禁用=fail-closed），清空权限缓存即时生效
    await clearUserPermissionCache();
    return getTenantPackage(id);
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '套餐名称已存在');
  }
}

export async function assignTenantPackageFeatures(id: number, features: string[]) {
  await ensureTenantPackageExists(id);
  const normalized = normalizeFeatures(features);
  await db.transaction(async (tx) => {
    await setPackageFeatures(tx, id, normalized);
  });
  // 套餐功能变更会影响绑定该套餐的租户用户的有效菜单/权限，清空权限缓存使其即时生效。
  await clearUserPermissionCache();
}

export async function deleteTenantPackage(id: number) {
  // 在用保护：已绑定租户的套餐不允许删除，防止解绑后套餐功能集静默变为「不限制」（fail-open）
  const bound = await db.$count(tenants, eq(tenants.packageId, id));
  if (bound > 0) {
    throw new HTTPException(409, { message: `该套餐已绑定 ${bound} 个租户，请先解绑或迁移后再删除` });
  }
  const [row] = await db.delete(tenantPackages).where(eq(tenantPackages.id, id)).returning();
  requireRow(row, '套餐不存在');
}

export async function batchDeleteTenantPackages(ids: number[]) {
  if (ids.length === 0) throw new HTTPException(400, { message: '请选择要删除的记录' });
  const bound = await db.$count(tenants, inArray(tenants.packageId, ids));
  if (bound > 0) {
    throw new HTTPException(409, { message: '所选套餐中存在已绑定租户的套餐，请先解绑或迁移后再删除' });
  }
  const deleted = await db.delete(tenantPackages).where(inArray(tenantPackages.id, ids)).returning({ id: tenantPackages.id });
  return deleted.length;
}
