import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { eq, like, sql, and, or } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { createUserSchema, updateUserSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';

const usersRouter = new Hono();

usersRouter.use('*', authMiddleware);

// 用户列表
usersRouter.get('/', async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const keyword = c.req.query('keyword') || '';
  const role = c.req.query('role');
  const status = c.req.query('status');

  const conditions = [];
  if (keyword) {
    conditions.push(
      or(like(users.username, `%${keyword}%`), like(users.nickname, `%${keyword}%`), like(users.email, `%${keyword}%`))
    );
  }
  if (role && (role === 'admin' || role === 'user')) {
    conditions.push(eq(users.role, role));
  }
  if (status && (status === 'active' || status === 'disabled')) {
    conditions.push(eq(users.status, status));
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
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(where)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .orderBy(users.id);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: list.map((u) => ({
        ...u,
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
usersRouter.post('/', async (c) => {
  const body = await c.req.json();
  const result = createUserSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { password, ...rest } = result.data;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const [user] = await db.insert(users).values({ ...rest, password: hashedPassword }).returning();
    const { password: _, ...userInfo } = user;
    return c.json({
      code: 0,
      message: '创建成功',
      data: { ...userInfo, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
    });
  } catch (err: any) {
    if (err.code === '23505') {
      return c.json({ code: 400, message: '用户名或邮箱已存在', data: null }, 400);
    }
    throw err;
  }
});

// 更新用户
usersRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateUserSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const [user] = await db
    .update(users)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  if (!user) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }

  const { password: _, ...userInfo } = user;
  return c.json({
    code: 0,
    message: '更新成功',
    data: { ...userInfo, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
  });
});

// 删除用户
usersRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!deleted) {
    return c.json({ code: 404, message: '用户不存在', data: null }, 404);
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default usersRouter;
