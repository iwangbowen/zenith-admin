import { eq, and, like, desc, inArray } from 'drizzle-orm';
import { escapeLike } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { tenantPackages, tenantPackageMenus, tenants, type TenantPackageRow } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { clearUserPermissionCache } from '../../lib/permissions';
import { formatDateTime } from '../../lib/datetime';

export function mapTenantPackage(
  row: TenantPackageRow,
  opts?: { menuIds?: number[]; menuCount?: number },
) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
    ...(opts?.menuIds === undefined ? {} : { menuIds: opts.menuIds }),
    ...(opts?.menuCount === undefined ? {} : { menuCount: opts.menuCount }),
  };
}

/** 先删后插，原子性更新套餐的菜单关联（调用方需传入 tx 或 db） */
async function setPackageMenus(executor: DbExecutor, packageId: number, menuIds: number[]): Promise<void> {
  await executor.delete(tenantPackageMenus).where(eq(tenantPackageMenus.packageId, packageId));
  if (menuIds.length > 0) {
    await executor.insert(tenantPackageMenus).values(menuIds.map((menuId) => ({ packageId, menuId })));
  }
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
  if (keyword) conditions.push(like(tenantPackages.name, `%${escapeLike(keyword)}%`));
  if (status === 'enabled' || status === 'disabled') conditions.push(eq(tenantPackages.status, status));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(tenantPackages, where),
    db.query.tenantPackages.findMany({
      where,
      orderBy: desc(tenantPackages.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: { packageMenus: { columns: { menuId: true } } },
    }),
  ]);
  return {
    list: rows.map((row) => mapTenantPackage(row, { menuCount: row.packageMenus.length })),
    total,
    page,
    pageSize,
  };
}

export async function listAllTenantPackages() {
  return db
    .select({ id: tenantPackages.id, name: tenantPackages.name, status: tenantPackages.status })
    .from(tenantPackages)
    .orderBy(tenantPackages.id);
}

export async function getTenantPackage(id: number) {
  const row = await db.query.tenantPackages.findFirst({
    where: eq(tenantPackages.id, id),
    with: { packageMenus: { columns: { menuId: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '套餐不存在' });
  const menuIds = row.packageMenus.map((m) => m.menuId);
  return mapTenantPackage(row, { menuIds, menuCount: menuIds.length });
}

export async function getTenantPackageBeforeAudit(id: number) {
  const row = await db.query.tenantPackages.findFirst({
    where: eq(tenantPackages.id, id),
    with: { packageMenus: { columns: { menuId: true } } },
  });
  if (!row) return null;
  const menuIds = row.packageMenus.map((m) => m.menuId);
  return mapTenantPackage(row, { menuIds, menuCount: menuIds.length });
}

export async function getTenantPackagesBeforeAudit(ids: number[]) {
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return [];
  const rows = await db.query.tenantPackages.findMany({
    where: inArray(tenantPackages.id, validIds),
    with: { packageMenus: { columns: { menuId: true } } },
    orderBy: tenantPackages.id,
  });
  return rows.map((row) => {
    const menuIds = row.packageMenus.map((m) => m.menuId);
    return mapTenantPackage(row, { menuIds, menuCount: menuIds.length });
  });
}

export async function ensureTenantPackageExists(id: number) {
  const [row] = await db.select().from(tenantPackages).where(eq(tenantPackages.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '套餐不存在' });
  return mapTenantPackage(row);
}

interface TenantPackageInput {
  name: string;
  status?: 'enabled' | 'disabled';
  remark?: string;
}

export async function createTenantPackage(data: TenantPackageInput) {
  try {
    const [row] = await db.insert(tenantPackages).values(data).returning();
    return mapTenantPackage(row, { menuIds: [], menuCount: 0 });
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '套餐名称已存在');
  }
}

export async function updateTenantPackage(id: number, data: Partial<TenantPackageInput>) {
  try {
    const [row] = await db.update(tenantPackages).set(data).where(eq(tenantPackages.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '套餐不存在' });
    // 套餐状态（启用/禁用）影响绑定租户的白名单解析（禁用=fail-closed），清空权限缓存即时生效
    clearUserPermissionCache();
    return getTenantPackage(id);
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '套餐名称已存在');
  }
}

export async function assignTenantPackageMenus(id: number, menuIds: number[]) {
  await ensureTenantPackageExists(id);
  await db.transaction(async (tx) => {
    await setPackageMenus(tx, id, menuIds);
  });
  // 套餐菜单变更会影响绑定该套餐的租户用户的有效菜单/权限，清空权限缓存使其即时生效。
  clearUserPermissionCache();
}

export async function deleteTenantPackage(id: number) {
  // 在用保护：已绑定租户的套餐不允许删除，防止解绑后套餐白名单静默变为「不限制」（fail-open）
  const bound = await db.$count(tenants, eq(tenants.packageId, id));
  if (bound > 0) {
    throw new HTTPException(409, { message: `该套餐已绑定 ${bound} 个租户，请先解绑或迁移后再删除` });
  }
  const [row] = await db.delete(tenantPackages).where(eq(tenantPackages.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '套餐不存在' });
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
