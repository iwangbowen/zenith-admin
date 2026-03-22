import { Hono } from 'hono';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { dicts, dictItems } from '../db/schema';
import { createDictSchema, updateDictSchema, createDictItemSchema, updateDictItemSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';

const dictsRouter = new Hono();
dictsRouter.use('*', authMiddleware);

function toDict(row: typeof dicts.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function toDictItem(row: typeof dictItems.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

// ─── 字典 CRUD ────────────────────────────────────────────────────────────────

dictsRouter.get('/', async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const list = await db.select().from(dicts).orderBy(dicts.id);
  const filtered = keyword
    ? list.filter((d) => d.name.includes(keyword) || d.code.includes(keyword))
    : list;
  return c.json({ code: 0, message: 'ok', data: filtered.map(toDict) });
});

dictsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const result = createDictSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  try {
    const [dict] = await db.insert(dicts).values(result.data).returning();
    return c.json({ code: 0, message: '创建成功', data: toDict(dict) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '字典编码已存在', data: null }, 400);
    }
    throw err;
  }
});

dictsRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateDictSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const [dict] = await db.update(dicts).set({ ...result.data, updatedAt: new Date() }).where(eq(dicts.id, id)).returning();
  if (!dict) return c.json({ code: 404, message: '字典不存在', data: null }, 404);
  return c.json({ code: 0, message: '更新成功', data: toDict(dict) });
});

dictsRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [deleted] = await db.delete(dicts).where(eq(dicts.id, id)).returning();
  if (!deleted) return c.json({ code: 404, message: '字典不存在', data: null }, 404);
  return c.json({ code: 0, message: '删除成功', data: null });
});

// ─── 字典项 CRUD ──────────────────────────────────────────────────────────────

// 获取字典下所有字典项
dictsRouter.get('/:id/items', async (c) => {
  const dictId = Number(c.req.param('id'));
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dictId)).orderBy(asc(dictItems.sort), asc(dictItems.id));
  return c.json({ code: 0, message: 'ok', data: items.map(toDictItem) });
});

// 通过编码获取字典项（前端使用）
dictsRouter.get('/code/:code/items', async (c) => {
  const code = c.req.param('code');
  const [dict] = await db.select({ id: dicts.id }).from(dicts).where(eq(dicts.code, code)).limit(1);
  if (!dict) return c.json({ code: 404, message: '字典不存在', data: null }, 404);
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dict.id)).orderBy(asc(dictItems.sort));
  return c.json({ code: 0, message: 'ok', data: items.map(toDictItem) });
});

dictsRouter.post('/:id/items', async (c) => {
  const dictId = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = createDictItemSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const [item] = await db.insert(dictItems).values({ ...result.data, dictId }).returning();
  return c.json({ code: 0, message: '创建成功', data: toDictItem(item) });
});

dictsRouter.put('/:id/items/:itemId', async (c) => {
  const itemId = Number(c.req.param('itemId'));
  const body = await c.req.json();
  const result = updateDictItemSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const [item] = await db.update(dictItems).set({ ...result.data, updatedAt: new Date() }).where(eq(dictItems.id, itemId)).returning();
  if (!item) return c.json({ code: 404, message: '字典项不存在', data: null }, 404);
  return c.json({ code: 0, message: '更新成功', data: toDictItem(item) });
});

dictsRouter.delete('/:id/items/:itemId', async (c) => {
  const itemId = Number(c.req.param('itemId'));
  const [deleted] = await db.delete(dictItems).where(eq(dictItems.id, itemId)).returning();
  if (!deleted) return c.json({ code: 404, message: '字典项不存在', data: null }, 404);
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default dictsRouter;
