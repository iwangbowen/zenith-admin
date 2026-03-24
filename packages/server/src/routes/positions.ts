import { Hono } from 'hono';
import { and, asc, eq, gte, like, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { positions, userPositions } from '../db/schema';
import { createPositionSchema, updatePositionSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';

const positionsRouter = new Hono();

positionsRouter.use('*', authMiddleware);

function toPosition(row: typeof positions.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    sort: row.sort,
    status: row.status,
    remark: row.remark ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

positionsRouter.get('/', guard({ permission: 'system:position:list' }), async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const status = c.req.query('status');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [];
  if (keyword) {
    conditions.push(or(like(positions.name, `%${keyword}%`), like(positions.code, `%${keyword}%`)));
  }
  if (status && (status === 'active' || status === 'disabled')) {
    conditions.push(eq(positions.status, status));
  }
  if (startTime) {
    conditions.push(gte(positions.createdAt, new Date(startTime)));
  }
  if (endTime) {
    conditions.push(lte(positions.createdAt, new Date(endTime)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const list = await db.select().from(positions).where(where).orderBy(asc(positions.sort), asc(positions.id));
  return c.json({ code: 0, message: 'ok', data: list.map(toPosition) });
});

positionsRouter.post('/', guard({ permission: 'system:position:create', audit: { description: '创建岗位', module: '岗位管理' } }), async (c) => {
  const body = await c.req.json();
  const result = createPositionSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  try {
    const [position] = await db.insert(positions).values(result.data).returning();
    return c.json({ code: 0, message: '创建成功', data: toPosition(position) });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '岗位编码已存在', data: null }, 400);
    }
    throw error;
  }
});

positionsRouter.put('/:id', guard({ permission: 'system:position:update', audit: { description: '更新岗位', module: '岗位管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updatePositionSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  try {
    const [position] = await db
      .update(positions)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(positions.id, id))
      .returning();
    if (!position) {
      return c.json({ code: 404, message: '岗位不存在', data: null }, 404);
    }
    return c.json({ code: 0, message: '更新成功', data: toPosition(position) });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '岗位编码已存在', data: null }, 400);
    }
    throw error;
  }
});

positionsRouter.delete('/:id', guard({ permission: 'system:position:delete', audit: { description: '删除岗位', module: '岗位管理' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [position] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, id)).limit(1);
  if (!position) {
    return c.json({ code: 404, message: '岗位不存在', data: null }, 404);
  }

  const [binding] = await db
    .select({ positionId: userPositions.positionId })
    .from(userPositions)
    .where(eq(userPositions.positionId, id))
    .limit(1);
  if (binding) {
    return c.json({ code: 400, message: '该岗位下仍有关联用户，无法删除', data: null }, 400);
  }

  await db.delete(positions).where(eq(positions.id, id));
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default positionsRouter;
