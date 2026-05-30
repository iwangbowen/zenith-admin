import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  PaginationQuery,
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  okMsg,
  IdParam,
  okBody,
} from '../lib/openapi-schemas';
import {
  DbAdminTableItemDTO,
  DbAdminTableStructureDTO,
  DbAdminQueryResultDTO,
  DbAdminExplainResultDTO,
  DbAdminQueryHistoryItemDTO,
  DbAdminErDiagramFkDTO,
  DbAdminErSchemaDTO,
  DbQueryFavoriteDTO,
} from '../lib/openapi-dtos';
import {
  listTables,
  getTableStructure,
  getTableRows,
  insertTableRow,
  updateTableRow,
  deleteTableRow,
  executeReadonlyQuery,
  explainQuery,
  exportQueryCsv,
  exportTableDataCsv,
  exportTableSql,
  truncateTable,
  listQueryHistory,
  clearQueryHistory,
  deleteQueryHistory,
  listAllForeignKeys,
  getErSchema,
  listQueryFavorites,
  createQueryFavorite,
  updateQueryFavorite,
  deleteQueryFavorite,
} from '../services/db-admin.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const TableNameParam = z.object({
  schema: z.string().openapi({ param: { in: 'path', name: 'schema' } }),
  name: z.string().openapi({ param: { in: 'path', name: 'name' } }),
});

const RowsQuery = PaginationQuery.extend({
  orderBy: z.string().optional(),
  orderDir: z.enum(['asc', 'desc']).optional(),
  /** JSON 字符串：{ 列名: 关键字 }，每列做 ILIKE 模糊匹配 */
  filters: z.string().optional(),
});

const TableRowsDTO = z
  .object({
    list: z.array(z.record(z.string(), z.unknown())),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  })
  .openapi('DbAdminTableRows');

const sqlBodySchema = z.object({ sql: z.string().min(1, 'SQL 不能为空').max(50000) });

// ─── 路由 ──────────────────────────────────────────────────────────────────────
const listTablesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tables', tags: ['DbAdmin'], summary: '表列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(DbAdminTableItemDTO), '表列表') },
  }),
  handler: async (c) => c.json(okBody(await listTables()), 200),
});

const tableStructureRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tables/{schema}/{name}/structure', tags: ['DbAdmin'], summary: '表结构',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    request: { params: TableNameParam },
    responses: { ...commonErrorResponses, ...ok(DbAdminTableStructureDTO, '表结构') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    return c.json(okBody(await getTableStructure(schema, name)), 200);
  },
});

const tableRowsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tables/{schema}/{name}/rows', tags: ['DbAdmin'], summary: '表数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    request: { params: TableNameParam, query: RowsQuery },
    responses: { ...commonErrorResponses, ...ok(TableRowsDTO, '表数据') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { page, pageSize, orderBy, orderDir, filters: filtersStr } = c.req.valid('query');
    let filters: Record<string, string> | undefined;
    if (filtersStr) {
      try {
        const parsed: unknown = JSON.parse(filtersStr);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          filters = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string' && v.length > 0) as Array<[string, string]>,
          );
        }
      } catch {
        // ignore invalid JSON; fall through with undefined filters
      }
    }
    const data = await getTableRows({ schema, name, page, pageSize, orderBy, orderDir, filters });
    return c.json(okBody(data), 200);
  },
});

const insertRowRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tables/{schema}/{name}/rows', tags: ['DbAdmin'], summary: '插入行',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:write',
      audit: { description: '插入表数据行', module: '数据库管理' },
    })] as const,
    request: {
      params: TableNameParam,
      body: { content: jsonContent(z.object({ values: z.record(z.string(), z.unknown()) })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(z.record(z.string(), z.unknown()), '新行') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { values } = c.req.valid('json');
    return c.json(okBody(await insertTableRow(schema, name, values)), 200);
  },
});

const updateRowRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'patch', path: '/tables/{schema}/{name}/rows', tags: ['DbAdmin'], summary: '更新行',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:write',
      audit: { description: '更新表数据行', module: '数据库管理' },
    })] as const,
    request: {
      params: TableNameParam,
      body: {
        content: jsonContent(z.object({
          pk: z.record(z.string(), z.unknown()),
          changes: z.record(z.string(), z.unknown()),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(z.record(z.string(), z.unknown()), '更新后的行') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { pk, changes } = c.req.valid('json');
    return c.json(okBody(await updateTableRow(schema, name, pk, changes)), 200);
  },
});

const deleteRowRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/tables/{schema}/{name}/rows', tags: ['DbAdmin'], summary: '删除行',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:write',
      audit: { description: '删除表数据行', module: '数据库管理' },
    })] as const,
    request: {
      params: TableNameParam,
      body: { content: jsonContent(z.object({ pk: z.record(z.string(), z.unknown()) })), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { pk } = c.req.valid('json');
    await deleteTableRow(schema, name, pk);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const executeQueryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/query', tags: ['DbAdmin'], summary: '执行只读 SQL',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:query',
      audit: { description: '执行 SQL 查询', module: '数据库管理' },
    })] as const,
    request: { body: { content: jsonContent(sqlBodySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DbAdminQueryResultDTO, '查询结果') },
  }),
  handler: async (c) => {
    const { sql } = c.req.valid('json');
    return c.json(okBody(await executeReadonlyQuery(sql)), 200);
  },
});

const explainRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/explain', tags: ['DbAdmin'], summary: 'EXPLAIN 查询计划',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:query',
      audit: { description: 'EXPLAIN SQL', module: '数据库管理' },
    })] as const,
    request: { body: { content: jsonContent(sqlBodySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DbAdminExplainResultDTO, '查询计划') },
  }),
  handler: async (c) => {
    const { sql } = c.req.valid('json');
    return c.json(okBody(await explainQuery(sql)), 200);
  },
});

const historyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/query/history', tags: ['DbAdmin'], summary: '查询历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(DbAdminQueryHistoryItemDTO, '查询历史') },
  }),
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listQueryHistory(page, pageSize)), 200);
  },
});

const deleteHistoryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/query/history/{id}', tags: ['DbAdmin'], summary: '删除一条查询历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:view',
      audit: { description: '删除查询历史', module: '数据库管理' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteQueryHistory(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const clearHistoryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/query/history', tags: ['DbAdmin'], summary: '清空查询历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:view',
      audit: { description: '清空查询历史', module: '数据库管理' },
    })] as const,
    responses: { ...commonErrorResponses, ...okMsg('已清空') },
  }),
  handler: async (c) => {
    await clearQueryHistory();
    return c.json(okBody(null, '已清空'), 200);
  },
});

const truncateTableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tables/{schema}/{name}/truncate', tags: ['DbAdmin'], summary: '截断表 (TRUNCATE)',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:write',
      audit: { description: '截断表 TRUNCATE', module: '数据库管理' },
    })] as const,
    request: { params: TableNameParam },
    responses: { ...commonErrorResponses, ...okMsg('已截断') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    await truncateTable(schema, name);
    return c.json(okBody(null, '已截断'), 200);
  },
});

const erDiagramRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/er-diagram', tags: ['DbAdmin'], summary: 'ER 图（所有外键关系）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(DbAdminErDiagramFkDTO), '外键关系列表') },
  }),
  handler: async (c) => c.json(okBody(await listAllForeignKeys()), 200),
});

const erSchemaRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/er-schema', tags: ['DbAdmin'], summary: 'ER 图完整模式（表 + 列 + 外键）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(DbAdminErSchemaDTO, 'ER 模式') },
  }),
  handler: async (c) => c.json(okBody(await getErSchema()), 200),
});

router.openapiRoutes([
  listTablesRoute,
  tableStructureRoute,
  tableRowsRoute,
  insertRowRoute,
  updateRowRoute,
  deleteRowRoute,
  truncateTableRoute,
  executeQueryRoute,
  explainRoute,
  historyRoute,
  deleteHistoryRoute,
  clearHistoryRoute,
  erDiagramRoute,
  erSchemaRoute,
] as const);

// 表 SQL 导出（DDL / INSERT / 完整）：流式响应
router.get('/tables/:schema/:name/export.sql', authMiddleware, guard({
  permission: 'system:db-admin:export',
  audit: { description: '导出表 SQL', module: '数据库管理' },
}), async (c) => {
  const { schema, name } = c.req.param();
  const mode = (c.req.query('mode') ?? 'full') as 'ddl' | 'data' | 'full';
  if (!['ddl', 'data', 'full'].includes(mode)) {
    return c.json({ code: 400, message: '无效的 mode 参数', data: null }, 400);
  }
  const stream = await exportTableSql(schema, name, mode);
  const suffixMap: Record<string, string> = { ddl: 'ddl', data: 'data', full: 'full' };
  const suffix = suffixMap[mode] ?? 'full';
  const filename = `${schema}_${name}_${suffix}_${Date.now()}.sql`;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// 表数据 CSV 导出：流式响应
router.get('/tables/:schema/:name/export.csv', authMiddleware, guard({
  permission: 'system:db-admin:export',
  audit: { description: '导出表数据 CSV', module: '数据库管理' },
}), async (c) => {
  const { schema, name } = c.req.param();
  const stream = await exportTableDataCsv(schema, name);
  const filename = `${schema}_${name}_${Date.now()}.csv`;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// SQL 查询结果 CSV 导出：流式响应，不在 OpenAPI Spec 中暴露（避免 schema 复杂度）
router.post('/query/export.csv', authMiddleware, guard({
  permission: 'system:db-admin:export',
  audit: { description: '导出 SQL 结果 CSV', module: '数据库管理' },
}), async (c) => {
  const body = await c.req.json<{ sql?: string }>();
  const stream = await exportQueryCsv(body.sql ?? '');
  const filename = `query_${Date.now()}.csv`;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// ─── SQL 收藏夹 CRUD ─────────────────────────────────────────────────────────

const favoritesCreateBody = z.object({
  name: z.string().min(1).max(100),
  sql: z.string().min(1),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

const favoritesUpdateBody = favoritesCreateBody.partial();

const listFavoritesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/query-favorites',
    tags: ['数据库管理'], summary: '获取 SQL 收藏夹列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:use' })] as const,
    request: {},
    responses: {
      ...commonErrorResponses,
      200: {
        content: { 'application/json': { schema: z.object({ code: z.number(), message: z.string(), data: z.array(DbQueryFavoriteDTO) }) } },
        description: '收藏夹列表',
      },
    },
  }),
  handler: async (c) => {
    const list = await listQueryFavorites();
    return c.json(okBody(list), 200);
  },
});

const createFavoriteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/query-favorites',
    tags: ['数据库管理'], summary: '新增 SQL 收藏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:use' })] as const,
    request: { body: { content: { 'application/json': { schema: favoritesCreateBody } }, required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(DbQueryFavoriteDTO, '新增成功'),
    },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const row = await createQueryFavorite(body);
    return c.json(okBody(row), 200);
  },
});

const updateFavoriteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/query-favorites/{id}',
    tags: ['数据库管理'], summary: '更新 SQL 收藏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:use' })] as const,
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: favoritesUpdateBody } }, required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(DbQueryFavoriteDTO, '更新成功'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = await updateQueryFavorite(id, body);
    return c.json(okBody(row), 200);
  },
});

const deleteFavoriteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/query-favorites/{id}',
    tags: ['数据库管理'], summary: '删除 SQL 收藏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:use' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteQueryFavorite(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listFavoritesRoute, createFavoriteRoute, updateFavoriteRoute, deleteFavoriteRoute] as const);

export default router;
