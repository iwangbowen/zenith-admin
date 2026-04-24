import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { regions } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import type { Region } from '@zenith/shared';
import { ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody, errBody } from '../lib/openapi-schemas';
import { RegionDTO } from '../lib/openapi-dtos';

const regionsRouter = new OpenAPIHono({ defaultHook: validationHook });

function toRegion(row: typeof regions.$inferSelect): Omit<Region, 'children'> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    level: row.level,
    parentCode: row.parentCode ?? null,
    sort: row.sort,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildTree(list: Omit<Region, 'children'>[]): Region[] {
  const map = new Map<string, Region>();
  list.forEach((item) => map.set(item.code, { ...item }));
  const roots: Region[] = [];

  map.forEach((node) => {
    if (!node.parentCode) {
      roots.push(node);
      return;
    }
    const parent = map.get(node.parentCode);
    if (parent) {
      parent.children = parent.children ?? [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: Region[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
    nodes.forEach((item) => item.children && sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function filterTree(nodes: Region[], keyword: string, status?: string, level?: string): Region[] {
  return nodes.reduce<Region[]>((acc, node) => {
    const children = node.children ? filterTree(node.children, keyword, status, level) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    const levelMatched = !level || node.level === level;
    if ((keywordMatched && statusMatched && levelMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const createRegionSchema = z.object({
  code: z.string().min(1).max(12),
  name: z.string().min(1).max(64),
  level: z.enum(['province', 'city', 'county']),
  parentCode: z.string().max(12).nullable().optional(),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['active', 'disabled']).default('active'),
});
const updateRegionSchema = createRegionSchema.partial();

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Regions'],
    summary: '地区树形结构',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:list' })] as const,
    request: {
      query: z.object({
        keyword: z.string().optional(),
        status: z.enum(['active', 'disabled']).optional(),
        level: z.enum(['province', 'city', 'county']).optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(RegionDTO), '地区树'),
    },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const rows = await db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code));
    const tree = buildTree(rows.map(toRegion));
    const data = q.keyword || q.status || q.level ? filterTree(tree, q.keyword ?? '', q.status, q.level) : tree;
    return c.json(okBody(data), 200);
  },
});

const flatRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/flat',
    tags: ['Regions'],
    summary: '平铺地区列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:list' })] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(RegionDTO), '平铺地区列表'),
    },
  }),
  handler: async (c) => {
    const rows = await db.select().from(regions).orderBy(asc(regions.sort), asc(regions.code));
    return c.json(okBody(rows.map(toRegion)), 200);
  },
});

const createRegionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Regions'],
    summary: '新增地区',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:create', audit: { description: '创建地区', module: '地区管理' } })] as const,
    request: { body: { content: jsonContent(createRegionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(RegionDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '父级不存在或代码重复' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    if (data.parentCode) {
      const [parent] = await db.select({ code: regions.code }).from(regions).where(eq(regions.code, data.parentCode));
      if (!parent) return c.json(errBody('父级地区不存在'), 400);
    }
    try {
      const [row] = await db
        .insert(regions)
        .values({
          code: data.code,
          name: data.name,
          level: data.level,
          parentCode: data.parentCode ?? null,
          sort: data.sort,
          status: data.status,
        })
        .returning();
      return c.json(okBody(toRegion(row), '创建成功'), 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json(errBody('区划代码已存在'), 400);
      }
      throw err;
    }
  },
});

const updateRegionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Regions'],
    summary: '更新地区',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:update', audit: { description: '更新地区', module: '地区管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateRegionSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(RegionDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '父级错误或重复' },
      404: { content: jsonContent(ErrorResponse), description: '地区不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    if (data.parentCode) {
      const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
      if (!current) return c.json(errBody('地区不存在', 404), 404);
      if (data.parentCode === current.code) {
        return c.json(errBody('父级地区不能选择自身'), 400);
      }
      const [parent] = await db.select({ code: regions.code }).from(regions).where(eq(regions.code, data.parentCode));
      if (!parent) return c.json(errBody('父级地区不存在'), 400);
    }
    try {
      const [row] = await db
        .update(regions)
        .set({ ...data })
        .where(eq(regions.id, id))
        .returning();
      if (!row) return c.json(errBody('地区不存在', 404), 404);
      return c.json(okBody(toRegion(row), '更新成功'), 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json(errBody('区划代码已存在'), 400);
      }
      throw err;
    }
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Regions'],
    summary: '删除地区',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:region:delete', audit: { description: '删除地区', module: '地区管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '存在子地区' },
      404: { content: jsonContent(ErrorResponse), description: '地区不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [current] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, id));
    if (!current) return c.json(errBody('地区不存在', 404), 404);

    const children = await db.select({ id: regions.id }).from(regions).where(eq(regions.parentCode, current.code));
    if (children.length > 0) {
      return c.json(errBody('该地区下存在子地区，请先删除子地区'), 400);
    }

    await db.delete(regions).where(eq(regions.id, id));
    return c.json(okBody(null, '删除成功'), 200);
  },
});

regionsRouter.openapiRoutes([listRoute, flatRoute, createRegionRoute, updateRegionRoute, deleteRoute] as const);

export default regionsRouter;
