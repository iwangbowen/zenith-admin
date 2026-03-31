import { Hono } from 'hono';
import { eq, and, ilike, or, count } from 'drizzle-orm';
import { db } from '../db';
import { messageTemplates } from '../db/schema';
import { createMessageTemplateSchema, updateMessageTemplateSchema, previewMessageTemplateSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { guard } from '../middleware/guard';

const messageTemplatesRouter = new Hono<{ Variables: { user: JwtPayload } }>();
messageTemplatesRouter.use('*', authMiddleware);

function toMessageTemplate(row: typeof messageTemplates.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 将模板内容中的 {{varName}} 替换为提供的变量值 */
function interpolate(content: string, vars: Record<string, string>): string {
  return content.replaceAll(/\{\{(\s*[\w.]+\s*)\}\}/g, (_, key: string) => {
    const k = key.trim();
    return Object.hasOwn(vars, k) ? vars[k] : `{{${k}}}`;
  });
}

// 列表（分页 + 搜索）
messageTemplatesRouter.get('/', guard({ permission: 'system:message-template:list' }), async (c) => {
  const keyword = c.req.query('keyword') ?? '';
  const channel = c.req.query('channel') ?? '';
  const status = c.req.query('status') ?? '';
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '10')));

  const conditions = [];
  if (keyword) {
    conditions.push(or(ilike(messageTemplates.name, `%${keyword}%`), ilike(messageTemplates.code, `%${keyword}%`)));
  }
  if (channel) {
    conditions.push(eq(messageTemplates.channel, channel as 'email' | 'sms' | 'in_app'));
  }
  if (status) {
    conditions.push(eq(messageTemplates.status, status as 'active' | 'disabled'));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ total: count() }).from(messageTemplates).where(where);
  const total = totalRow?.total ?? 0;
  const list = await db
    .select()
    .from(messageTemplates)
    .where(where)
    .orderBy(messageTemplates.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: { list: list.map(toMessageTemplate), total, page, pageSize },
  });
});

// 获取单条
messageTemplatesRouter.get('/:id', guard({ permission: 'system:message-template:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1);
  if (!row) return c.json({ code: 404, message: '模板不存在', data: null }, 404);
  return c.json({ code: 0, message: 'ok', data: toMessageTemplate(row) });
});

// 新增
messageTemplatesRouter.post('/', guard({ permission: 'system:message-template:create', audit: { description: '创建消息模板', module: '消息模板' } }), async (c) => {
  const body = await c.req.json();
  const result = createMessageTemplateSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  try {
    const [row] = await db.insert(messageTemplates).values(result.data).returning();
    return c.json({ code: 0, message: '创建成功', data: toMessageTemplate(row) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '模板编码已存在', data: null }, 400);
    }
    throw err;
  }
});

// 更新
messageTemplatesRouter.put('/:id', guard({ permission: 'system:message-template:update', audit: { description: '更新消息模板', module: '消息模板' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateMessageTemplateSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  try {
    const [row] = await db
      .update(messageTemplates)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(messageTemplates.id, id))
      .returning();
    if (!row) return c.json({ code: 404, message: '模板不存在', data: null }, 404);
    return c.json({ code: 0, message: '更新成功', data: toMessageTemplate(row) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ code: 400, message: '模板编码已存在', data: null }, 400);
    }
    throw err;
  }
});

// 删除
messageTemplatesRouter.delete('/:id', guard({ permission: 'system:message-template:delete', audit: { description: '删除消息模板', module: '消息模板' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [deleted] = await db.delete(messageTemplates).where(eq(messageTemplates.id, id)).returning();
  if (!deleted) return c.json({ code: 404, message: '模板不存在', data: null }, 404);
  return c.json({ code: 0, message: '删除成功', data: null });
});

// 预览（变量插值）
messageTemplatesRouter.post('/:id/preview', guard({ permission: 'system:message-template:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1);
  if (!row) return c.json({ code: 404, message: '模板不存在', data: null }, 404);

  const body = await c.req.json();
  const result = previewMessageTemplateSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const vars = result.data.variables;
  const renderedSubject = row.subject ? interpolate(row.subject, vars) : null;
  const renderedContent = interpolate(row.content, vars);

  return c.json({
    code: 0,
    message: 'ok',
    data: { subject: renderedSubject, content: renderedContent },
  });
});

export default messageTemplatesRouter;
