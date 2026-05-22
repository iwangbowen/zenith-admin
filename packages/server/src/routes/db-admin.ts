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
  listQueryHistory,
  clearQueryHistory,
  deleteQueryHistory,
  listAllForeignKeys,
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

const erDiagramRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/er-diagram', tags: ['DbAdmin'], summary: 'ER 图（所有外键关系）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(DbAdminErDiagramFkDTO), '外键关系列表') },
  }),
  handler: async (c) => c.json(okBody(await listAllForeignKeys()), 200),
});

router.openapiRoutes([
  listTablesRoute,
  tableStructureRoute,
  tableRowsRoute,
  insertRowRoute,
  updateRowRoute,
  deleteRowRoute,
  executeQueryRoute,
  explainRoute,
  historyRoute,
  deleteHistoryRoute,
  clearHistoryRoute,
  erDiagramRoute,
] as const);

// CSV 导出：流式响应，不在 OpenAPI Spec 中暴露（避免 schema 复杂度）
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

export default router;
