import { eq, like, and, ne, desc } from 'drizzle-orm';
import { db } from '../db';
import { tenants } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { exportToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { AppError } from '../lib/errors';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';

export function mapTenant(row: typeof tenants.$inferSelect) {
  return {
    ...row,
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
  if (keyword) conditions.push(like(tenants.name, `%${keyword}%`));
  if (status === 'active' || status === 'disabled') conditions.push(eq(tenants.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(tenants, where),
    db.select().from(tenants).where(where).orderBy(desc(tenants.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapTenant), total, page, pageSize };
}

export async function listAllTenants() {
  return db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status }).from(tenants).orderBy(tenants.id);
}

export async function getTenant(id: number) {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!row) throw new AppError('租户不存在', 404);
  return mapTenant(row);
}

interface TenantInput {
  name: string;
  code: string;
  logo?: string;
  contactName?: string;
  contactPhone?: string;
  status: 'active' | 'disabled';
  expireAt?: string | null;
  maxUsers?: number | null;
  remark?: string;
}

export async function createTenant(data: TenantInput) {
  const [existing] = await db.select().from(tenants).where(eq(tenants.code, data.code)).limit(1);
  if (existing) throw new AppError('租户编码已存在', 400);
  const [row] = await db.insert(tenants).values({ ...data, expireAt: parseDateTimeInput(data.expireAt) }).returning();
  return mapTenant(row);
}

export async function updateTenant(id: number, data: Partial<TenantInput>) {
  if (data.code) {
    const [dup] = await db.select().from(tenants).where(and(eq(tenants.code, data.code), ne(tenants.id, id))).limit(1);
    if (dup) throw new AppError('租户编码已存在', 400);
  }
  const { expireAt: rawExpireAt, ...rest } = data;
  const values = {
    ...rest,
    ...(rawExpireAt === undefined ? {} : { expireAt: parseDateTimeInput(rawExpireAt) }),
  };
  const [row] = await db.update(tenants).set(values).where(eq(tenants.id, id)).returning();
  if (!row) throw new AppError('租户不存在', 404);
  return mapTenant(row);
}

export async function deleteTenant(id: number) {
  const [row] = await db.delete(tenants).where(eq(tenants.id, id)).returning();
  if (!row) throw new AppError('租户不存在', 404);
}

export async function exportTenants(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const rows = await db.select().from(tenants).orderBy(desc(tenants.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '租户名称', key: 'name', width: 20 },
      { header: '租户编码', key: 'code', width: 16 },
      { header: '联系人', key: 'contactName', width: 14 },
      { header: '联系电话', key: 'contactPhone', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => v === 'active' ? '启用' : '禁用' },
      { header: '到期时间', key: 'expireAt', width: 22 },
      { header: '最大用户数', key: 'maxUsers', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, expireAt: formatDateTimeForExcel(r.expireAt), createdAt: formatDateTimeForExcel(r.createdAt), updatedAt: formatDateTimeForExcel(r.updatedAt) })),
    '租户列表',
  );
  return { buffer, filename: 'tenants.xlsx' };
}
