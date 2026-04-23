import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq, and, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { messageTemplates } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { previewMessageTemplateSchema } from '@zenith/shared';
import { apiResponse, ErrorResponse, MessageResponse, paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';
import { MessageTemplateDTO, MessageTemplatePreviewDTO as PreviewResultDTO } from '../lib/openapi-dtos';

const messageTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

function toMessageTemplate(row: typeof messageTemplates.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function interpolate(content: string, vars: Record<string, string>): string {
  return content.replaceAll(/\{\{(\s*[\w.]+\s*)\}\}/g, (_, key: string) => {
    const k = key.trim();
    return Object.hasOwn(vars, k) ? vars[k] : `{{${k}}}`;
  });
}

// ─── Schemas ───────────────────────────────────────────────────────────────
const createMessageTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(100).regex(/^[a-zA-Z]\w*$/),
  channel: z.enum(['email', 'sms', 'in_app']),
  subject: z.string().max(200).optional(),
  content: z.string().min(1),
  variables: z.string().optional(),
  status: z.enum(['active', 'disabled']).default('active'),
  remark: z.string().max(500).optional(),
});
const updateMessageTemplateSchema = createMessageTemplateSchema.partial();

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['MessageTemplates'],
    summary: '模板分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:list' })] as const,
    request: {
      query: z.object({
        keyword: z.string().optional(),
        channel: z.enum(['email', 'sms', 'in_app']).optional(),
        status: z.enum(['active', 'disabled']).optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(paginatedResponse(MessageTemplateDTO)), description: '模板列表' },
    },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 10)));

    const conditions = [];
    if (q.keyword) {
      conditions.push(or(ilike(messageTemplates.name, `%${q.keyword}%`), ilike(messageTemplates.code, `%${q.keyword}%`)));
    }
    if (q.channel) conditions.push(eq(messageTemplates.channel, q.channel));
    if (q.status) conditions.push(eq(messageTemplates.status, q.status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const total = await db.$count(messageTemplates, where);
    const list = await db
      .select()
      .from(messageTemplates)
      .where(where)
      .orderBy(messageTemplates.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return c.json(
      { code: 0 as const, message: 'ok', data: { list: list.map(toMessageTemplate), total, page, pageSize } },
      200,
    );
  },
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['MessageTemplates'],
    summary: '获取单个模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:list' })] as const,
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(MessageTemplateDTO)), description: '模板详情' },
      404: { content: jsonContent(ErrorResponse), description: '模板不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [row] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1);
    if (!row) return c.json({ code: 404, message: '模板不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: 'ok', data: toMessageTemplate(row) }, 200);
  },
});

const createTemplateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['MessageTemplates'],
    summary: '新增模板',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware, guard({ permission: 'system:message-template:create', audit: { description: '创建消息模板', module: '消息模板' } }),
    ] as const,
    request: { body: { content: jsonContent(createMessageTemplateSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(MessageTemplateDTO)), description: '创建成功' },
      400: { content: jsonContent(ErrorResponse), description: '编码冲突' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    try {
      const [row] = await db.insert(messageTemplates).values(data).returning();
      return c.json({ code: 0 as const, message: '创建成功', data: toMessageTemplate(row) }, 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json({ code: 400, message: '模板编码已存在', data: null }, 400);
      }
      throw err;
    }
  },
});

const updateTemplateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['MessageTemplates'],
    summary: '更新模板',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware, guard({ permission: 'system:message-template:update', audit: { description: '更新消息模板', module: '消息模板' } }),
    ] as const,
    request: {
      params: z.object({ id: z.coerce.number() }),
      body: { content: jsonContent(updateMessageTemplateSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(MessageTemplateDTO)), description: '更新成功' },
      400: { content: jsonContent(ErrorResponse), description: '编码冲突' },
      404: { content: jsonContent(ErrorResponse), description: '模板不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    try {
      const [row] = await db
        .update(messageTemplates)
        .set({ ...data })
        .where(eq(messageTemplates.id, id))
        .returning();
      if (!row) return c.json({ code: 404, message: '模板不存在', data: null }, 404);
      return c.json({ code: 0 as const, message: '更新成功', data: toMessageTemplate(row) }, 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json({ code: 400, message: '模板编码已存在', data: null }, 400);
      }
      throw err;
    }
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['MessageTemplates'],
    summary: '删除模板',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware, guard({ permission: 'system:message-template:delete', audit: { description: '删除消息模板', module: '消息模板' } }),
    ] as const,
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(MessageResponse), description: '删除成功' },
      404: { content: jsonContent(ErrorResponse), description: '模板不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [deleted] = await db.delete(messageTemplates).where(eq(messageTemplates.id, id)).returning();
    if (!deleted) return c.json({ code: 404, message: '模板不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
  },
});

const previewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/preview',
    tags: ['MessageTemplates'],
    summary: '变量插值预览',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:list' })] as const,
    request: {
      params: z.object({ id: z.coerce.number() }),
      body: { content: jsonContent(previewMessageTemplateSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(PreviewResultDTO)), description: '预览结果' },
      404: { content: jsonContent(ErrorResponse), description: '模板不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [row] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1);
    if (!row) return c.json({ code: 404, message: '模板不存在', data: null }, 404);

    const { variables: vars } = c.req.valid('json');
    const renderedSubject = row.subject ? interpolate(row.subject, vars) : null;
    const renderedContent = interpolate(row.content, vars);

    return c.json(
      { code: 0 as const, message: 'ok', data: { subject: renderedSubject, content: renderedContent } },
      200,
    );
  },
});

messageTemplatesRouter.openapiRoutes([listRoute, getRoute, createTemplateRoute, updateTemplateRoute, deleteRoute, previewRoute] as const);

export default messageTemplatesRouter;
