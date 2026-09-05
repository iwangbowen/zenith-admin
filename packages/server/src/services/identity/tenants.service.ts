import { eq, and, ne, desc, count, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import { hashPassword } from '../../lib/password';
import { keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { db } from '../../db';
import { tenants, users, departments, roles, positions, tenantPackageFeatures, menus, userRoles, roleMenus } from '../../db/schema';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import type { DbTransaction } from '../../db/types';
import { HTTPException } from 'hono/http-exception';
import { clearUserPermissionCache } from '../../lib/permissions';
import { validatePassword } from '@zenith/shared/settings';
import { getSettings } from '../../lib/settings';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';

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
  conditions.push(keywordCondition(keyword, [tenants.name]));
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
  // 单条 GROUP BY 聚合各租户用户数：此前按行 `Promise.all(rows.map(db.$count(...)))`
  // 会并发发出 pageSize 条 COUNT（上限 200），单个请求即可占满连接池（默认 max=10）。
  const tenantIds = rows.map((r) => r.id);
  const countRows = tenantIds.length
    ? await db
        .select({ tenantId: users.tenantId, n: count() })
        .from(users)
        .where(inArray(users.tenantId, tenantIds))
        .groupBy(users.tenantId)
    : [];
  // 无用户的租户不会出现在聚合结果中，取值兜底 0
  const userCountMap = new Map(countRows.map((r) => [r.tenantId, r.n]));
  return {
    list: rows.map(({ package: pkg, ...row }) => ({
      ...mapTenant(row, pkg?.name ?? null),
      userCount: userCountMap.get(row.id) ?? 0,
    })),
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

  const [userCount, departmentCount, roleCount, positionCount, packageFeatureCount] = await Promise.all([
    db.$count(users, eq(users.tenantId, id)),
    db.$count(departments, eq(departments.tenantId, id)),
    db.$count(roles, eq(roles.tenantId, id)),
    db.$count(positions, eq(positions.tenantId, id)),
    tenant.packageId == null ? Promise.resolve(0) : db.$count(tenantPackageFeatures, eq(tenantPackageFeatures.packageId, tenant.packageId)),
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
    packageFeatureCount,
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

export interface CreateTenantInput extends TenantInput {
  /** 初始管理员用户名；不传则跳过自动初始化 */
  adminUsername?: string;
  /** 初始管理员密码；不传则自动生成随机强密码并在响应中一次性返回 */
  adminPassword?: string;
  adminNickname?: string;
  adminEmail?: string;
}

/** 生成满足常见密码策略的随机初始密码（大小写+数字+特殊字符，16 位） */
function generateInitialPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%';
  const all = upper + lower + digits + special;
  const pick = (chars: string) => chars[crypto.randomInt(chars.length)];
  const base = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (base.length < 16) base.push(pick(all));
  // Fisher-Yates 打乱，避免固定的字符类别前缀
  for (let i = base.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}

/** 初始角色的菜单授权范围：有套餐时按套餐功能集过滤（featureKey 为空的核心菜单始终授予），否则授权全部启用菜单 */
async function resolveInitialMenuIds(tx: DbTransaction, packageId: number | null | undefined): Promise<number[]> {
  const all = await tx.select({ id: menus.id, featureKey: menus.featureKey }).from(menus).where(eq(menus.status, 'enabled'));
  if (packageId != null) {
    const rows = await tx.select({ featureKey: tenantPackageFeatures.featureKey }).from(tenantPackageFeatures).where(eq(tenantPackageFeatures.packageId, packageId));
    const featureSet = new Set(rows.map((r) => r.featureKey));
    return all.filter((m) => !m.featureKey || featureSet.has(m.featureKey)).map((m) => m.id);
  }
  return all.map((r) => r.id);
}

export const TENANT_ADMIN_ROLE_CODE = 'tenant_admin';

export async function createTenant(data: CreateTenantInput) {
  const { adminUsername, adminPassword, adminNickname, adminEmail, ...tenantData } = data;
  const [existing] = await db.select().from(tenants).where(eq(tenants.code, tenantData.code)).limit(1);
  if (existing) throw new HTTPException(400, { message: '租户编码已存在' });

  let initialPassword: string | undefined;
  if (adminUsername) {
    if (adminPassword) {
      const policy = (await getSettings('identitySecurity')).password;
      const policyError = validatePassword(adminPassword, policy);
      if (policyError) throw new HTTPException(400, { message: `管理员密码不符合策略：${policyError}` });
      initialPassword = adminPassword;
    } else {
      initialPassword = generateInitialPassword();
    }
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(tenants).values({ ...tenantData, expireAt: parseDateTimeInput(tenantData.expireAt) }).returning();
    if (!adminUsername) return { tenant: row, initialAdmin: null };

    // 1) 租户管理员角色（授权套餐菜单，无套餐则全部菜单）
    const [adminRole] = await tx.insert(roles).values({
      name: '租户管理员',
      code: TENANT_ADMIN_ROLE_CODE,
      description: '租户创建时自动初始化的管理员角色',
      status: 'enabled',
      dataScope: 'all',
      tenantId: row.id,
    }).returning();
    const menuIds = await resolveInitialMenuIds(tx, row.packageId);
    if (menuIds.length > 0) {
      await tx.insert(roleMenus).values(menuIds.map((menuId) => ({ roleId: adminRole.id, menuId })));
    }

    // 2) 管理员账号并绑定角色
    const email = adminEmail || `${adminUsername}@${row.code}.tenant`;
    const hashed = await hashPassword(initialPassword!);
    await reserveTenantSeats(tx, row.id);
    const [adminUser] = await tx.insert(users).values({
      username: adminUsername,
      nickname: adminNickname || '租户管理员',
      email,
      password: hashed,
      status: 'enabled',
      tenantId: row.id,
    }).returning();
    await tx.insert(userRoles).values({ userId: adminUser.id, roleId: adminRole.id });

    return { tenant: row, initialAdmin: { username: adminUsername, email, password: initialPassword! } };
  });

  const tenant = await getTenant(created.tenant.id);
  return { ...tenant, ...(created.initialAdmin ? { initialAdmin: created.initialAdmin } : {}) };
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
  if ('packageId' in data) await clearUserPermissionCache();
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
