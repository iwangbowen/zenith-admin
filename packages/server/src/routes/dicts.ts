import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq, asc, and, or, like, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { dicts, dictItems } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { apiResponse, paginatedResponse, ErrorResponse, MessageResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';
import { createDictSchema, updateDictSchema, createDictItemSchema, updateDictItemSchema } from '@zenith/shared';
import { DictDTO, DictItemDTO } from '../lib/openapi-dtos';

const dictsRouter = new OpenAPIHono({ defaultHook: validationHook });

function toDict(row: typeof dicts.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function toDictItem(row: typeof dictItems.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}


// ─── 字典 CRUD ────────────────────────────────────────────────────────────────

const listDictsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Dicts'],
    summary: '字典列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:list' })] as const,
    request: {
      query: z.object({
        keyword: z.string().optional(),
        status: z.enum(['active', 'disabled']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        page: z.coerce.number().optional().default(1),
        pageSize: z.coerce.number().optional().default(10),
      }),
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(paginatedResponse(DictDTO)), description: '字典列表' },
    },
  }),
  handler: async (c) => {
    const { keyword = '', status = '', startDate = '', endDate = '', page, pageSize } = c.req.valid('query');
    const conditions = [];
    if (keyword) conditions.push(or(like(dicts.name, `%${keyword}%`), like(dicts.code, `%${keyword}%`)));
    if (status) conditions.push(eq(dicts.status, status));
    if (startDate) conditions.push(gte(dicts.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(dicts.createdAt, new Date(`${endDate}T23:59:59.999Z`)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const tc = tenantCondition(dicts, c.get('user'));
    const finalWhere = where && tc ? and(where, tc) : (tc ?? where);
    const total = await db.$count(dicts, finalWhere);
    const list = await db.select().from(dicts).where(finalWhere).orderBy(dicts.id).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ code: 0 as const, message: 'ok', data: { list: list.map(toDict), total, page, pageSize } }, 200);
  },
});

const createDictRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Dicts'],
    summary: '创建字典',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:dict:create', audit: { description: '创建字典', module: '字典管理' } }),
    ] as const,
    request: { body: { content: jsonContent(createDictSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(DictDTO)), description: '创建成功' },
      400: { content: jsonContent(ErrorResponse), description: '字典编码已存在' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    try {
      const [dict] = await db
        .insert(dicts)
        .values({ ...data, tenantId: getCreateTenantId(c.get('user')) })
        .returning();
      return c.json({ code: 0 as const, message: '创建成功', data: toDict(dict) }, 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json({ code: 400, message: '字典编码已存在', data: null }, 400);
      }
      throw err;
    }
  },
});

const updateDictRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Dicts'],
    summary: '更新字典',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:dict:update', audit: { description: '更新字典', module: '字典管理' } }),
    ] as const,
    request: {
      params: z.object({ id: z.coerce.number() }),
      body: { content: jsonContent(updateDictSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(DictDTO)), description: '更新成功' },
      404: { content: jsonContent(ErrorResponse), description: '字典不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const [dict] = await db
      .update(dicts)
      .set({ ...data })
      .where(and(eq(dicts.id, id), tenantCondition(dicts, c.get('user'))))
      .returning();
    if (!dict) return c.json({ code: 404, message: '字典不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '更新成功', data: toDict(dict) }, 200);
  },
});

const deleteDictRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Dicts'],
    summary: '删除字典',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:dict:delete', audit: { description: '删除字典', module: '字典管理' } }),
    ] as const,
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(MessageResponse), description: '删除成功' },
      404: { content: jsonContent(ErrorResponse), description: '字典不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [deleted] = await db
      .delete(dicts)
      .where(and(eq(dicts.id, id), tenantCondition(dicts, c.get('user'))))
      .returning();
    if (!deleted) return c.json({ code: 404, message: '字典不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
  },
});

// ─── 字典项 CRUD ────────────────────────────────────────────────────────────

const listItemsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/items',
    tags: ['Dicts'],
    summary: '获取字典下所有字典项',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:list' })] as const,
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(z.array(DictItemDTO))), description: '字典项列表' },
    },
  }),
  handler: async (c) => {
    const { id: dictId } = c.req.valid('param');
    const items = await db
      .select()
      .from(dictItems)
      .where(eq(dictItems.dictId, dictId))
      .orderBy(asc(dictItems.sort), asc(dictItems.id));
    return c.json({ code: 0 as const, message: 'ok', data: items.map(toDictItem) }, 200);
  },
});

const getItemsByCodeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/code/{code}/items',
    tags: ['Dicts'],
    summary: '通过字典编码获取字典项（供前端使用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ code: z.string() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(z.array(DictItemDTO))), description: '字典项列表' },
      404: { content: jsonContent(ErrorResponse), description: '字典不存在' },
    },
  }),
  handler: async (c) => {
    const { code } = c.req.valid('param');
    const [dict] = await db.select({ id: dicts.id }).from(dicts).where(eq(dicts.code, code)).limit(1);
    if (!dict) return c.json({ code: 404, message: '字典不存在', data: null }, 404);
    const items = await db
      .select()
      .from(dictItems)
      .where(eq(dictItems.dictId, dict.id))
      .orderBy(asc(dictItems.sort));
    return c.json({ code: 0 as const, message: 'ok', data: items.map(toDictItem) }, 200);
  },
});

const createItemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/items',
    tags: ['Dicts'],
    summary: '创建字典项',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:dict:item', audit: { description: '创建字典项', module: '字典管理' } }),
    ] as const,
    request: {
      params: z.object({ id: z.coerce.number() }),
      body: { content: jsonContent(createDictItemSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(DictItemDTO)), description: '创建成功' },
    },
  }),
  handler: async (c) => {
    const { id: dictId } = c.req.valid('param');
    const data = c.req.valid('json');
    const [item] = await db.insert(dictItems).values({ ...data, dictId }).returning();
    return c.json({ code: 0 as const, message: '创建成功', data: toDictItem(item) }, 200);
  },
});

const updateItemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/items/{itemId}',
    tags: ['Dicts'],
    summary: '更新字典项',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:dict:item', audit: { description: '更新字典项', module: '字典管理' } }),
    ] as const,
    request: {
      params: z.object({ id: z.coerce.number(), itemId: z.coerce.number() }),
      body: { content: jsonContent(updateDictItemSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(DictItemDTO)), description: '更新成功' },
      404: { content: jsonContent(ErrorResponse), description: '字典项不存在' },
    },
  }),
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const data = c.req.valid('json');
    const [item] = await db
      .update(dictItems)
      .set({ ...data })
      .where(eq(dictItems.id, itemId))
      .returning();
    if (!item) return c.json({ code: 404, message: '字典项不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '更新成功', data: toDictItem(item) }, 200);
  },
});

const deleteItemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}/items/{itemId}',
    tags: ['Dicts'],
    summary: '删除字典项',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:dict:item', audit: { description: '删除字典项', module: '字典管理' } }),
    ] as const,
    request: { params: z.object({ id: z.coerce.number(), itemId: z.coerce.number() }) },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(MessageResponse), description: '删除成功' },
      404: { content: jsonContent(ErrorResponse), description: '字典项不存在' },
    },
  }),
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const [deleted] = await db.delete(dictItems).where(eq(dictItems.id, itemId)).returning();
    if (!deleted) return c.json({ code: 404, message: '字典项不存在', data: null }, 404);
    return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['Dicts'],
    summary: '导出字典 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:dict:list' })] as const,
    responses: {
      ...commonErrorResponses,
      200: {
        description: 'Excel 文件',
        content: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
            schema: z.string().openapi({ format: 'binary' }),
          },
        },
      },
    },
  }),
  handler: async (c) => {
    const rows = await db
      .select()
      .from(dicts)
      .where(tenantCondition(dicts, c.get('user')))
      .orderBy(asc(dicts.id));
    const buffer = await exportToExcel(
      [
        { header: 'ID', key: 'id', width: 8 },
        { header: '字典名称', key: 'name', width: 20 },
        { header: '字典编码', key: 'code', width: 20 },
        { header: '备注', key: 'remark', width: 30 },
        { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'active' ? '启用' : '禁用') },
        { header: '创建时间', key: 'createdAt', width: 22 },
      ],
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      '字典列表',
    );
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename=dicts.xlsx');
    return c.body(buffer);
  },
});

dictsRouter.openapiRoutes([listDictsRoute, createDictRoute, updateDictRoute, deleteDictRoute, listItemsRoute, getItemsByCodeRoute, createItemRoute, updateItemRoute, deleteItemRoute, exportRoute] as const);

export default dictsRouter;
