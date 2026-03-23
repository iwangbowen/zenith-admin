import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { eq, like, sql, and, or, inArray, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { users, userRoles, roles } from '../db/schema';
import { createUserSchema, updateUserSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { auditLog } from '../middleware/audit';

const usersRouter = new Hono();

usersRouter.use('*', authMiddleware);

async function getUserRolesMap(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, object[]>();
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

  const map = new Map<number, object[]>();
  for (const row of rows) {
    const { userId, ...role } = row;
    if (!map.has(userId)) map.set(userId, []);
    map.get(userId)!.push({ ...role, createdAt: role.createdAt.toISOString(), updatedAt: role.updatedAt.toISOString() });
  }
  return map;
}

async function setUserRoles(userId: number, roleIds: number[]) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    await db.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  }
}

// 用户列表
usersRouter.get('/', async (c) => {
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
      status: users.status,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(where)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .orderBy(users.id);

  const userIds = list.map((u) => u.id);
  const rolesMap = await getUserRolesMap(userIds);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: list.map((u) => ({
        ...u,
        roles: rolesMap.get(u.id) ?? [],
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      })),
      total: Number(count),
      page,
      pageSize,
    },
  });
});

// 创建用户
usersRouter.post('/', auditLog({ description: '创建用户', module: '用户管理' }), async (c) => {
  const body = await c.req.json();
  const result = createUserSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { password, roleIds, ...rest } = result.data;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const [user] = await db.insert(users).values({ ...rest, password: hashedPassword }).returning();
    await setUserRoles(user.id, roleIds);
    const userRoleList = (await getUserRolesMap([user.id])).get(user.id) ?? [];
    const { password: _, ...userInfo } = user;
    return c.json({
      code: 0,
      message: '创建成功',
      data: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
    });
  } catch (err: any) {
    if (err.code === '23505') {
      return c.json({ code: 400, message: '用户名或邮箱已存在', data: null }, 400);
    }
    throw err;
  }
});

// 更新用户
usersRouter.put('/:id', auditLog({ description: '更新用户', module: '用户管理' }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateUserSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { roleIds, ...rest } = result.data;

  const [user] = await db
    .update(users)
    .set({ ...rest, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }

  if (roleIds !== undefined) {
    await setUserRoles(id, roleIds);
  }

  const userRoleList = (await getUserRolesMap([id])).get(id) ?? [];
  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '更新成功',
    data: { ...userInfo, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
  });
});

// 删除用户
usersRouter.delete('/:id', auditLog({ description: '删除用户', module: '用户管理' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!deleted) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default usersRouter;
