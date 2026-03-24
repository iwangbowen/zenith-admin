import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { eq, like, sql, and, or, inArray, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { users, userRoles, roles, departments, positions, userPositions } from '../db/schema';
import { createUserSchema, updateUserSchema, resetUserPasswordSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { clearUserPermissionCache } from '../lib/permissions';
import type { Role, Position, User } from '@zenith/shared';

const usersRouter = new Hono();

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

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }

  const hashedPassword = await bcrypt.hash(result.data.password, 10);
  await db.update(users).set({ password: hashedPassword, updatedAt: new Date() }).where(eq(users.id, id));

  return c.json({ code: 0, message: '密码修改成功', data: null });
});

// 删除用户
usersRouter.delete('/:id', guard({ permission: 'system:user:delete', audit: { description: '删除用户', module: '用户管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!deleted) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default usersRouter;
