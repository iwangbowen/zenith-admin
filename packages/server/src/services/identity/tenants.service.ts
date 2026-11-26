import { publishRoleVersion } from './authority-write.service';
import { explicitPermissionCodesForPageIds } from '@zenith/shared/seed/menus';
import { availableNavigation, readPageAccessRows } from '../../lib/page-access';
import { availablePermissionCodes } from './permission-catalog.service';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { eq, and, ne, desc, count, inArray, or } from 'drizzle-orm';
import crypto from 'node:crypto';
import { hashPassword } from '../../lib/password';
import { keywordCondition, buildWhere } from '../../lib/where-helpers';
import type { QueryOutputOf } from '@zenith/shared/core';
import { tenantContract } from '@zenith/shared/identity';
import { pageOffset } from '../../lib/pagination';
import { db } from '../../db';
import { tenants, users, departments, roles, positions, tenantPackageFeatures, userRoles, roleMenus, userSignatures } from '../../db/schema';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import type { DbTransaction } from '../../db/types';
import { HTTPException } from 'hono/http-exception';
import { notifyNavigationPermissionsChanged } from '../../lib/permissions';
import { forceLogoutAllByUsers } from '../../lib/session-manager';
import { isTenantActive } from '../../lib/tenant';
import logger from '../../lib/logger';
import { validatePassword } from '@zenith/shared/settings';
import { getSettings } from '../../lib/settings';
import { formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import { registerRevealSource } from '../../lib/data-mask/reveal';
import { releaseIdentitySignatures } from './user-signature-lifecycle';

export function mapTenant(row: typeof tenants.$inferSelect, packageName: string | null = null) {
  return {
    ...row,
    packageName,
    expireAt: formatNullableDateTime(row.expireAt),
    ...formatTimestamps(row),
  };
}

export type TenantListFilter = Omit<QueryOutputOf<typeof tenantContract.list>, 'page' | 'pageSize'>;

/** 列表与导出共用的筛选条件 */
export function buildTenantsWhere(q: TenantListFilter) {
  return buildWhere(
    keywordCondition(q.keyword, [tenants.name]),
    q.status ? eq(tenants.status, q.status) : undefined,
  );
}

export async function listTenants(q: QueryOutputOf<typeof tenantContract.list>) {
  const { page, pageSize } = q;
  const where = buildTenantsWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(tenants, where),
    rows: async () => {
      const rows = await db.query.tenants.findMany({
        where,
        orderBy: desc(tenants.id),
        limit: pageSize,
        offset: pageOffset(page, pageSize),
        with: { package: { columns: { name: true } } },
      });
      const tenantIds = rows.map((r) => r.id);
      const countRows = tenantIds.length
        ? await db
            .select({ tenantId: users.tenantId, n: count() })
            .from(users)
            .where(inArray(users.tenantId, tenantIds))
            .groupBy(users.tenantId)
        : [];
      const userCountMap = new Map(countRows.map((r) => [r.tenantId, r.n]));
      return rows.map(({ package: pkg, ...row }) => ({
        ...mapTenant(row, pkg?.name ?? null),
        userCount: userCountMap.get(row.id) ?? 0,
      }));
    },
  });
}

/** 单个租户的用量与统计概览 */
export async function getTenantStats(id: number) {
  const tenant = requireRow(await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
    with: { package: { columns: { name: true } } },
  }), '租户不存在');

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
  const row = requireRow(await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
    with: { package: { columns: { name: true } } },
  }), '租户不存在');
  const { package: pkg, ...rest } = row;
  return mapTenant(rest, pkg?.name ?? null);
}

// 按需查看明文（联系电话）：租户管理仅平台管理员可达，路由权限已收口
registerRevealSource('Tenant', (id) => getTenant(id) as Promise<Record<string, unknown>>);

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

async function resolveInitialMenuIds(tx: DbTransaction, tenantId: number): Promise<number[]> {
  const [pages, features] = await Promise.all([readPageAccessRows(tx), getTenantPackageFeatureSet(tenantId, tx)]);
  return availableNavigation(pages, features, false).filter(page => page.type === 'menu').map(page => page.id);
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
    const menuIds = await resolveInitialMenuIds(tx, row.id);
    if (menuIds.length > 0) {
      await tx.insert(roleMenus).values(menuIds.map((menuId) => ({ roleId: adminRole.id, menuId })));
    }
    const codes = await availablePermissionCodes(explicitPermissionCodesForPageIds(menuIds), row.id, tx);
    await publishRoleVersion(tx, adminRole.id, row.id, codes, menuIds);

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
  requireRow(row, '租户不存在');
  // 停用 / 改到已过期：吊销该租户全部用户的在线会话，与「禁用用户」「到期巡检」同一口径——
  // 否则已签发的 access token 只能等鉴权主体校验拒绝，而不是像强制下线那样立即失效
  if ((data.status !== undefined || rawExpireAt !== undefined) && !isTenantActive(row)) {
    await revokeTenantSessions(id);
  }
  // 租户套餐变更会影响该租户下用户的有效菜单/权限，清空权限缓存使其即时生效。
  if ('packageId' in data) await notifyNavigationPermissionsChanged();
  return getTenant(id);
}

/**
 * 吊销某租户下全部用户的在线会话（access token 拉黑 + refresh 授权撤销 + 在线会话删除）。
 * best-effort：会话存储故障只记 error，不阻断租户停用本身。返回被吊销的会话数。
 */
export async function revokeTenantSessions(tenantId: number): Promise<number> {
  try {
    const tenantUsers = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId));
    const tokens = await forceLogoutAllByUsers(tenantUsers.map((u) => u.id));
    return tokens.length;
  } catch (err) {
    logger.error('吊销租户用户会话失败', { tenantId, err });
    return 0;
  }
}

export async function deleteTenant(id: number) {
  await db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id)).for('update').limit(1);
    requireRow(tenant, '租户不存在');
    const tenantUsers = await tx.select({ id: users.id }).from(users).where(eq(users.tenantId, id)).orderBy(users.id).for('update');
    await releaseIdentitySignatures(tx, or(
      eq(userSignatures.tenantId, id),
      tenantUsers.length ? inArray(userSignatures.userId, tenantUsers.map((user) => user.id)) : undefined,
    )!, id);
    await tx.delete(tenants).where(eq(tenants.id, id));
  });
}

export async function getTenantBeforeAudit(id: number) {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!row) return null;
  return mapTenant(row);
}
