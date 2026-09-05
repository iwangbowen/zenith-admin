import { eq, and, ne, isNull, inArray, type SQL } from 'drizzle-orm';
import { hashPassword } from '../../lib/password';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { users, userRoles, roles, departments, positions, userPositions, userMenus, userDeptScopes, menus } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import { enabledGroupRolesWith, extractEnabledGroupRoles } from '../../lib/user-group-access';
import { syncUserDynamicMembershipsSafe } from './user-group-rules.service';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { pageOffset } from '../../lib/pagination';
import { getDataScopeCondition } from '../../lib/data-scope';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { validatePassword } from '@zenith/shared/settings';
import { getSettings } from '../../lib/settings';
import { unlockUser as unlockUserSession, batchCheckLoginLock, getOnlineSessions, forceLogoutAllByUsers } from '../../lib/session-manager';
import { streamToExcel, streamToCsv, formatDateTimeForExcel } from '../../lib/excel-export';
import { clearUserPermissionCache } from '../../lib/permissions';
import type { JwtPayload } from '../../middleware/auth';
import type { AlertRecipientUser, User } from '@zenith/shared/identity';
import { currentUser } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { applyEntityMasking } from '../platform/data-mask.service';
import logger from '../../lib/logger';
import { userHasPlatformSuperRole } from './role-grant';

// ─── 关联查询配置 ─────────────────────────────────────────────────────────────

const userRelationConfig = {
  department: { columns: { name: true } },
  userRoles: { columns: {}, with: { role: true } },
  userPositions: { columns: {}, with: { position: true } },
} as const;

type FindManyUsersArgs = NonNullable<Parameters<typeof db.query.users.findMany>[0]>;
type FindFirstUserArgs = NonNullable<Parameters<typeof db.query.users.findFirst>[0]>;

const PROTECTED_ADMIN_USERNAME = 'admin';

function isProtectedAdminUser(username: string) {
  return username.trim().toLowerCase() === PROTECTED_ADMIN_USERNAME;
}

/** 删除/禁用用户后吊销其全部在线会话（best-effort，失败不影响主流程） */
async function revokeUserSessions(userIds: number[]) {
  if (userIds.length === 0) return;
  try {
    await forceLogoutAllByUsers(userIds);
  } catch (err) {
    logger.error('吊销用户会话失败', { userIds, err });
  }
}

async function ensureNoProtectedAdminInIds(ids: number[], action: '删除' | '禁用' | '修改密码') {
  if (ids.length === 0) return;
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(tc ? and(inArray(users.id, ids), tc) : inArray(users.id, ids));

  const adminUser = rows.find((row) => isProtectedAdminUser(row.username));
  if (adminUser) {
    throw new HTTPException(400, { message: `admin 账号不允许${action}` });
  }
}

// ─── 可管理范围校验（租户隔离 + 数据范围，对齐列表查询口径） ─────────────────────

/** 构造「当前操作者可管理的用户」过滤条件；返回 undefined 表示不限制（全量权限） */
async function manageableUsersCondition(): Promise<SQL | undefined> {
  const user = currentUser();
  const conditions: (SQL | undefined)[] = [];
  const tc = tenantCondition(users, user);
  if (tc) conditions.push(tc);
  const scope = await getDataScopeCondition({
    currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: users.id,
  });
  if (scope) conditions.push(scope);
  return buildWhere(...conditions);
}

/** 校验目标用户存在且落在当前操作者可管理范围内（防越权/跨租户 IDOR），返回其租户归属 */
async function ensureUserManageable(userId: number): Promise<{ id: number; tenantId: number | null }> {
  const cond = await manageableUsersCondition();
  const [row] = await db.select({ id: users.id, tenantId: users.tenantId }).from(users)
    .where(cond ? and(eq(users.id, userId), cond) : eq(users.id, userId)).limit(1);
  if (!row) throw new HTTPException(404, { message: '用户不存在或超出数据权限范围' });
  return row;
}

/** 批量版：全部命中才放行（任一目标越权则整体拒绝，避免部分成功掩盖越权尝试） */
async function ensureUsersManageable(userIds: number[]): Promise<void> {
  const uniq = Array.from(new Set(userIds));
  if (uniq.length === 0) return;
  const cond = await manageableUsersCondition();
  const count = await db.$count(users, cond ? and(inArray(users.id, uniq), cond) : inArray(users.id, uniq));
  if (Number(count) !== uniq.length) {
    throw new HTTPException(404, { message: '部分用户不存在或超出数据权限范围' });
  }
}

export async function findUsersWithRelations(config: Omit<FindManyUsersArgs, 'with'> = {}) {
  return db.query.users.findMany({ ...config, with: userRelationConfig });
}

export async function findUserWithRelations(config: Omit<FindFirstUserArgs, 'with'>) {
  return db.query.users.findFirst({ ...config, with: userRelationConfig });
}

export type UserWithRelations = Awaited<ReturnType<typeof findUsersWithRelations>>[number];

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapUser(row: UserWithRelations): User {
  const roleList = row.userRoles.map(({ role: r }) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description ?? undefined,
    dataScope: r.dataScope,
    status: r.status,
    createdAt: formatDateTime(r.createdAt),
    updatedAt: formatDateTime(r.updatedAt),
  }));
  const positionList = row.userPositions.map(({ position: p }) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    sort: p.sort,
    status: p.status,
    remark: p.remark ?? undefined,
    createdAt: formatDateTime(p.createdAt),
    updatedAt: formatDateTime(p.updatedAt),
  }));

  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    email: row.email,
    phone: row.phone ?? undefined,
    gender: row.gender ?? null,
    avatar: row.avatar ?? undefined,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    positionIds: positionList.map((p) => p.id),
    positions: positionList,
    roles: roleList,
    status: row.status,
    passwordUpdatedAt: formatDateTime(row.passwordUpdatedAt),
    lastLoginAt: formatNullableDateTime(row.lastLoginAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  } satisfies User;
}

export function mapUsers(rows: UserWithRelations[]): User[] {
  return rows.map(mapUser);
}

/**
 * 带数据脱敏的用户映射。
 * viewerRoleCodes 传空数组时，所有字段均脱敏（最严格）。
 * 超管角色 ('super_admin') 通常配置在豁免列表中，无需特殊处理。
 */
export async function mapUserWithMask(row: UserWithRelations, viewerRoleCodes: string[]): Promise<User> {
  const base = mapUser(row);
  return applyEntityMasking('user', base as unknown as Record<string, unknown>, viewerRoleCodes) as unknown as User;
}

export async function mapUsersWithMask(rows: UserWithRelations[], viewerRoleCodes: string[]): Promise<User[]> {
  return Promise.all(rows.map((r) => mapUserWithMask(r, viewerRoleCodes)));
}

// ─── 关联关系设置 ─────────────────────────────────────────────────────────────

export async function setUserRoles(executor: DbExecutor, userId: number, roleIds: number[]) {
  await executor.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    await executor.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  }
}

export async function setUserPositions(executor: DbExecutor, userId: number, positionIds: number[]) {
  await executor.delete(userPositions).where(eq(userPositions.userId, userId));
  if (positionIds.length > 0) {
    await executor.insert(userPositions).values(positionIds.map((positionId) => ({ userId, positionId })));
  }
}

// ─── 参照完整性校验（失败时抛出 HTTPException）───────────────────────────────

export async function ensureDepartmentExists(departmentId?: number | null, user?: JwtPayload) {
  if (departmentId === undefined || departmentId === null) return;
  const conditions = [eq(departments.id, departmentId)];
  if (user) {
    const tc = tenantCondition(departments, user);
    if (tc) conditions.push(tc);
  }
  const [d] = await db.select({ id: departments.id }).from(departments).where(and(...conditions)).limit(1);
  if (!d) throw new HTTPException(400, { message: '所属部门不存在' });
}

export async function ensureRoleIdsExist(roleIds: number[], user?: JwtPayload) {
  const uniq = Array.from(new Set(roleIds));
  if (uniq.length === 0) return;
  const conditions = [inArray(roles.id, uniq)];
  if (user) {
    const tc = tenantCondition(roles, user);
    if (tc) conditions.push(tc);
  }
  const rows = await db.select({ id: roles.id }).from(roles).where(and(...conditions));
  if (rows.length !== uniq.length) throw new HTTPException(400, { message: '存在无效角色' });
}

export async function ensurePositionIdsExist(positionIds: number[], user?: JwtPayload) {
  const uniq = Array.from(new Set(positionIds));
  if (uniq.length === 0) return;
  const conditions = [inArray(positions.id, uniq)];
  if (user) {
    const tc = tenantCondition(positions, user);
    if (tc) conditions.push(tc);
  }
  const rows = await db.select({ id: positions.id }).from(positions).where(and(...conditions));
  if (rows.length !== uniq.length) throw new HTTPException(400, { message: '存在无效岗位' });
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

function viewerRoleCodes(): string[] {
  try { return currentUser().roles ?? []; } catch { return []; }
}

export async function listAllUsers() {
  // 与分页列表同一口径：租户隔离 + 数据范围（防止 self/dept 范围用户经 /all 绕过拿全租户名单）
  const cond = await manageableUsersCondition();
  const rawList = await findUsersWithRelations({ where: cond, orderBy: users.id });
  return mapUsersWithMask(rawList, viewerRoleCodes());
}

export async function listAlertRecipientUsers(): Promise<AlertRecipientUser[]> {
  const rows = await db.query.users.findMany({
    columns: {
      id: true,
      username: true,
      nickname: true,
      email: true,
    },
    with: {
      department: { columns: { name: true } },
    },
    where: buildWhere(eq(users.status, 'enabled'), tenantCondition(users, currentUser())),
    orderBy: users.id,
  });
  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    departmentName: user.department?.name ?? null,
    hasEmail: Boolean(user.email),
  }));
}

export interface ListUsersQuery {
  page?: number; pageSize?: number; keyword?: string; phone?: string;
  departmentId?: number; status?: 'enabled' | 'disabled';
  startTime?: string; endTime?: string;
}

export async function buildUsersListWhere(q: ListUsersQuery, user: JwtPayload): Promise<SQL | undefined> {
  const { keyword, phone, departmentId, status, startTime, endTime } = q;
  const conditions: (SQL | undefined)[] = [];
  conditions.push(keywordCondition(keyword, [users.username, users.nickname, users.email]));
  conditions.push(keywordCondition(phone, [users.phone]));
  if (departmentId) conditions.push(eq(users.departmentId, departmentId));
  if (status) conditions.push(eq(users.status, status));
  conditions.push(...dateRangeConditions(users.createdAt, startTime, endTime));
  const scopeCondition = await getDataScopeCondition({
    currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: users.id,
  });
  if (scopeCondition) conditions.push(scopeCondition);
  const tc = tenantCondition(users, user);
  if (tc) conditions.push(tc);
  return buildWhere(...conditions);
}

export async function listUsers(q: ListUsersQuery) {
  const user = currentUser();
  const { page = 1, pageSize = 10 } = q;
  const where = await buildUsersListWhere(q, user);
  const [total, rawList] = await Promise.all([
    db.$count(users, where),
    findUsersWithRelations({ where, limit: pageSize, offset: pageOffset(page, pageSize), orderBy: users.id }),
  ]);
  const lockMap = await batchCheckLoginLock(rawList.map((u) => u.username));
  const onlineSessions = await getOnlineSessions();
  const onlineUserIds = new Set(onlineSessions.map((s) => s.userId));
  const mapped = await mapUsersWithMask(rawList, viewerRoleCodes());
  const list = mapped.map((u) => ({ ...u, isLocked: (lockMap.get(u.username) ?? 0) > 0, isOnline: onlineUserIds.has(u.id) }));
  return { list, total: Number(total), page, pageSize };
}

export interface CreateUserInput {
  username: string; nickname: string; email?: string | null; password: string;
  phone?: string; gender?: string | null; departmentId?: number | null;
  positionIds: number[]; roleIds: number[];
  status: 'enabled' | 'disabled';
}

export async function createUser(data: CreateUserInput) {
  const user = currentUser();
  const policy = (await getSettings('identitySecurity')).password;
  const policyError = validatePassword(data.password, policy);
  if (policyError) throw new HTTPException(400, { message: policyError });
  const { password, roleIds, positionIds, departmentId, ...rest } = data;
  const nextRoleIds = Array.from(new Set(roleIds));
  const nextPositionIds = Array.from(new Set(positionIds));
  await Promise.all([
    ensureDepartmentExists(departmentId, user),
    ensureRoleIdsExist(nextRoleIds, user),
    ensurePositionIdsExist(nextPositionIds, user),
  ]);
  // PostgreSQL NULL != NULL 导致复合唯一约束对 tenantId=NULL 的用户失效，需在应用层显式检查
  const newTenantId = getCreateTenantId(user);
  const tenantFilter = newTenantId === null ? isNull(users.tenantId) : eq(users.tenantId, newTenantId);
  const [dupUsername, dupEmail, dupPhone] = await Promise.all([
    db.select({ id: users.id }).from(users).where(and(eq(users.username, data.username), tenantFilter)).limit(1),
    data.email
      ? db.select({ id: users.id }).from(users).where(and(eq(users.email, data.email), tenantFilter)).limit(1)
      : Promise.resolve([] as { id: number }[]),
    data.phone
      ? db.select({ id: users.id }).from(users).where(and(eq(users.phone, data.phone), tenantFilter)).limit(1)
      : Promise.resolve([] as { id: number }[]),
  ]);
  if (dupUsername.length > 0) throw new HTTPException(400, { message: '用户名已存在' });
  if (dupEmail.length > 0) throw new HTTPException(400, { message: '邮箱已存在' });
  if (dupPhone.length > 0) throw new HTTPException(400, { message: '手机号已存在' });
  const hashedPassword = await hashPassword(password);
  try {
    const created = await db.transaction(async (tx) => {
      // 席位校验必须与插入同事务（advisory lock 串行化，消灭 check-then-insert 竞态）
      await reserveTenantSeats(tx, newTenantId);
      const [u] = await tx.insert(users).values({
        ...rest,
        password: hashedPassword,
        departmentId: departmentId ?? null,
        tenantId: getCreateTenantId(user),
      }).returning();
      await setUserRoles(tx, u.id, nextRoleIds);
      await setUserPositions(tx, u.id, nextPositionIds);
      return u;
    });
    const full = await findUserWithRelations({ where: eq(users.id, created.id) });
    if (!full) throw new HTTPException(500, { message: '创建用户后回读失败' });
    syncUserDynamicMembershipsSafe([created.id], '管理端创建用户');
    return mapUser(full);
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '用户名、邮箱或手机号已存在');
  }
}

export async function batchDeleteUsers(ids: number[]) {
  const user = currentUser();
  if (ids.length === 0) throw new HTTPException(400, { message: '请选择要删除的用户' });
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new HTTPException(400, { message: '用户ID格式无效' });
  if (validIds.includes(user.userId)) throw new HTTPException(400, { message: '不允许删除当前登录账号' });
  await ensureUsersManageable(validIds);
  const tc = tenantCondition(users, user);
  await ensureNoProtectedAdminInIds(validIds, '删除');
  const deleted = await db.delete(users)
    .where(tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds))
    .returning({ id: users.id });
  await revokeUserSessions(deleted.map((r) => r.id));
  return deleted.length;
}

export async function batchUpdateUserStatus(ids: number[], status: 'enabled' | 'disabled') {
  const user = currentUser();
  if (ids.length === 0) throw new HTTPException(400, { message: '请选择要操作的用户' });
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  await ensureUsersManageable(validIds);
  const tc = tenantCondition(users, user);
  if (status === 'disabled') {
    if (validIds.includes(user.userId)) throw new HTTPException(400, { message: '不允许禁用当前登录账号' });
    await ensureNoProtectedAdminInIds(validIds, '禁用');
  }
  const updated = await db.update(users).set({ status })
    .where(tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds))
    .returning({ id: users.id });
  if (status === 'disabled') {
    await revokeUserSessions(updated.map((r) => r.id));
  }
  // 状态变化改变动态用户组归属（禁用退出 / 启用回归）
  syncUserDynamicMembershipsSafe(updated.map((r) => r.id), '批量启停用户');
}

export async function getUsersBeforeAudit(ids: number[]) {
  const user = currentUser();
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return [];
  const tc = tenantCondition(users, user);
  const rawList = await findUsersWithRelations({
    where: tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds),
    orderBy: users.id,
  });
  return mapUsers(rawList);
}

export async function getUser(id: number) {
  const cond = await manageableUsersCondition();
  const full = await findUserWithRelations({ where: cond ? and(eq(users.id, id), cond) : eq(users.id, id) });
  if (!full) throw new HTTPException(404, { message: '用户不存在' });
  return mapUserWithMask(full, viewerRoleCodes());
}

export async function getUserBeforeAudit(id: number) {
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const full = await findUserWithRelations({ where: tc ? and(eq(users.id, id), tc) : eq(users.id, id) });
  if (!full) return null;
  return mapUser(full);
}

export async function getUserRoleAssignmentAudit(id: number) {
  const before = await getUserBeforeAudit(id);
  if (!before) return null;
  return {
    id: before.id,
    username: before.username,
    nickname: before.nickname,
    roleIds: before.roles.map((role) => role.id),
    roles: before.roles.map((role) => ({ id: role.id, name: role.name, code: role.code })),
  };
}

export interface UpdateUserInput {
  username?: string; nickname?: string; email?: string | null; phone?: string; gender?: string | null;
  departmentId?: number | null;
  positionIds?: number[]; roleIds?: number[];
  status?: 'enabled' | 'disabled';
  avatar?: string | null;
}

export async function updateUser(id: number, data: UpdateUserInput) {
  const user = currentUser();
  await ensureUserManageable(id);
  const { roleIds, positionIds, departmentId, ...rest } = data;
  const nextRoleIds = roleIds ? Array.from(new Set(roleIds)) : undefined;
  const nextPositionIds = positionIds ? Array.from(new Set(positionIds)) : undefined;
  await Promise.all([
    ensureDepartmentExists(departmentId, user),
    ensureRoleIdsExist(nextRoleIds ?? [], user),
    ensurePositionIdsExist(nextPositionIds ?? [], user),
  ]);
  // 更新时检查用户名/邮箱是否已被其他用户占用（排除自身），以及禁用时校验保护账号——三项独立并行
  const tc = tenantCondition(users, user);
  const usernameWhereClause = tc
    ? and(eq(users.username, data.username!), ne(users.id, id), tc)
    : and(eq(users.username, data.username!), ne(users.id, id));
  const emailWhereClause = tc
    ? and(eq(users.email, data.email!), ne(users.id, id), tc)
    : and(eq(users.email, data.email!), ne(users.id, id));
  const phoneWhereClause = tc
    ? and(eq(users.phone, data.phone!), ne(users.id, id), tc)
    : and(eq(users.phone, data.phone!), ne(users.id, id));
  const idWhereClause = tc ? and(eq(users.id, id), tc) : eq(users.id, id);
  const [usernameDup, emailDup, phoneDup, disabledTarget] = await Promise.all([
    data.username
      ? db.select({ id: users.id }).from(users).where(usernameWhereClause).limit(1)
      : Promise.resolve([] as { id: number }[]),
    data.email
      ? db.select({ id: users.id }).from(users).where(emailWhereClause).limit(1)
      : Promise.resolve([] as { id: number }[]),
    data.phone
      ? db.select({ id: users.id }).from(users).where(phoneWhereClause).limit(1)
      : Promise.resolve([] as { id: number }[]),
    data.status === 'disabled'
      ? db.select({ id: users.id, username: users.username }).from(users).where(idWhereClause).limit(1)
      : Promise.resolve([] as { id: number; username: string }[]),
  ]);
  if (usernameDup[0]) throw new HTTPException(400, { message: '用户名已存在' });
  if (emailDup[0]) throw new HTTPException(400, { message: '邮箱已存在' });
  if (phoneDup[0]) throw new HTTPException(400, { message: '手机号已存在' });
  if (data.status === 'disabled') {
    if (id === user.userId) throw new HTTPException(400, { message: '不允许禁用当前登录账号' });
    if (!disabledTarget[0]) throw new HTTPException(404, { message: '用户不存在' });
    if (isProtectedAdminUser(disabledTarget[0].username)) throw new HTTPException(400, { message: 'admin 账号不允许禁用' });
  }
  const nextValues = {
    ...rest,
    ...(departmentId === undefined ? {} : { departmentId: departmentId ?? null }),
  };
  // 变更前是否绑定平台超管角色：失去绑定时须撤销会话（JWT roles 2h 内不随 DB 变化）
  const hadPlatformSuper = nextRoleIds !== undefined ? await userHasPlatformSuperRole(id) : false;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(users).set(nextValues)
      .where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).returning();
    if (!u) return null;
    if (nextRoleIds !== undefined) await setUserRoles(tx, id, nextRoleIds);
    if (nextPositionIds !== undefined) await setUserPositions(tx, id, nextPositionIds);
    return u;
  });
  if (!updated) throw new HTTPException(404, { message: '用户不存在' });
  if (nextRoleIds !== undefined) {
    await clearUserPermissionCache(id);
    if (hadPlatformSuper && !(await userHasPlatformSuperRole(id))) {
      await revokeUserSessions([id]);
    }
  }
  if (data.status === 'disabled') await revokeUserSessions([id]);
  // 部门/岗位/状态变化可能改变动态用户组归属
  syncUserDynamicMembershipsSafe([id], '管理端更新用户');
  const full = await findUserWithRelations({ where: eq(users.id, updated.id) });
  if (!full) throw new HTTPException(404, { message: '用户不存在' });
  return mapUser(full);
}

export async function deleteUser(id: number) {
  const user = currentUser();
  if (id === user.userId) throw new HTTPException(400, { message: '不允许删除当前登录账号' });
  await ensureUserManageable(id);
  const tc = tenantCondition(users, user);
  await ensureNoProtectedAdminInIds([id], '删除');
  const [deleted] = await db.delete(users).where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).returning();
  if (!deleted) throw new HTTPException(404, { message: '用户不存在' });
  await revokeUserSessions([id]);
}

export async function batchResetUsersPassword(ids: number[], password: string) {
  const user = currentUser();
  if (ids.length === 0) throw new HTTPException(400, { message: '请选择要操作的用户' });
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new HTTPException(400, { message: '用户ID格式无效' });
  await ensureUsersManageable(validIds);
  const policy = (await getSettings('identitySecurity')).password;
  const policyError = validatePassword(password, policy);
  if (policyError) throw new HTTPException(400, { message: policyError });
  const tc = tenantCondition(users, user);
  await ensureNoProtectedAdminInIds(validIds, '修改密码');
  const hashed = await hashPassword(password);
  await db.update(users).set({ password: hashed, passwordUpdatedAt: new Date() }).where(tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds));
  // 管理员重置密码 = 凭据轮换：目标用户全部在线会话与 refresh 授权一并作废
  await revokeUserSessions(validIds);
}

export async function updateUserPassword(id: number, password: string) {
  await ensureUserManageable(id);
  const policy = (await getSettings('identitySecurity')).password;
  const policyError = validatePassword(password, policy);
  if (policyError) throw new HTTPException(400, { message: policyError });
  const hashed = await hashPassword(password);
  await db.update(users).set({ password: hashed, passwordUpdatedAt: new Date() }).where(eq(users.id, id));
  await revokeUserSessions([id]);
}

export async function unlockUserById(id: number) {
  const cond = await manageableUsersCondition();
  const [u] = await db.select({ username: users.username }).from(users)
    .where(cond ? and(eq(users.id, id), cond) : eq(users.id, id)).limit(1);
  if (!u) throw new HTTPException(404, { message: '用户不存在' });
  await unlockUserSession(u.username);
}

export async function exportUsers(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const rawList = await db.query.users.findMany({
    where: tc, with: { department: { columns: { name: true } } }, orderBy: users.id,
  });
  const list = rawList.map((u) => ({
    id: u.id, username: u.username, nickname: u.nickname, email: u.email,
    departmentName: u.department?.name ?? '', status: u.status,
    createdAt: formatDateTimeForExcel(u.createdAt),
  }));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 16 },
      { header: '昵称', key: 'nickname', width: 16 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '部门', key: 'departmentName', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    list,
    '用户列表',
  );
  return { stream, filename: 'users.xlsx' };
}

export async function exportUsersAsCsv(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const rawList = await db.query.users.findMany({
    where: tc, with: { department: { columns: { name: true } } }, orderBy: users.id,
  });
  const list = rawList.map((u) => ({
    id: u.id, username: u.username, nickname: u.nickname, email: u.email,
    departmentName: u.department?.name ?? '', status: u.status,
    createdAt: formatDateTimeForExcel(u.createdAt),
  }));
  const stream = streamToCsv(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 16 },
      { header: '昵称', key: 'nickname', width: 16 },
      { header: '邮筱', key: 'email', width: 24 },
      { header: '部门', key: 'departmentName', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    list,
  );
  return { stream, filename: 'users.csv' };
}

// ─── 用户级菜单权限 ────────────────────────────────────────────────────────────

export async function getUserMenuPermissions(userId: number) {
  await ensureUserManageable(userId);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {},
    with: {
      userMenus: { columns: { menuId: true } },
      userRoles: {
        columns: {},
        with: {
          role: {
            columns: {},
            with: { roleMenus: { columns: { menuId: true } } },
          },
        },
      },
    },
  });
  if (!user) throw new HTTPException(404, { message: '用户不存在' });
  const directMenuIds = user.userMenus.map((m) => m.menuId);
  const roleMenuIds = [...new Set(user.userRoles.flatMap((ur) => ur.role.roleMenus.map((rm) => rm.menuId)))];
  return { directMenuIds, roleMenuIds };
}

export async function getUserMenuPermissionsBeforeAudit(userId: number) {
  const before = await getUserBeforeAudit(userId);
  if (!before) return null;
  return {
    id: before.id,
    username: before.username,
    nickname: before.nickname,
    ...(await getUserMenuPermissions(userId)),
  };
}

export async function assignUserMenus(userId: number, menuIds: number[]) {
  const target = await ensureUserManageable(userId);
  const uniqueMenuIds = Array.from(new Set(menuIds));
  // 多租户：直授菜单必须落在目标用户所属租户的套餐功能范围内（与角色分配菜单同一口径）
  const featureSet = await getTenantPackageFeatureSet(target.tenantId);
  if (featureSet && uniqueMenuIds.length > 0) {
    const rows = await db.select({ featureKey: menus.featureKey }).from(menus).where(inArray(menus.id, uniqueMenuIds));
    if (rows.some((m) => m.featureKey && !featureSet.has(m.featureKey))) {
      throw new HTTPException(400, { message: '所选菜单超出该用户所属租户套餐功能范围，无法分配' });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(userMenus).where(eq(userMenus.userId, userId));
    if (uniqueMenuIds.length > 0) {
      await tx.insert(userMenus).values(uniqueMenuIds.map((menuId) => ({ userId, menuId })));
    }
  });
  await clearUserPermissionCache(userId);
}

export async function assignRolesToUser(userId: number, roleIds: number[]) {
  await ensureUserManageable(userId);
  const uniqueRoleIds = Array.from(new Set(roleIds));
  // 角色必须存在且落在当前操作者可见租户内，防止绑定跨租户/平台角色
  await ensureRoleIdsExist(uniqueRoleIds, currentUser());
  // 变更前是否绑定平台超管角色：失去绑定时须撤销会话（JWT roles 2h 内不随 DB 变化）
  const hadPlatformSuper = await userHasPlatformSuperRole(userId);
  await db.transaction(async (tx) => {
    await setUserRoles(tx, userId, uniqueRoleIds);
  });
  await clearUserPermissionCache(userId);
  if (hadPlatformSuper && !(await userHasPlatformSuperRole(userId))) {
    await revokeUserSessions([userId]);
  }
}

// ─── 用户级数据权限 ────────────────────────────────────────────────────────────

const SCOPE_PRIORITY: Record<string, number> = { all: 5, dept: 4, dept_only: 3, custom: 2, self: 1 };

function getMostPermissiveScope(scopes: Array<string | null>): string | null {
  const valid = scopes.filter((s): s is string => s !== null);
  if (valid.length === 0) return null;
  return valid.reduce((best, curr) => (SCOPE_PRIORITY[curr] ?? 0) > (SCOPE_PRIORITY[best] ?? 0) ? curr : best, valid[0]);
}

const groupRolesWith = enabledGroupRolesWith({
  columns: { status: true, dataScope: true },
  with: {
    roleMenus: { columns: { menuId: true } },
    deptScopes: { columns: { deptId: true } },
  },
});

/** 聚合启用组的启用角色继承信息（菜单/数据权限），并返回带角色绑定的组名列表（诊断展示用） */
function extractGroupInheritance(
  memberships: ReadonlyArray<{
    group: {
      id: number;
      name: string;
      status: string;
      groupRoles: Array<{ role: { status: string; dataScope: string; roleMenus: Array<{ menuId: number }>; deptScopes: Array<{ deptId: number }> } }>;
    };
  }> | undefined,
) {
  const { roles, groups } = extractEnabledGroupRoles(memberships);
  const groupMenuIds = [...new Set(roles.flatMap((r) => r.roleMenus.map((rm) => rm.menuId)))];
  const groupDataScope = getMostPermissiveScope(roles.map((r) => r.dataScope));
  const groupDeptScopeIds = [...new Set(
    roles.filter((r) => r.dataScope === 'custom').flatMap((r) => r.deptScopes.map((ds) => ds.deptId))
  )];
  return { groupMenuIds, groupDataScope, groupDeptScopeIds, groups };
}

export async function getUserDataPermission(userId: number) {
  await ensureUserManageable(userId);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { userDataScope: true },
    with: {
      userDeptScopes: { columns: { deptId: true } },
      userRoles: {
        columns: {},
        with: {
          role: {
            columns: { dataScope: true },
            with: { deptScopes: { columns: { deptId: true } } },
          },
        },
      },
      userGroupMembers: groupRolesWith,
    },
  });
  if (!user) throw new HTTPException(404, { message: '用户不存在' });
  const roleDataScope = getMostPermissiveScope(user.userRoles.map((ur) => ur.role.dataScope));
  const roleDeptScopeIds = [...new Set(
    user.userRoles
      .filter((ur) => ur.role.dataScope === 'custom')
      .flatMap((ur) => ur.role.deptScopes.map((ds) => ds.deptId))
  )];
  const { groupDataScope, groupDeptScopeIds, groups } = extractGroupInheritance(user.userGroupMembers ?? []);
  return {
    userDataScope: user.userDataScope ?? null,
    deptScopeIds: user.userDeptScopes.map((ds) => ds.deptId),
    roleDataScope,
    roleDeptScopeIds,
    groupDataScope,
    groupDeptScopeIds,
    groups,
  };
}

export async function getUserDataPermissionBeforeAudit(userId: number) {
  const before = await getUserBeforeAudit(userId);
  if (!before) return null;
  return {
    id: before.id,
    username: before.username,
    nickname: before.nickname,
    ...(await getUserDataPermission(userId)),
  };
}

export async function updateUserDataPermission(userId: number, data: { dataScope: string | null; deptScopeIds: number[] }) {
  await ensureUserManageable(userId);
  await db.transaction(async (tx) => {
    await tx.update(users)
      .set({ userDataScope: data.dataScope as typeof users.$inferInsert['userDataScope'] })
      .where(eq(users.id, userId));
    await tx.delete(userDeptScopes).where(eq(userDeptScopes.userId, userId));
    if (data.dataScope === 'custom' && data.deptScopeIds.length > 0) {
      await tx.insert(userDeptScopes).values(data.deptScopeIds.map((deptId) => ({ userId, deptId })));
    }
  });
  await clearUserPermissionCache(userId);
}

export async function getUserEffectivePermissions(userId: number) {
  await ensureUserManageable(userId);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { userDataScope: true },
    with: {
      userMenus: { columns: { menuId: true } },
      userDeptScopes: { columns: { deptId: true } },
      userRoles: {
        columns: {},
        with: {
          role: {
            columns: { dataScope: true },
            with: {
              roleMenus: { columns: { menuId: true } },
              deptScopes: { columns: { deptId: true } },
            },
          },
        },
      },
      userGroupMembers: groupRolesWith,
    },
  });
  if (!user) throw new HTTPException(404, { message: '用户不存在' });

  const { groupMenuIds, groupDataScope, groupDeptScopeIds, groups } = extractGroupInheritance(user.userGroupMembers ?? []);

  const directMenuIds = user.userMenus.map((m) => m.menuId);
  const roleMenuIds = [...new Set(user.userRoles.flatMap((ur) => ur.role.roleMenus.map((rm) => rm.menuId)))];
  const effectiveMenuIds = [...new Set([...directMenuIds, ...roleMenuIds, ...groupMenuIds])];

  const userDataScope = user.userDataScope ?? null;
  const roleDataScope = getMostPermissiveScope(user.userRoles.map((ur) => ur.role.dataScope));
  const effectiveDataScope = getMostPermissiveScope([userDataScope, roleDataScope, groupDataScope]) ?? 'self';

  const userDeptScopeIds = user.userDeptScopes.map((ds) => ds.deptId);
  const roleDeptScopeIds = [...new Set(
    user.userRoles
      .filter((ur) => ur.role.dataScope === 'custom')
      .flatMap((ur) => ur.role.deptScopes.map((ds) => ds.deptId))
  )];
  const effectiveDeptScopeIds = effectiveDataScope === 'custom'
    ? [...new Set([...(userDataScope === 'custom' ? userDeptScopeIds : []), ...roleDeptScopeIds, ...groupDeptScopeIds])]
    : [];

  return {
    directMenuIds,
    roleMenuIds,
    groupMenuIds,
    effectiveMenuIds,
    userDataScope,
    roleDataScope,
    groupDataScope,
    effectiveDataScope,
    userDeptScopeIds,
    roleDeptScopeIds,
    groupDeptScopeIds,
    effectiveDeptScopeIds,
    groups,
  };
}
