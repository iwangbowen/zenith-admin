import { eq, like, and, ne, desc } from 'drizzle-orm';
import { escapeLike } from '../lib/where-helpers';
import { pageOffset } from '../lib/pagination';
import { db } from '../db';
import { tenants, users, departments, roles, positions, tenantPackageMenus } from '../db/schema';
import { streamToExcel, streamToCsv, formatDateTimeForExcel } from '../lib/excel-export';
import { HTTPException } from 'hono/http-exception';
import { clearUserPermissionCache } from '../lib/permissions';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';

export function mapTenant(row: typeof tenants.$inferSelect, packageName: string | null = null) {
  return {
    ...row,
    packageName,
    expireAt: formatNullableDateTime(row.expireAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListTenantsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}

export async function listTenants(q: ListTenantsQuery) {
  const { page = 1, pageSize = 10, keyword, status } = q;
  const conditions = [];
  if (keyword) conditions.push(like(tenants.name, `%${escapeLike(keyword)}%`));
  if (status === 'enabled' || status === 'disabled') conditions.push(eq(tenants.status, status));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(tenants, where),
    db.query.tenants.findMany({
      where,
      orderBy: desc(tenants.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: { package: { columns: { name: true } } },
    }),
  ]);
  const userCounts = await Promise.all(rows.map((r) => db.$count(users, eq(users.tenantId, r.id))));
  return {
    list: rows.map(({ package: pkg, ...row }, i) => ({ ...mapTenant(row, pkg?.name ?? null), userCount: userCounts[i] })),
    total,
    page,
    pageSize,
  };
}

/** 单个租户的用量与统计概览 */
export async function getTenantStats(id: number) {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
    with: { package: { columns: { name: true } } },
  });
  if (!tenant) throw new HTTPException(404, { message: '租户不存在' });

  const [userCount, departmentCount, roleCount, positionCount, packageMenuCount] = await Promise.all([
    db.$count(users, eq(users.tenantId, id)),
    db.$count(departments, eq(departments.tenantId, id)),
    db.$count(roles, eq(roles.tenantId, id)),
    db.$count(positions, eq(positions.tenantId, id)),
    tenant.packageId == null ? Promise.resolve(0) : db.$count(tenantPackageMenus, eq(tenantPackageMenus.packageId, tenant.packageId)),
  ]);

  const daysToExpire = tenant.expireAt
    ? Math.ceil((tenant.expireAt.getTime() - Date.now()) / 86_400_000)
    : null;

  return {
    id: tenant.id,
    name: tenant.name,
    code: tenant.code,
    status: tenant.status,
    userCount,
    maxUsers: tenant.maxUsers ?? null,
    departmentCount,
    roleCount,
    positionCount,
    packageId: tenant.packageId ?? null,
    packageName: tenant.package?.name ?? null,
    packageMenuCount,
    expireAt: formatNullableDateTime(tenant.expireAt),
    daysToExpire,
  };
}

export async function listAllTenants() {
  return db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status }).from(tenants).orderBy(tenants.id);
}

export async function getTenant(id: number) {
  const row = await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
    with: { package: { columns: { name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '租户不存在' });
  const { package: pkg, ...rest } = row;
  return mapTenant(rest, pkg?.name ?? null);
}

interface TenantInput {
  name: string;
  code: string;
  logo?: string;
  contactName?: string;
  contactPhone?: string;
  status: 'enabled' | 'disabled';
  expireAt?: string | null;
  maxUsers?: number | null;
  packageId?: number | null;
  remark?: string;
}

export async function createTenant(data: TenantInput) {
  const [existing] = await db.select().from(tenants).where(eq(tenants.code, data.code)).limit(1);
  if (existing) throw new HTTPException(400, { message: '租户编码已存在' });
  const [row] = await db.insert(tenants).values({ ...data, expireAt: parseDateTimeInput(data.expireAt) }).returning();
  return getTenant(row.id);
}

export async function updateTenant(id: number, data: Partial<TenantInput>) {
  if (data.code) {
    const [dup] = await db.select().from(tenants).where(and(eq(tenants.code, data.code), ne(tenants.id, id))).limit(1);
    if (dup) throw new HTTPException(400, { message: '租户编码已存在' });
  }
  const { expireAt: rawExpireAt, ...rest } = data;
  const values = {
    ...rest,
    ...(rawExpireAt === undefined ? {} : { expireAt: parseDateTimeInput(rawExpireAt) }),
  };
  const [row] = await db.update(tenants).set(values).where(eq(tenants.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '租户不存在' });
  // 租户套餐变更会影响该租户下用户的有效菜单/权限，清空权限缓存使其即时生效。
  if ('packageId' in data) clearUserPermissionCache();
  return getTenant(id);
}

export async function deleteTenant(id: number) {
  const [row] = await db.delete(tenants).where(eq(tenants.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '租户不存在' });
}

export async function getTenantBeforeAudit(id: number) {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!row) return null;
  return mapTenant(row);
}

export async function exportTenants(): Promise<{ stream: ReadableStream; filename: string }> {
  const rows = await db.select().from(tenants).orderBy(desc(tenants.id));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '租户名称', key: 'name', width: 20 },
      { header: '租户编码', key: 'code', width: 16 },
      { header: '联系人', key: 'contactName', width: 14 },
      { header: '联系电话', key: 'contactPhone', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => v === 'enabled' ? '启用' : '禁用' },
      { header: '到期时间', key: 'expireAt', width: 22 },
      { header: '最大用户数', key: 'maxUsers', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, expireAt: formatDateTimeForExcel(r.expireAt), createdAt: formatDateTimeForExcel(r.createdAt), updatedAt: formatDateTimeForExcel(r.updatedAt) })),
    '租户列表',
  );
  return { stream, filename: 'tenants.xlsx' };
}

export async function exportTenantsAsCsv(): Promise<{ stream: ReadableStream; filename: string }> {
  const rows = await db.select().from(tenants).orderBy(desc(tenants.id));
  const stream = streamToCsv(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '租户名称', key: 'name', width: 20 },
      { header: '租户编码', key: 'code', width: 16 },
      { header: '联系人', key: 'contactName', width: 14 },
      { header: '联系电话', key: 'contactPhone', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => v === 'enabled' ? '启用' : '停用' },
      { header: '到期时间', key: 'expireAt', width: 22 },
      { header: '最大用户数', key: 'maxUsers', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, expireAt: formatDateTimeForExcel(r.expireAt), createdAt: formatDateTimeForExcel(r.createdAt), updatedAt: formatDateTimeForExcel(r.updatedAt) })),
  );
  return { stream, filename: 'tenants.csv' };
}
