import { Hono } from 'hono';
import { desc, eq, like, and, sql, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../db';
import { notices, noticeReads } from '../db/schema';
import { createNoticeSchema, updateNoticeSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { broadcast } from '../lib/ws-manager';
import type { JwtPayload } from '../middleware/auth';

type Env = { Variables: { user: JwtPayload } };
const noticesRouter = new Hono<Env>();
noticesRouter.use('*', authMiddleware);

function toNotice(row: typeof notices.$inferSelect) {
  return {
    ...row,
    publishTime: row.publishTime ? row.publishTime.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// 获取已发布的通知（供铃铛使用，无需分页，返回最近 20 条，含已读标记）
noticesRouter.get('/published', async (c) => {
  const user = c.get('user');
  const rows = await db
    .select()
    .from(notices)
    .where(eq(notices.publishStatus, 'published'))
    .orderBy(desc(notices.publishTime))
    .limit(20);

  // 查询当前用户已读的通知 id 集合
  const readRows = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.userId, user.userId));
  const readSet = new Set(readRows.map((r) => r.noticeId));

  const data = rows.map((row) => ({
    ...toNotice(row),
    isRead: readSet.has(row.id),
  }));
  return c.json({ code: 0, message: 'ok', data });
});

// 标记通知为已读
noticesRouter.post('/:id/read', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  // upsert: 若已存在则忽略
  await db
    .insert(noticeReads)
    .values({ noticeId: id, userId: user.userId })
    .onConflictDoNothing();
  return c.json({ code: 0, message: 'ok', data: null });
});

// 全部标记为已读（将所有已发布且未读的通知批量写入 noticeReads）
noticesRouter.post('/read-all', async (c) => {
  const user = c.get('user');

  const allPublished = await db
    .select({ id: notices.id })
    .from(notices)
    .where(eq(notices.publishStatus, 'published'));

  if (allPublished.length === 0) {
    return c.json({ code: 0, message: 'ok', data: null });
  }

  const readRows = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.userId, user.userId));
  const readSet = new Set(readRows.map((r) => r.noticeId));

  const unreadIds = allPublished.filter((n) => !readSet.has(n.id)).map((n) => n.id);
  if (unreadIds.length > 0) {
    await db
      .insert(noticeReads)
      .values(unreadIds.map((noticeId) => ({ noticeId, userId: user.userId })))
      .onConflictDoNothing();
  }

  return c.json({ code: 0, message: 'ok', data: null });
});

// 收件箱（分页，含已读标记，供普通用户查看所有已发布通知）
noticesRouter.get('/inbox', async (c) => {
  const user = c.get('user');
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const isRead = c.req.query('isRead'); // 'true' | 'false' | undefined

  const [readRows, allRows] = await Promise.all([
    db
      .select({ noticeId: noticeReads.noticeId })
      .from(noticeReads)
      .where(eq(noticeReads.userId, user.userId)),
    db
      .select()
      .from(notices)
      .where(eq(notices.publishStatus, 'published'))
      .orderBy(desc(notices.publishTime)),
  ]);

  const readSet = new Set(readRows.map((r) => r.noticeId));
  let list = allRows.map((row) => ({ ...toNotice(row), isRead: readSet.has(row.id) }));

  if (isRead === 'true') list = list.filter((n) => n.isRead);
  else if (isRead === 'false') list = list.filter((n) => !n.isRead);

  const total = list.length;
  const paged = list.slice((page - 1) * pageSize, page * pageSize);

  return c.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
});

// 分页列表（管理用）
noticesRouter.get('/', guard({ permission: 'system:notice:list' }), async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const title = c.req.query('title');
  const type = c.req.query('type');
  const publishStatus = c.req.query('publishStatus');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

  const conditions = [];
  if (title) conditions.push(like(notices.title, `%${title}%`));
  if (type) conditions.push(eq(notices.type, type));
  if (publishStatus) conditions.push(eq(notices.publishStatus, publishStatus));
  if (startTime) conditions.push(gte(notices.createdAt, new Date(startTime)));
  if (endTime) conditions.push(lte(notices.createdAt, new Date(endTime)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(notices)
    .where(where);

  const rows = await db
    .select()
    .from(notices)
    .where(where)
    .orderBy(desc(notices.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: { list: rows.map(toNotice), total: count, page, pageSize },
  });
});

// 获取单条
noticesRouter.get('/:id', guard({ permission: 'system:notice:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.select().from(notices).where(eq(notices.id, id));
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);
  return c.json({ code: 0, message: 'ok', data: toNotice(row) });
});

// 创建
noticesRouter.post('/', guard({ permission: 'system:notice:create', audit: { description: '创建通知公告', module: '通知公告' } }), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const result = createNoticeSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const now = new Date();
  let publishTime: Date | null = null;
  if (result.data.publishTime) {
    publishTime = new Date(result.data.publishTime);
  } else if (result.data.publishStatus === 'published') {
    publishTime = now;
  }

  const [row] = await db
    .insert(notices)
    .values({
      title: result.data.title,
      content: result.data.content,
      type: result.data.type,
      publishStatus: result.data.publishStatus,
      priority: result.data.priority,
      publishTime,
      createById: user?.userId ?? null,
      createByName: user?.username ?? null,
    })
    .returning();
  const notice = toNotice(row);
  if (row.publishStatus === 'published') {
    broadcast({ type: 'notice:new', payload: notice });
  }
  return c.json({ code: 0, message: '创建成功', data: notice });
});

// 更新
noticesRouter.put('/:id', guard({ permission: 'system:notice:update', audit: { description: '更新通知公告', module: '通知公告' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateNoticeSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const now = new Date();
  let publishTime: Date | null | undefined = undefined;
  if (result.data.publishTime !== undefined) {
    publishTime = result.data.publishTime ? new Date(result.data.publishTime) : null;
  } else if (result.data.publishStatus === 'published') {
    // 如果切换为发布状态但没有传 publishTime，设为当前时间
    const existing = await db.select().from(notices).where(eq(notices.id, id));
    if (existing[0] && !existing[0].publishTime) {
      publishTime = now;
    }
  }

  const updateData: Record<string, unknown> = { ...result.data, updatedAt: now };
  if (publishTime !== undefined) updateData.publishTime = publishTime;

  const [row] = await db
    .update(notices)
    .set(updateData)
    .where(eq(notices.id, id))
    .returning();
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);
  const notice = toNotice(row);
  if (result.data.publishStatus === 'published') {
    broadcast({ type: 'notice:new', payload: notice });
  }
  return c.json({ code: 0, message: '更新成功', data: notice });
});

// 批量删除
noticesRouter.delete('/batch', guard({ permission: 'system:notice:delete', audit: { description: '批量删除通知公告', module: '通知公告' } }), async (c) => {
  const body = await c.req.json();
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ code: 400, message: '请选择要删除的通知', data: null }, 400);
  }
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) {
    return c.json({ code: 400, message: '通知ID格式无效', data: null }, 400);
  }
  await db.delete(notices).where(inArray(notices.id, validIds));
  return c.json({ code: 0, message: `已删除 ${validIds.length} 条通知`, data: null });
});

// 删除
noticesRouter.delete('/:id', guard({ permission: 'system:notice:delete', audit: { description: '删除通知公告', module: '通知公告' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.delete(notices).where(eq(notices.id, id)).returning();
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);
  return c.json({ code: 0, message: '删除成功', data: null });
});

noticesRouter.get('/export', guard({ permission: 'system:notice:list' }), async (c) => {
  const rows = await db.select().from(notices).orderBy(desc(notices.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '标题', key: 'title', width: 24 },
      { header: '类型', key: 'type', width: 12 },
      { header: '优先级', key: 'priority', width: 10 },
      { header: '发布状态', key: 'publishStatus', width: 12 },
      { header: '创建人', key: 'createByName', width: 14 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    '通知公告'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=notices.xlsx');
  return c.body(buffer);
});

export default noticesRouter;
