import { eq, and, inArray, like, or, gte, lte } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { db } from '../db';
import type { DbExecutor } from '../db/types';
import { users, userRoles, roles, departments, positions, userPositions } from '../db/schema';
import { AppError } from '../lib/errors';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { pageOffset } from '../lib/pagination';
import { getDataScopeCondition } from '../lib/data-scope';
import { escapeLike } from '../lib/where-helpers';
import { getPasswordPolicy, validatePassword } from '../lib/password-policy';
import { unlockUser as unlockUserSession } from '../lib/session-manager';
import { exportToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { clearUserPermissionCache } from '../lib/permissions';
import type { JwtPayload } from '../middleware/auth';
import type { User } from '@zenith/shared';
import { currentUser } from '../lib/context';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';

// ─── 关联查询配置 ─────────────────────────────────────────────────────────────

const userRelationConfig = {
  department: { columns: { name: true } },
  userRoles: { columns: {}, with: { role: true } },
  userPositions: { columns: {}, with: { position: true } },
} as const;

type FindManyUsersArgs = NonNullable<Parameters<typeof db.query.users.findMany>[0]>;
type FindFirstUserArgs = NonNullable<Parameters<typeof db.query.users.findFirst>[0]>;

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
    avatar: row.avatar ?? undefined,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    positionIds: positionList.map((p) => p.id),
    positions: positionList,
    roles: roleList,
    status: row.status,
    passwordUpdatedAt: formatDateTime(row.passwordUpdatedAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  } satisfies User;
}

export function mapUsers(rows: UserWithRelations[]): User[] {
  return rows.map(mapUser);
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

// ─── 参照完整性校验（失败时抛出 AppError）────────────────────────────────────

export async function ensureDepartmentExists(departmentId?: number | null, user?: JwtPayload) {
  if (departmentId === undefined || departmentId === null) return;
  const conditions = [eq(departments.id, departmentId)];
  if (user) {
    const tc = tenantCondition(departments, user);
    if (tc) conditions.push(tc);
  }
  const [d] = await db.select({ id: departments.id }).from(departments).where(and(...conditions)).limit(1);
  if (!d) throw new AppError('所属部门不存在', 400);
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
  if (rows.length !== uniq.length) throw new AppError('存在无效角色', 400);
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
  if (rows.length !== uniq.length) throw new AppError('存在无效岗位', 400);
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

export async function listAllUsers() {
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const rawList = await findUsersWithRelations({ where: tc, orderBy: users.id });
  return mapUsers(rawList);
}

export interface ListUsersQuery {
  page?: number; pageSize?: number; keyword?: string; phone?: string;
  departmentId?: number; status?: 'enabled' | 'disabled';
  startTime?: string; endTime?: string;
}

export async function listUsers(q: ListUsersQuery) {
  const user = currentUser();
  const { page = 1, pageSize = 10, keyword, phone, departmentId, status, startTime, endTime } = q;
  const conditions = [];
  if (keyword) conditions.push(or(like(users.username, `%${escapeLike(keyword)}%`), like(users.nickname, `%${escapeLike(keyword)}%`), like(users.email, `%${escapeLike(keyword)}%`)));
  if (phone) conditions.push(like(users.phone, `%${escapeLike(phone)}%`));
  if (departmentId) conditions.push(eq(users.departmentId, departmentId));
  if (status) conditions.push(eq(users.status, status));
  const parsedStartTime = parseDateTimeInput(startTime);
  const parsedEndTime = parseDateTimeInput(endTime);
  if (parsedStartTime) conditions.push(gte(users.createdAt, parsedStartTime));
  if (parsedEndTime) conditions.push(lte(users.createdAt, parsedEndTime));
  const scopeCondition = await getDataScopeCondition({
    currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: users.id,
  });
  if (scopeCondition) conditions.push(scopeCondition);
  const tc = tenantCondition(users, user);
  if (tc) conditions.push(tc);
  const where = and(...conditions);
  const [total, rawList] = await Promise.all([
    db.$count(users, where),
    findUsersWithRelations({ where, limit: pageSize, offset: pageOffset(page, pageSize), orderBy: users.id }),
  ]);
  return { list: mapUsers(rawList), total: Number(total), page, pageSize };
}

export interface CreateUserInput {
  username: string; nickname: string; email: string; password: string;
  phone?: string; departmentId?: number | null;
  positionIds: number[]; roleIds: number[];
  status: 'enabled' | 'disabled';
}

export async function createUser(data: CreateUserInput) {
  const user = currentUser();
  const policy = await getPasswordPolicy();
  const policyError = validatePassword(data.password, policy);
  if (policyError) throw new AppError(policyError, 400);
  const { password, roleIds, positionIds, departmentId, ...rest } = data;
  const nextRoleIds = Array.from(new Set(roleIds));
  const nextPositionIds = Array.from(new Set(positionIds));
  await Promise.all([
    ensureDepartmentExists(departmentId, user),
    ensureRoleIdsExist(nextRoleIds, user),
    ensurePositionIdsExist(nextPositionIds, user),
  ]);
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const created = await db.transaction(async (tx) => {
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
    if (!full) throw new AppError('创建用户后回读失败', 500);
    return mapUser(full);
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '用户名或邮箱已存在');
  }
}

export async function batchDeleteUsers(ids: number[]) {
  const user = currentUser();
  if (ids.length === 0) throw new AppError('请选择要删除的用户', 400);
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new AppError('用户ID格式无效', 400);
  const tc = tenantCondition(users, user);
  await db.delete(users).where(tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds));
  return validIds.length;
}

export async function batchUpdateUserStatus(ids: number[], status: 'enabled' | 'disabled') {
  const user = currentUser();
  if (ids.length === 0) throw new AppError('请选择要操作的用户', 400);
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  const tc = tenantCondition(users, user);
  await db.update(users).set({ status }).where(tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds));
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

export async function getUserBeforeAudit(id: number) {
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const full = await findUserWithRelations({ where: tc ? and(eq(users.id, id), tc) : eq(users.id, id) });
  if (!full) return null;
  return mapUser(full);
}

export interface UpdateUserInput {
  username?: string; nickname?: string; email?: string; phone?: string;
  departmentId?: number | null;
  positionIds?: number[]; roleIds?: number[];
  status?: 'enabled' | 'disabled';
}

export async function updateUser(id: number, data: UpdateUserInput) {
  const user = currentUser();
  const { roleIds, positionIds, departmentId, ...rest } = data;
  const nextRoleIds = roleIds ? Array.from(new Set(roleIds)) : undefined;
  const nextPositionIds = positionIds ? Array.from(new Set(positionIds)) : undefined;
  await Promise.all([
    ensureDepartmentExists(departmentId, user),
    ensureRoleIdsExist(nextRoleIds ?? [], user),
    ensurePositionIdsExist(nextPositionIds ?? [], user),
  ]);
  const nextValues = {
    ...rest,
    ...(departmentId === undefined ? {} : { departmentId: departmentId ?? null }),
  };
  const tc = tenantCondition(users, user);
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(users).set(nextValues)
      .where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).returning();
    if (!u) return null;
    if (nextRoleIds !== undefined) await setUserRoles(tx, id, nextRoleIds);
    if (nextPositionIds !== undefined) await setUserPositions(tx, id, nextPositionIds);
    return u;
  });
  if (!updated) throw new AppError('用户不存在', 404);
  if (nextRoleIds !== undefined) clearUserPermissionCache(id);
  const full = await findUserWithRelations({ where: eq(users.id, updated.id) });
  if (!full) throw new AppError('用户不存在', 404);
  return mapUser(full);
}

export async function deleteUser(id: number) {
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const [deleted] = await db.delete(users).where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).returning();
  if (!deleted) throw new AppError('用户不存在', 404);
}

export async function updateUserPassword(id: number, password: string) {
  const user = currentUser();
  const policy = await getPasswordPolicy();
  const policyError = validatePassword(password, policy);
  if (policyError) throw new AppError(policyError, 400);
  const tc = tenantCondition(users, user);
  const [u] = await db.select({ id: users.id }).from(users).where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).limit(1);
  if (!u) throw new AppError('用户不存在', 404);
  const hashed = await bcrypt.hash(password, 10);
  await db.update(users).set({ password: hashed }).where(eq(users.id, id));
}

export async function unlockUserById(id: number) {
  const user = currentUser();
  const tc = tenantCondition(users, user);
  const [u] = await db.select({ username: users.username }).from(users).where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).limit(1);
  if (!u) throw new AppError('用户不存在', 404);
  await unlockUserSession(u.username);
}

export async function exportUsers(): Promise<{ buffer: ArrayBuffer; filename: string }> {
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
  const buffer = await exportToExcel(
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
  return { buffer, filename: 'users.xlsx' };
}

export async function getUserImportTemplate(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('用户导入模板');
  sheet.columns = [
    { header: '用户名*', key: 'username', width: 16 },
    { header: '昵称*', key: 'nickname', width: 16 },
    { header: '邮箱*', key: 'email', width: 24 },
    { header: '密码*', key: 'password', width: 16 },
    { header: '部门编码', key: 'departmentCode', width: 18 },
    { header: '岗位编码(逗号分隔)', key: 'positionCodes', width: 22 },
    { header: '角色编码(逗号分隔)', key: 'roleCodes', width: 22 },
    { header: '状态(enabled/disabled)', key: 'status', width: 24 },
  ];
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
  sheet.addRow({
    username: 'zhangsan', nickname: '张三', email: 'zhangsan@example.com',
    password: '请修改为强密码', departmentCode: 'technology', positionCodes: 'engineer',
    roleCodes: 'normal_user', status: 'enabled',
  });
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export interface ImportUsersResult {
  total: number; success: number; failed: number;
  errors: Array<{ row: number; message: string }>;
}

function getImportFile(formData: FormData): File {
  const file = formData.get('file');
  if (!file || typeof (file as File).arrayBuffer !== 'function') throw new AppError('请上传文件', 400);
  return file as File;
}

export async function importUsersFromFormData(formData: FormData): Promise<ImportUsersResult> {
  return importUsers(getImportFile(formData));
}

export async function importUsers(file: File): Promise<ImportUsersResult> {
  const user = currentUser();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError('文件格式无效或工作表为空', 400);

  const policy = await getPasswordPolicy();
  const errors: Array<{ row: number; message: string }> = [];
  let success = 0;
  const getCellText = (row: ExcelJS.Row, col: number) => {
    const cell = row.getCell(col);
    return cell.text?.toString().trim() ?? '';
  };
  const dataRows: ExcelJS.Row[] = [];
  sheet.eachRow((row, rowNum) => { if (rowNum > 1) dataRows.push(row); });

  const [allDepts, allRoles, allPositions, existingUsersList] = await Promise.all([
    db.select({ id: departments.id, code: departments.code }).from(departments).where(tenantCondition(departments, user)),
    db.select({ id: roles.id, code: roles.code }).from(roles).where(tenantCondition(roles, user)),
    db.select({ id: positions.id, code: positions.code }).from(positions).where(tenantCondition(positions, user)),
    db.select({ username: users.username, email: users.email }).from(users).where(tenantCondition(users, user)),
  ]);
  const deptCodeMap = new Map(allDepts.map((d) => [d.code, d.id]));
  const roleCodeMap = new Map(allRoles.map((r) => [r.code, r.id]));
  const positionCodeMap = new Map(allPositions.map((p) => [p.code, p.id]));
  const existingUsernames = new Set(existingUsersList.map((u) => u.username));
  const existingEmails = new Set(existingUsersList.map((u) => u.email));

  for (const row of dataRows) {
    const rowNum = row.number;
    const username = getCellText(row, 1);
    const nickname = getCellText(row, 2);
    const email = getCellText(row, 3);
    const password = getCellText(row, 4);
    const departmentCode = getCellText(row, 5);
    const positionCodesRaw = getCellText(row, 6);
    const roleCodesRaw = getCellText(row, 7);
    const statusRaw = getCellText(row, 8);

    if (!username || !nickname || !email || !password) { errors.push({ row: rowNum, message: '用户名、昵称、邮箱、密码为必填项' }); continue; }
    const policyError = validatePassword(password, policy);
    if (policyError) { errors.push({ row: rowNum, message: policyError }); continue; }
    if (existingUsernames.has(username) || existingEmails.has(email)) {
      errors.push({ row: rowNum, message: `用户名或邮箱已存在: ${username} / ${email}` }); continue;
    }
    let departmentId: number | null = null;
    if (departmentCode) {
      const deptId = deptCodeMap.get(departmentCode);
      if (!deptId) { errors.push({ row: rowNum, message: `部门编码不存在: ${departmentCode}` }); continue; }
      departmentId = deptId;
    }
    const roleCodes = roleCodesRaw ? roleCodesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let roleIds: number[] = [];
    if (roleCodes.length > 0) {
      const missing = roleCodes.filter((code) => !roleCodeMap.has(code));
      if (missing.length > 0) { errors.push({ row: rowNum, message: `角色编码不存在: ${missing.join(', ')}` }); continue; }
      roleIds = roleCodes.map((code) => roleCodeMap.get(code)).filter((x): x is number => x !== undefined);
    }
    const positionCodes = positionCodesRaw ? positionCodesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let positionIds: number[] = [];
    if (positionCodes.length > 0) {
      const missing = positionCodes.filter((code) => !positionCodeMap.has(code));
      if (missing.length > 0) { errors.push({ row: rowNum, message: `岗位编码不存在: ${missing.join(', ')}` }); continue; }
      positionIds = positionCodes.map((code) => positionCodeMap.get(code)).filter((x): x is number => x !== undefined);
    }
    let status: 'enabled' | 'disabled' = 'enabled';
    if (statusRaw) {
      const normalized = statusRaw.trim().toLowerCase();
      if (normalized === 'enabled' || normalized === 'disabled') status = normalized;
      else { errors.push({ row: rowNum, message: `状态值无效: ${statusRaw}（仅支持 enabled/disabled 或留空）` }); continue; }
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      await db.transaction(async (tx) => {
        const [newUser] = await tx.insert(users).values({
          username, nickname, email, password: hashedPassword,
          departmentId, status, tenantId: getCreateTenantId(user),
        }).returning();
        if (roleIds.length > 0) await setUserRoles(tx, newUser.id, roleIds);
        if (positionIds.length > 0) await setUserPositions(tx, newUser.id, positionIds);
      });
      existingUsernames.add(username);
      existingEmails.add(email);
      success++;
    } catch (e: unknown) {
      errors.push({ row: rowNum, message: `插入失败: ${e instanceof Error ? e.message : '未知错误'}` });
    }
  }
  return { total: dataRows.length, success, failed: errors.length, errors };
}
