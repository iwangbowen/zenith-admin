import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
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
  DbAdminOverviewDTO,
  DbQueryFavoriteDTO,
  DbAdminActivityConnectionDTO,
  DbAdminTableMaintenanceDTO,
  DbAdminIndexHealthDTO,
  DbAdminObjectsDTO,
  DbAdminSchemaDriftDTO,
  DbAdminOpResultDTO,
  DbAdminImportResultDTO,
} from '../lib/openapi-dtos';
import {
  listTables,
  getOverview,
  getTableStructure,
  getTableRows,
  insertTableRow,
  updateTableRow,
  deleteTableRow,
  batchMutateTableRows,
  importTableData,
  executeReadonlyQuery,
  cancelQuery,
  explainQuery,
  exportQueryCsv,
  exportQueryJson,
  exportTableDataCsv,
  exportTableSql,
  truncateTable,
  listQueryHistory,
  getQueryHistoryBeforeAudit,
  getQueryHistoryClearBeforeAudit,
  clearQueryHistory,
  deleteQueryHistory,
  getTableRowBeforeAudit,
  listAllForeignKeys,
  getErSchema,
  listQueryFavorites,
  getQueryFavoriteBeforeAudit,
  createQueryFavorite,
  updateQueryFavorite,
  deleteQueryFavorite,
} from '../services/db-admin.service';
import {
  getActiveConnections,
  cancelBackend,
  terminateBackend,
  getTableMaintenance,
  runTableMaintenance,
  refreshMatview,
  getIndexHealth,
  listDbObjects,
  getSchemaDrift,
  type MaintenanceAction,
} from '../services/db-admin-ops.service';

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
  /** 全列模糊搜索关键字 */
  search: z.string().optional(),
  /** 原生 WHERE 片段（需 system:db-admin:query 权限，可跨表子查询） */
  where: z.string().max(2000).optional(),
});

const sqlBodySchema = z.object({ sql: z.string().min(1, 'SQL 不能为空').max(50000) });
const explainBodySchema = sqlBodySchema.extend({ analyze: z.boolean().optional() });
const queryBodySchema = sqlBodySchema.extend({
  queryId: z.string().max(64).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
});

const TableRowsDTO = z
  .object({
    list: z.array(z.record(z.string(), z.unknown())),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  })
  .openapi('DbAdminTableRows');

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

const overviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/overview', tags: ['DbAdmin'], summary: '数据库总览',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(DbAdminOverviewDTO, '数据库总览') },
  }),
  handler: async (c) => c.json(okBody(await getOverview()), 200),
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
    const { page, pageSize, orderBy, orderDir, filters: filtersStr, search, where } = c.req.valid('query');
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
    // 原生 WHERE 片段可含跨表子查询，要求与 SQL 控制台一致的 query 权限
    if (where?.trim()) {
      const user = c.get('user');
      if (!isSuperAdmin(user.roles)) {
        const perms = await getUserPermissions(user.userId);
        if (!perms.includes('system:db-admin:query')) {
          throw new HTTPException(403, { message: '使用 WHERE 条件需要 SQL 查询权限（system:db-admin:query）' });
        }
      }
    }
    const data = await getTableRows({
      schema, name, page, pageSize, orderBy, orderDir, filters, search,
      whereRaw: where?.trim() ? where : undefined,
    });
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
    const before = await getTableRowBeforeAudit(schema, name, pk);
    if (before) setAuditBeforeData(c, before);
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
    const before = await getTableRowBeforeAudit(schema, name, pk);
    if (before) setAuditBeforeData(c, before);
    await deleteTableRow(schema, name, pk);
    setAuditAfterData(c, { schema, name, pk, deleted: true });
    return c.json(okBody(null, '已删除'), 200);
  },
});

const importRowsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tables/{schema}/{name}/import', tags: ['DbAdmin'], summary: '批量导入数据 (CSV/JSON)',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:write',
      audit: { description: '批量导入表数据', module: '数据库管理', recordBody: false },
    })] as const,
    request: {
      params: TableNameParam,
      body: { content: jsonContent(z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(100000) })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(DbAdminImportResultDTO, '导入结果') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { rows } = c.req.valid('json');
    return c.json(okBody(await importTableData(schema, name, rows)), 200);
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
    request: { body: { content: jsonContent(queryBodySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DbAdminQueryResultDTO, '查询结果') },
  }),
  handler: async (c) => {
    const { sql, queryId, page, pageSize } = c.req.valid('json');
    return c.json(okBody(await executeReadonlyQuery(sql, { queryId, page, pageSize })), 200);
  },
});

const cancelQueryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/query/cancel', tags: ['DbAdmin'], summary: '取消正在执行的查询',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:query',
      audit: { description: '取消正在执行的 SQL 查询', module: '数据库管理' },
    })] as const,
    request: { body: { content: jsonContent(z.object({ queryId: z.string().min(1).max(64) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(DbAdminOpResultDTO, '取消结果') },
  }),
  handler: async (c) => {
    const { queryId } = c.req.valid('json');
    return c.json(okBody({ ok: await cancelQuery(queryId) }), 200);
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
    request: { body: { content: jsonContent(explainBodySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(DbAdminExplainResultDTO, '查询计划') },
  }),
  handler: async (c) => {
    const { sql, analyze } = c.req.valid('json');
    return c.json(okBody(await explainQuery(sql, analyze ?? false)), 200);
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
    const before = await getQueryHistoryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteQueryHistory(id);
    setAuditAfterData(c, { id, deleted: true });
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
    const before = await getQueryHistoryClearBeforeAudit();
    if (before.total > 0) setAuditBeforeData(c, before);
    await clearQueryHistory();
    setAuditAfterData(c, { deleted: before.total });
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
    setAuditAfterData(c, { schema, name, truncated: true });
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

const batchMutateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tables/{schema}/{name}/batch-mutate', tags: ['DbAdmin'], summary: '批量变更行（事务：插入/更新/删除）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:write',
      audit: { description: '批量变更表数据行', module: '数据库管理' },
    })] as const,
    request: {
      params: TableNameParam,
      body: {
        content: jsonContent(z.object({
          inserts: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
          updates: z.array(z.object({
            pk: z.record(z.string(), z.unknown()),
            changes: z.record(z.string(), z.unknown()),
          })).max(500).optional(),
          deletes: z.array(z.object({
            pk: z.record(z.string(), z.unknown()),
          })).max(500).optional(),
        })),
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({ inserted: z.number(), updated: z.number(), deleted: z.number() }), '变更统计'),
    },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { inserts, updates, deletes } = c.req.valid('json');
    const result = await batchMutateTableRows(schema, name, { inserts, updates, deletes });
    setAuditAfterData(c, { schema, name, ...result });
    return c.json(okBody(result), 200);
  },
});

router.openapiRoutes([
  listTablesRoute,
  overviewRoute,
  tableStructureRoute,
  tableRowsRoute,
  insertRowRoute,
  updateRowRoute,
  deleteRowRoute,
  batchMutateRoute,
  importRowsRoute,
  truncateTableRoute,
  executeQueryRoute,
  cancelQueryRoute,
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

// SQL 查询结果 JSON 导出：流式响应
router.post('/query/export.json', authMiddleware, guard({
  permission: 'system:db-admin:export',
  audit: { description: '导出 SQL 结果 JSON', module: '数据库管理' },
}), async (c) => {
  const body = await c.req.json<{ sql?: string }>();
  const stream = await exportQueryJson(body.sql ?? '');
  const filename = `query_${Date.now()}.json`;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
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
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
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
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:view',
      audit: { description: '新增 SQL 收藏', module: '数据库管理' },
    })] as const,
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
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:view',
      audit: { description: '更新 SQL 收藏', module: '数据库管理' },
    })] as const,
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
    setAuditBeforeData(c, await getQueryFavoriteBeforeAudit(id));
    const row = await updateQueryFavorite(id, body);
    return c.json(okBody(row), 200);
  },
});

const deleteFavoriteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/query-favorites/{id}',
    tags: ['数据库管理'], summary: '删除 SQL 收藏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:view',
      audit: { description: '删除 SQL 收藏', module: '数据库管理' },
    })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getQueryFavoriteBeforeAudit(id));
    await deleteQueryFavorite(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listFavoritesRoute, createFavoriteRoute, updateFavoriteRoute, deleteFavoriteRoute] as const);

// ─── 运维监控 / 对象浏览 / Schema 漂移 ───────────────────────────────────────────
const PidParam = z.object({
  pid: z.coerce.number().int().openapi({ param: { in: 'path', name: 'pid' }, example: 12345 }),
});

const activityRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/activity', tags: ['DbAdmin'], summary: '活动连接列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(DbAdminActivityConnectionDTO), '活动连接') },
  }),
  handler: async (c) => c.json(okBody(await getActiveConnections()), 200),
});

const cancelBackendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/activity/{pid}/cancel', tags: ['DbAdmin'], summary: '取消查询',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:maintain',
      audit: { description: '取消数据库查询', module: '数据库管理' },
    })] as const,
    request: { params: PidParam },
    responses: { ...commonErrorResponses, ...ok(DbAdminOpResultDTO, '操作结果') },
  }),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    return c.json(okBody({ ok: await cancelBackend(pid) }), 200);
  },
});

const terminateBackendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/activity/{pid}/terminate', tags: ['DbAdmin'], summary: '终止连接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:maintain',
      audit: { description: '终止数据库连接', module: '数据库管理' },
    })] as const,
    request: { params: PidParam },
    responses: { ...commonErrorResponses, ...ok(DbAdminOpResultDTO, '操作结果') },
  }),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    return c.json(okBody({ ok: await terminateBackend(pid) }), 200);
  },
});

const maintenanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/maintenance/tables', tags: ['DbAdmin'], summary: '表维护统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(DbAdminTableMaintenanceDTO), '表维护统计') },
  }),
  handler: async (c) => c.json(okBody(await getTableMaintenance()), 200),
});

const runMaintenanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tables/{schema}/{name}/maintenance', tags: ['DbAdmin'], summary: '执行表维护 (VACUUM/ANALYZE/REINDEX)',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:maintain',
      audit: { description: '执行表维护', module: '数据库管理' },
    })] as const,
    request: {
      params: TableNameParam,
      body: { content: jsonContent(z.object({ action: z.enum(['vacuum', 'vacuum_analyze', 'analyze', 'reindex']) })), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('已执行') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { action } = c.req.valid('json');
    await runTableMaintenance(schema, name, action as MaintenanceAction);
    return c.json(okBody(null, '已执行'), 200);
  },
});

const refreshMatviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tables/{schema}/{name}/refresh', tags: ['DbAdmin'], summary: '刷新物化视图',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:db-admin:maintain',
      audit: { description: '刷新物化视图', module: '数据库管理' },
    })] as const,
    request: { params: TableNameParam },
    responses: { ...commonErrorResponses, ...okMsg('已刷新') },
  }),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    await refreshMatview(schema, name);
    return c.json(okBody(null, '已刷新'), 200);
  },
});

const indexHealthRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/index-health', tags: ['DbAdmin'], summary: '索引健康',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(DbAdminIndexHealthDTO, '索引健康') },
  }),
  handler: async (c) => c.json(okBody(await getIndexHealth()), 200),
});

const objectsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/objects', tags: ['DbAdmin'], summary: '数据库对象（序列/函数/触发器/枚举/扩展）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(DbAdminObjectsDTO, '数据库对象') },
  }),
  handler: async (c) => c.json(okBody(await listDbObjects()), 200),
});

const schemaDriftRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/schema-drift', tags: ['DbAdmin'], summary: 'Drizzle Schema 漂移对照',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(DbAdminSchemaDriftDTO, 'Schema 漂移') },
  }),
  handler: async (c) => c.json(okBody(await getSchemaDrift()), 200),
});

router.openapiRoutes([
  activityRoute,
  cancelBackendRoute,
  terminateBackendRoute,
  maintenanceRoute,
  runMaintenanceRoute,
  refreshMatviewRoute,
  indexHealthRoute,
  objectsRoute,
  schemaDriftRoute,
] as const);

export default router;
