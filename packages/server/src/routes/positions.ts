import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, gte, inArray, like, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { positions, userPositions } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, errBody, okExcel, excelBody } from '../lib/openapi-schemas';
import { PositionDTO } from '../lib/openapi-dtos';

const positionsRouter = new OpenAPIHono({ defaultHook: validationHook });

function toPosition(row: typeof positions.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    sort: row.sort,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Schemas ───────────────────────────────────────────────────────────────
const createPositionSchema = z.object({
  name: z.string().min(1).max(64),
  code: z.string().min(1).max(64).regex(/^\w+$/),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['active', 'disabled']).default('active'),
  remark: z.string().max(256).optional(),
});
const updatePositionSchema = createPositionSchema.partial();
const BatchDeleteBody = z.object({ ids: z.array(z.number()) });

// ─── Routes ────────────────────────────────────────────────────────────────
const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/all',
    tags: ['Positions'],
    summary: '全量岗位（供下拉框）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    request: {},
    responses: { ...ok(z.array(PositionDTO), '全量岗位'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const tc = tenantCondition(positions, c.get('user'));
    const list = await db.select().from(positions).where(tc).orderBy(asc(positions.sort), asc(positions.id));
    return c.json(okBody(list.map(toPosition)), 200);
  },
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Positions'],
    summary: '岗位列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['active', 'disabled']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(PositionDTO, '岗位列表'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 10;
    const conditions = [];
    if (q.keyword) {
      conditions.push(or(like(positions.name, `%${q.keyword}%`), like(positions.code, `%${q.keyword}%`)));
    }
    if (q.status) conditions.push(eq(positions.status, q.status));
    if (q.startTime) conditions.push(gte(positions.createdAt, new Date(q.startTime)));
    if (q.endTime) conditions.push(lte(positions.createdAt, new Date(q.endTime)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const user = c.get('user');
    const tc = tenantCondition(positions, user);
    const finalWhere = where && tc ? and(where, tc) : (tc ?? where);

    const [count, list] = await Promise.all([
      db.$count(positions, finalWhere),
      db
        .select()
        .from(positions)
        .where(finalWhere)
        .orderBy(asc(positions.sort), asc(positions.id))
        .limit(pageSize)
        .offset(pageOffset(page, pageSize)),
    ]);

    return c.json(
      okBody({ list: list.map(toPosition), total: count, page, pageSize }),
      200,
    );
  },
});

const createPositionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Positions'],
    summary: '新增岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:create', audit: { description: '创建岗位', module: '岗位管理' } })] as const,
    request: { body: { content: jsonContent(createPositionSchema), required: true } },
    responses: {
      ...ok(PositionDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '编码冲突' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    try {
      const [position] = await db
        .insert(positions)
        .values({ ...data, tenantId: getCreateTenantId(c.get('user')) })
        .returning();
      return c.json(okBody(toPosition(position), '创建成功'), 200);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        return c.json(errBody('岗位编码已存在'), 400);
      }
      throw error;
    }
  },
});

const updatePositionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Positions'],
    summary: '更新岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:update', audit: { description: '更新岗位', module: '岗位管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updatePositionSchema), required: true },
    },
    responses: {
      ...ok(PositionDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '编码冲突' },
      404: { content: jsonContent(ErrorResponse), description: '岗位不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    try {
      const [position] = await db
        .update(positions)
        .set({ ...data })
        .where(and(eq(positions.id, id), tenantCondition(positions, c.get('user'))))
        .returning();
      if (!position) {
        return c.json(errBody('岗位不存在', 404), 404);
      }
      return c.json(okBody(toPosition(position), '更新成功'), 200);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        return c.json(errBody('岗位编码已存在'), 400);
      }
      throw error;
    }
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/batch',
    tags: ['Positions'],
    summary: '批量删除岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:delete', audit: { description: '批量删除岗位', module: '岗位管理' } })] as const,
    request: { body: { content: jsonContent(BatchDeleteBody), required: true } },
    responses: {
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误或有关联用户' },
    },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json(errBody('请选择要删除的岗位'), 400);
    }
    const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
    if (validIds.length === 0) {
      return c.json(errBody('岗位ID格式无效'), 400);
    }
    const bindings = await db
      .select({ positionId: userPositions.positionId })
      .from(userPositions)
      .where(inArray(userPositions.positionId, validIds));
    if (bindings.length > 0) {
      return c.json(errBody('所选岗位中存在关联用户，无法删除'), 400);
    }
    await db.delete(positions).where(and(inArray(positions.id, validIds), tenantCondition(positions, c.get('user'))));
    return c.json(okBody(null, `已删除 ${validIds.length} 个岗位`), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Positions'],
    summary: '删除岗位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:delete', audit: { description: '删除岗位', module: '岗位管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '存在关联用户' },
      404: { content: jsonContent(ErrorResponse), description: '岗位不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [position] = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.id, id), tenantCondition(positions, c.get('user'))))
      .limit(1);
    if (!position) {
      return c.json(errBody('岗位不存在', 404), 404);
    }

    const [binding] = await db
      .select({ positionId: userPositions.positionId })
      .from(userPositions)
      .where(eq(userPositions.positionId, id))
      .limit(1);
    if (binding) {
      return c.json(errBody('该岗位下仍有关联用户，无法删除'), 400);
    }

    await db.delete(positions).where(and(eq(positions.id, id), tenantCondition(positions, c.get('user'))));
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['Positions'],
    summary: '导出岗位 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:position:list' })] as const,
    responses: {
      ...okExcel('Excel 文件'),
    },
  }),
  handler: async (c) => {
    const rows = await db
      .select()
      .from(positions)
      .where(tenantCondition(positions, c.get('user')))
      .orderBy(asc(positions.sort));
    const buffer = await exportToExcel(
      [
        { header: 'ID', key: 'id', width: 8 },
        { header: '岗位名称', key: 'name', width: 18 },
        { header: '岗位编码', key: 'code', width: 18 },
        { header: '排序', key: 'sort', width: 8 },
        { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'active' ? '启用' : '禁用') },
        { header: '备注', key: 'remark', width: 24 },
        { header: '创建时间', key: 'createdAt', width: 22 },
      ],
      rows.map((r) => ({ ...r, remark: r.remark ?? '', createdAt: r.createdAt.toISOString() })),
      '岗位列表',
    );
    return excelBody(c, buffer, 'positions.xlsx');
  },
});

positionsRouter.openapiRoutes([allRoute, listRoute, createPositionRoute, updatePositionRoute, batchDeleteRoute, deleteRoute, exportRoute] as const);

export default positionsRouter;
