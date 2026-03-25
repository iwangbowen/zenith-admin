import { Hono } from 'hono';
import { and, asc, eq, gte, inArray, like, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { positions, userPositions } from '../db/schema';
import { createPositionSchema, updatePositionSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';

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

// 批量删除岗位
positionsRouter.delete('/batch', guard({ permission: 'system:position:delete', audit: { description: '批量删除岗位', module: '岗位管理' } }), async (c) => {
  const body = await c.req.json();
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ code: 400, message: '请选择要删除的岗位', data: null }, 400);
  }
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) {
    return c.json({ code: 400, message: '岗位ID格式无效', data: null }, 400);
  }
  // 检查是否有绑定用户
  const bindings = await db
    .select({ positionId: userPositions.positionId })
    .from(userPositions)
    .where(inArray(userPositions.positionId, validIds));
  if (bindings.length > 0) {
    return c.json({ code: 400, message: '所选岗位中存在关联用户，无法删除', data: null }, 400);
  }
  await db.delete(positions).where(inArray(positions.id, validIds));
  return c.json({ code: 0, message: `已删除 ${validIds.length} 个岗位`, data: null });
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

positionsRouter.get('/export', guard({ permission: 'system:position:list' }), async (c) => {
  const rows = await db.select().from(positions).orderBy(asc(positions.sort));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '岗位名称', key: 'name', width: 18 },
      { header: '岗位编码', key: 'code', width: 18 },
      { header: '排序', key: 'sort', width: 8 },
      { header: '状态', key: 'status', width: 10, transform: (v) => v === 'active' ? '启用' : '禁用' },
      { header: '备注', key: 'remark', width: 24 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, remark: r.remark ?? '', createdAt: r.createdAt.toISOString() })),
    '岗位列表'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=positions.xlsx');
  return c.body(buffer);
});

export default positionsRouter;
