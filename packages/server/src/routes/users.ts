import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { eq, like, sql, and, or, inArray, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../db';
import { users, userRoles, roles, departments, positions, userPositions } from '../db/schema';
import { createUserSchema, updateUserSchema, resetUserPasswordSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { clearUserPermissionCache } from '../lib/permissions';
import { exportToExcel } from '../lib/excel-export';
import { getDataScopeCondition } from '../lib/data-scope';
import { unlockUser } from '../lib/session-manager';
import { getPasswordPolicy, validatePassword } from '../lib/password-policy';
import type { Role, Position, User } from '@zenith/shared';

const usersRouter = new Hono<{ Variables: { user: JwtPayload } }>();

usersRouter.use('*', authMiddleware);

async function getUserRolesMap(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, Role[]>();
  const rows = await db
    .select({
      userId: userRoles.userId,
      id: roles.id,
      name: roles.name,
      code: roles.code,
      description: roles.description,
      dataScope: roles.dataScope,
      status: roles.status,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(inArray(userRoles.userId, userIds));

  const map = new Map<number, Role[]>();
  for (const row of rows) {
    const { userId, ...role } = row;
    if (!map.has(userId)) map.set(userId, []);
    map.get(userId)!.push({
      ...role,
      description: role.description ?? undefined,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    });
  }
  return map;
}

async function getUserPositionsMap(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, Position[]>();
  const rows = await db
    .select({
      userId: userPositions.userId,
      id: positions.id,
      name: positions.name,
      code: positions.code,
      sort: positions.sort,
      status: positions.status,
      remark: positions.remark,
      createdAt: positions.createdAt,
      updatedAt: positions.updatedAt,
    })
    .from(userPositions)
    .innerJoin(positions, eq(userPositions.positionId, positions.id))
    .where(inArray(userPositions.userId, userIds));

  const map = new Map<number, Position[]>();
  for (const row of rows) {
    const { userId, ...position } = row;
    if (!map.has(userId)) map.set(userId, []);
    map.get(userId)!.push({
      ...position,
      remark: position.remark ?? undefined,
      createdAt: position.createdAt.toISOString(),
      updatedAt: position.updatedAt.toISOString(),
    });
  }
  return map;
}

async function setUserRoles(userId: number, roleIds: number[]) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    await db.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  }
}

async function setUserPositions(userId: number, positionIds: number[]) {
  await db.delete(userPositions).where(eq(userPositions.userId, userId));
  if (positionIds.length > 0) {
    await db.insert(userPositions).values(positionIds.map((positionId) => ({ userId, positionId })));
  }
}

async function ensureDepartmentExists(departmentId?: number | null) {
  if (departmentId === undefined || departmentId === null) {
    return null;
  }

  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);

  return department ? null : '所属部门不存在';
}

async function ensureRoleIdsExist(roleIds: number[]) {
  const uniqueRoleIds = Array.from(new Set(roleIds));
  if (uniqueRoleIds.length === 0) {
    return null;
  }

  const existingRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.id, uniqueRoleIds));

  return existingRoles.length === uniqueRoleIds.length ? null : '存在无效角色';
}

async function ensurePositionIdsExist(positionIds: number[]) {
  const uniquePositionIds = Array.from(new Set(positionIds));
  if (uniquePositionIds.length === 0) {
    return null;
  }

  const existingPositions = await db
    .select({ id: positions.id })
    .from(positions)
    .where(inArray(positions.id, uniquePositionIds));

  return existingPositions.length === uniquePositionIds.length ? null : '存在无效岗位';
}

type UserListRow = {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar: string | null;
  departmentId: number | null;
  departmentName: string | null;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
};

async function toPublicUsers(rows: UserListRow[]): Promise<User[]> {
  const userIds = rows.map((row) => row.id);
  const [rolesMap, positionsMap] = await Promise.all([
    getUserRolesMap(userIds),
    getUserPositionsMap(userIds),
  ]);

  return rows.map((row) => {
    const roleList = rolesMap.get(row.id) ?? [];
    const positionList = positionsMap.get(row.id) ?? [];
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      email: row.email,
      avatar: row.avatar ?? undefined,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      positionIds: positionList.map((item) => item.id),
      positions: positionList,
      roles: roleList,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies User;
  });
}

// 用户列表
usersRouter.get('/', guard({ permission: 'system:user:list' }), async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const keyword = c.req.query('keyword') || '';
  const status = c.req.query('status');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [];
  if (keyword) {
    conditions.push(
      or(like(users.username, `%${keyword}%`), like(users.nickname, `%${keyword}%`), like(users.email, `%${keyword}%`))
    );
  }
  if (status && (status === 'active' || status === 'disabled')) {
    conditions.push(eq(users.status, status));
  }
  if (startTime) {
    conditions.push(gte(users.createdAt, new Date(startTime)));
  }
  if (endTime) {
    conditions.push(lte(users.createdAt, new Date(endTime)));
  }

  // 数据权限过滤
  const payload = c.get('user');
  const currentUserId = payload.userId;
  const scopeCondition = await getDataScopeCondition({
    currentUserId,
    deptColumn: users.departmentId,
    ownerColumn: users.id,
  });
  if (scopeCondition) conditions.push(scopeCondition);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users).where(where);
  const list = await db
    .select({
      id: users.id,
      username: users.username,
      nickname: users.nickname,
      email: users.email,
      avatar: users.avatar,
      departmentId: users.departmentId,
      departmentName: departments.name,
      status: users.status,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .leftJoin(departments, eq(users.departmentId, departments.id))
    .where(where)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .orderBy(users.id);
  const publicUsers = await toPublicUsers(list);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: publicUsers,
      total: Number(count),
      page,
      pageSize,
    },
  });
});

// 创建用户
usersRouter.post('/', guard({ permission: 'system:user:create', audit: { description: '创建用户', module: '用户管理' } }), async (c) => {
  const body = await c.req.json();
  const result = createUserSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const policy = await getPasswordPolicy();
  const policyError = validatePassword(result.data.password, policy);
  if (policyError) return c.json({ code: 400, message: policyError, data: null }, 400);

  const { password, roleIds, positionIds, departmentId, ...rest } = result.data;
  const nextRoleIds = Array.from(new Set(roleIds));
  const nextPositionIds = Array.from(new Set(positionIds));

  const [departmentError, roleError, positionError] = await Promise.all([
    ensureDepartmentExists(departmentId),
    ensureRoleIdsExist(nextRoleIds),
    ensurePositionIdsExist(nextPositionIds),
  ]);

  const referenceError = departmentError ?? roleError ?? positionError;
  if (referenceError) {
    return c.json({ code: 400, message: referenceError, data: null }, 400);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const [user] = await db.insert(users).values({
      ...rest,
      password: hashedPassword,
      departmentId: departmentId ?? null,
    }).returning();
    await setUserRoles(user.id, nextRoleIds);
    await setUserPositions(user.id, nextPositionIds);
    const publicUser = (await toPublicUsers([{
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      avatar: user.avatar,
      departmentId: user.departmentId,
      departmentName: departmentId ? (await db.select({ name: departments.name }).from(departments).where(eq(departments.id, departmentId)).limit(1))[0]?.name ?? null : null,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }]))[0];
    return c.json({
      code: 0,
      message: '创建成功',
      data: publicUser,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      return c.json({ code: 400, message: '用户名或邮箱已存在', data: null }, 400);
    }
    throw err;
  }
});

// 更新用户
usersRouter.put('/:id', guard({ permission: 'system:user:update', audit: { description: '更新用户', module: '用户管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateUserSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  // 记录操作前快照（用于 diff）
  const [beforeUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (beforeUser) {
    const { password: _pw, ...safeBeforeUser } = beforeUser;
    setAuditBeforeData(c, safeBeforeUser);
  }

  const { roleIds, positionIds, departmentId, ...rest } = result.data;
  const nextRoleIds = roleIds ? Array.from(new Set(roleIds)) : undefined;
  const nextPositionIds = positionIds ? Array.from(new Set(positionIds)) : undefined;

  const [departmentError, roleError, positionError] = await Promise.all([
    ensureDepartmentExists(departmentId),
    ensureRoleIdsExist(nextRoleIds ?? []),
    ensurePositionIdsExist(nextPositionIds ?? []),
  ]);

  const referenceError = departmentError ?? roleError ?? positionError;
  if (referenceError) {
    return c.json({ code: 400, message: referenceError, data: null }, 400);
  }

  const nextValues = {
    ...rest,
    ...(departmentId === undefined ? {} : { departmentId: departmentId ?? null }),
    updatedAt: new Date(),
  };

  const [user] = await db
    .update(users)
    .set(nextValues)
    .where(eq(users.id, id))
    .returning();

  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }

  if (nextRoleIds !== undefined) {
    await setUserRoles(id, nextRoleIds);
    clearUserPermissionCache(id);
  }
  if (nextPositionIds !== undefined) {
    await setUserPositions(id, nextPositionIds);
  }

  const departmentName = user.departmentId
    ? (await db.select({ name: departments.name }).from(departments).where(eq(departments.id, user.departmentId)).limit(1))[0]?.name ?? null
    : null;
  const publicUser = (await toPublicUsers([{
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email,
    avatar: user.avatar,
    departmentId: user.departmentId,
    departmentName,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }]))[0];
  return c.json({
    code: 0,
    message: '更新成功',
    data: publicUser,
  });
});

// 修改指定用户密码
usersRouter.put('/:id/password', guard({ permission: 'system:user:update', audit: { description: '修改用户密码', module: '用户管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = resetUserPasswordSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const policy = await getPasswordPolicy();
  const policyError = validatePassword(result.data.password, policy);
  if (policyError) return c.json({ code: 400, message: policyError, data: null }, 400);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }

  const hashedPassword = await bcrypt.hash(result.data.password, 10);
  await db.update(users).set({ password: hashedPassword, updatedAt: new Date() }).where(eq(users.id, id));

  return c.json({ code: 0, message: '密码修改成功', data: null });
});

// 批量删除用户
usersRouter.delete('/batch', guard({ permission: 'system:user:delete', audit: { description: '批量删除用户', module: '用户管理' } }), async (c) => {
  const body = await c.req.json();
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ code: 400, message: '请选择要删除的用户', data: null }, 400);
  }
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) {
    return c.json({ code: 400, message: '用户ID格式无效', data: null }, 400);
  }
  await db.delete(users).where(inArray(users.id, validIds));
  return c.json({ code: 0, message: `已删除 ${validIds.length} 个用户`, data: null });
});

// 批量修改用户状态
usersRouter.put('/batch-status', guard({ permission: 'system:user:update', audit: { description: '批量修改用户状态', module: '用户管理' } }), async (c) => {
  const body = await c.req.json();
  const { ids, status } = body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ code: 400, message: '请选择要操作的用户', data: null }, 400);
  }
  if (status !== 'active' && status !== 'disabled') {
    return c.json({ code: 400, message: '状态值无效', data: null }, 400);
  }
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  await db.update(users).set({ status, updatedAt: new Date() }).where(inArray(users.id, validIds));
  return c.json({ code: 0, message: '状态已更新', data: null });
});

// 删除用户
usersRouter.delete('/:id', guard({ permission: 'system:user:delete', audit: { description: '删除用户', module: '用户管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  // 记录操作前快照（用于 diff）
  const [beforeUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (beforeUser) {
    const { password: _pw, ...safeBeforeUser } = beforeUser;
    setAuditBeforeData(c, safeBeforeUser);
  }
  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!deleted) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

// 下载导入模板
usersRouter.get('/import-template', guard({ permission: 'system:user:list' }), async (c) => {
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
    { header: '状态(active/disabled)', key: 'status', width: 22 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

  sheet.addRow({
    username: 'zhangsan',
    nickname: '张三',
    email: 'zhangsan@example.com',
    password: 'Password123',
    departmentCode: 'technology',
    positionCodes: 'engineer',
    roleCodes: 'normal_user',
    status: 'active',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=user_import_template.xlsx');
  return c.body(buffer as Buffer);
});

// 批量导入用户
usersRouter.post('/import', guard({ permission: 'system:user:import', audit: { description: '导入用户', module: '用户管理' } }), async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ code: 400, message: '请上传文件', data: null }, 400);

  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return c.json({ code: 400, message: '文件格式无效或工作表为空', data: null }, 400);

  const policy = await getPasswordPolicy();
  const errors: Array<{ row: number; message: string }> = [];
  let success = 0;

  const dataRows: ExcelJS.Row[] = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum > 1) dataRows.push(row);
  });

  for (const row of dataRows) {
    const rowNum = row.number;
    const getCellText = (col: number) => {
      const cell = row.getCell(col);
      return cell.text?.toString().trim() ?? '';
    };

    const username = getCellText(1);
    const nickname = getCellText(2);
    const email = getCellText(3);
    const password = getCellText(4);
    const departmentCode = getCellText(5);
    const positionCodesRaw = getCellText(6);
    const roleCodesRaw = getCellText(7);
    const statusRaw = getCellText(8);

    if (!username || !nickname || !email || !password) {
      errors.push({ row: rowNum, message: '用户名、昵称、邮箱、密码为必填项' });
      continue;
    }

    const policyError = validatePassword(password, policy);
    if (policyError) {
      errors.push({ row: rowNum, message: policyError });
      continue;
    }

    const existingUser = await db.select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1);
    if (existingUser.length > 0) {
      errors.push({ row: rowNum, message: `用户名或邮箱已存在: ${username} / ${email}` });
      continue;
    }

    let departmentId: number | null = null;
    if (departmentCode) {
      const [dept] = await db.select({ id: departments.id }).from(departments).where(eq(departments.code, departmentCode)).limit(1);
      if (!dept) {
        errors.push({ row: rowNum, message: `部门编码不存在: ${departmentCode}` });
        continue;
      }
      departmentId = dept.id;
    }

    const roleCodes = roleCodesRaw ? roleCodesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let roleIds: number[] = [];
    if (roleCodes.length > 0) {
      const foundRoles = await db.select({ id: roles.id }).from(roles).where(inArray(roles.code, roleCodes));
      roleIds = foundRoles.map((r) => r.id);
    }

    const positionCodes = positionCodesRaw ? positionCodesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let positionIds: number[] = [];
    if (positionCodes.length > 0) {
      const foundPositions = await db.select({ id: positions.id }).from(positions).where(inArray(positions.code, positionCodes));
      positionIds = foundPositions.map((p) => p.id);
    }

    const status = (statusRaw === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled';
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      const [newUser] = await db.insert(users).values({
        username, nickname, email, password: hashedPassword, departmentId, status,
      }).returning();
      if (roleIds.length > 0) await setUserRoles(newUser.id, roleIds);
      if (positionIds.length > 0) await setUserPositions(newUser.id, positionIds);
      success++;
    } catch (e: any) {
      errors.push({ row: rowNum, message: `插入失败: ${(e.message as string | undefined) ?? '未知错误'}` });
    }
  }

  return c.json({
    code: 0,
    message: '导入完成',
    data: { total: dataRows.length, success, failed: errors.length, errors },
  });
});

usersRouter.get('/export', guard({ permission: 'system:user:list' }), async (c) => {
  const list = await db
    .select({
      id: users.id,
      username: users.username,
      nickname: users.nickname,
      email: users.email,
      departmentName: departments.name,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(departments, eq(users.departmentId, departments.id))
    .orderBy(users.id);

  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 16 },
      { header: '昵称', key: 'nickname', width: 16 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '部门', key: 'departmentName', width: 16 },
      { header: '状态', key: 'status', width: 10, transform: (v) => v === 'active' ? '启用' : '禁用' },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    list.map((r) => ({ ...r, departmentName: r.departmentName ?? '', createdAt: r.createdAt.toISOString() })),
    '用户列表'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=users.xlsx');
  return c.body(buffer);
});

usersRouter.post('/:id/unlock', guard({ permission: 'system:user:update', audit: { description: '解除账号锁定', module: '用户管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }
  await unlockUser(user.username);
  return c.json({ code: 0, message: '解锁成功', data: null });
});

export default usersRouter;
