import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { SUPER_ADMIN_CODE } from '@zenith/shared/identity';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { roles, userRoles } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { exactTenantCondition, isPlatformAdmin, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';

/**
 * 平台保留角色编码：超管判定按 code + 平台归属执行。
 * 禁止经 API 创建 / 改名为保留编码（roles.service），也禁止由任何自动建号路径授予（本文件）。
 */
export const RESERVED_ROLE_CODES: ReadonlySet<string> = new Set<string>([SUPER_ADMIN_CODE]);

function roleTenantCondition(tenantId: number | null) {
  return exactTenantCondition(roles.tenantId, tenantId);
}

/** 用户是否绑定平台超管角色（code=super_admin 且角色归属平台） */
export async function userHasPlatformSuperRole(userId: number, executor: DbExecutor = db): Promise<boolean> {
  const [row] = await executor.select({ userId: userRoles.userId }).from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(roles.code, SUPER_ADMIN_CODE), isNull(roles.tenantId)))
    .limit(1);
  return !!row;
}

/** 全部绑定平台超管角色的用户 ID（通讯录同步批量匹配时用于排除候选） */
export async function listPlatformSuperUserIds(executor: DbExecutor = db): Promise<Set<number>> {
  const rows = await executor.select({ userId: userRoles.userId }).from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(roles.code, SUPER_ADMIN_CODE), isNull(roles.tenantId)));
  return new Set(rows.map((r) => r.userId));
}

/**
 * 保存企业身份源 / 通讯录同步源等「自动建号」配置时校验默认角色：
 * ① 非平台管理员只能选择自己租户作用域内可见的角色；
 * ② 角色必须归属目标租户（租户级身份源不得携带平台角色，反之亦然）；
 * ③ 不得包含平台保留角色 —— 该条与调用者身份无关：JIT / SCIM / 目录同步
 *    等自动建号路径永远不能铸造平台超管，需要时由平台管理员手动授予。
 */
export async function assertDefaultRolesGrantable(roleIds: number[], targetTenantId: number | null): Promise<void> {
  const uniq = Array.from(new Set(roleIds));
  if (uniq.length === 0) return;
  const user = currentUser();
  const rows = await db.select({ id: roles.id, code: roles.code, tenantId: roles.tenantId })
    .from(roles).where(buildWhere(
      inArray(roles.id, uniq),
      !isPlatformAdmin(user) ? tenantCondition(roles, user) : undefined,
    ));
  if (rows.length !== uniq.length || rows.some((r) => (r.tenantId ?? null) !== targetTenantId)) {
    throw new HTTPException(400, { message: '默认角色不存在或不属于目标租户' });
  }
  if (rows.some((r) => RESERVED_ROLE_CODES.has(r.code))) {
    throw new HTTPException(400, { message: '自动建号不允许授予平台保留角色，请由平台管理员手动授予' });
  }
}

/**
 * 自动建号落库时再过滤一次默认角色：只保留仍存在、已启用、归属该租户且非保留编码的角色。
 * 配置保存后角色可能被删除 / 禁用，本函数同时兜底存量脏数据；可传入事务执行器在事务内调用。
 */
export async function resolveGrantableDefaultRoleIds(
  roleIds: number[],
  tenantId: number | null,
  executor: DbExecutor = db,
): Promise<number[]> {
  const uniq = Array.from(new Set(roleIds));
  if (uniq.length === 0) return [];
  const rows = await executor.select({ id: roles.id }).from(roles).where(and(
    inArray(roles.id, uniq),
    eq(roles.status, 'enabled'),
    roleTenantCondition(tenantId),
    notInArray(roles.code, [...RESERVED_ROLE_CODES]),
  ));
  return rows.map((r) => r.id);
}
