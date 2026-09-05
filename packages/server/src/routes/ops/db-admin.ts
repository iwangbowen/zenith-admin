import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { dbAdminContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { isSuperAdmin, getUserPermissions } from '../../lib/permissions';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
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
} from '../../services/ops/db-admin.service';
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
} from '../../services/ops/db-admin-ops.service';
import { getDbTerminalAvailability } from '../../services/ops/db-admin-terminal.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:db-admin:view' })] as const;
const audited = (permission: string, description: string, recordBody = true) =>
  [authMiddleware, guard({ permission, audit: { description, module: '数据库管理', recordBody } })] as const;

/** 流式导出的公共响应头：禁止缓存、禁止嗅探 */
function downloadHeaders(contentType: string, filename: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

// ─── 表 / 总览 / 结构 / 数据 ───────────────────────────────────────────────────

const listTablesRoute = defineContractRoute(dbAdminContract.tables, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listTables()), 200),
});

const overviewRoute = defineContractRoute(dbAdminContract.overview, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getOverview()), 200),
});

const tableStructureRoute = defineContractRoute(dbAdminContract.tableStructure, {
  middleware: view,
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    return c.json(okBody(await getTableStructure(schema, name)), 200);
  },
});

const tableRowsRoute = defineContractRoute(dbAdminContract.tableRows, {
  middleware: view,
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
      if (!isSuperAdmin(user)) {
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

const insertRowRoute = defineContractRoute(dbAdminContract.insertRow, {
  middleware: audited('system:db-admin:write', '插入表数据行'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { values } = c.req.valid('json');
    return c.json(okBody(await insertTableRow(schema, name, values)), 200);
  },
});

const updateRowRoute = defineContractRoute(dbAdminContract.updateRow, {
  middleware: audited('system:db-admin:write', '更新表数据行'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { pk, changes } = c.req.valid('json');
    const before = await getTableRowBeforeAudit(schema, name, pk);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateTableRow(schema, name, pk, changes)), 200);
  },
});

const deleteRowRoute = defineContractRoute(dbAdminContract.deleteRow, {
  middleware: audited('system:db-admin:write', '删除表数据行'),
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

const batchMutateRoute = defineContractRoute(dbAdminContract.batchMutate, {
  middleware: audited('system:db-admin:write', '批量变更表数据行'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { inserts, updates, deletes } = c.req.valid('json');
    const result = await batchMutateTableRows(schema, name, { inserts, updates, deletes });
    setAuditAfterData(c, { schema, name, ...result });
    return c.json(okBody(result), 200);
  },
});

const importRowsRoute = defineContractRoute(dbAdminContract.importRows, {
  middleware: audited('system:db-admin:write', '批量导入表数据', false),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { rows } = c.req.valid('json');
    return c.json(okBody(await importTableData(schema, name, rows)), 200);
  },
});

const truncateTableRoute = defineContractRoute(dbAdminContract.truncateTable, {
  middleware: audited('system:db-admin:write', '截断表 TRUNCATE'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    await truncateTable(schema, name);
    setAuditAfterData(c, { schema, name, truncated: true });
    return c.json(okBody(null, '已截断'), 200);
  },
});

// 表 SQL 导出（DDL / INSERT / 完整）：流式响应
const exportTableSqlRoute = defineContractRoute(dbAdminContract.exportTableSql, {
  middleware: audited('system:db-admin:export', '导出表 SQL'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { mode } = c.req.valid('query');
    const stream = await exportTableSql(schema, name, mode);
    const filename = `${schema}_${name}_${mode}_${Date.now()}.sql`;
    return new Response(stream, { status: 200, headers: downloadHeaders('text/plain; charset=utf-8', filename) });
  },
});

// 表数据 CSV 导出：流式响应
const exportTableCsvRoute = defineContractRoute(dbAdminContract.exportTableCsv, {
  middleware: audited('system:db-admin:export', '导出表数据 CSV'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const stream = await exportTableDataCsv(schema, name);
    const filename = `${schema}_${name}_${Date.now()}.csv`;
    return new Response(stream, { status: 200, headers: downloadHeaders('text/csv; charset=utf-8', filename) });
  },
});

// ─── SQL 控制台 ──────────────────────────────────────────────────────────────

const executeQueryRoute = defineContractRoute(dbAdminContract.query, {
  middleware: audited('system:db-admin:query', '执行 SQL 查询'),
  handler: async (c) => {
    const { sql, queryId, page, pageSize } = c.req.valid('json');
    return c.json(okBody(await executeReadonlyQuery(sql, { queryId, page, pageSize })), 200);
  },
});

const cancelQueryRoute = defineContractRoute(dbAdminContract.cancelQuery, {
  middleware: audited('system:db-admin:query', '取消正在执行的 SQL 查询'),
  handler: async (c) => {
    const { queryId } = c.req.valid('json');
    return c.json(okBody({ ok: await cancelQuery(queryId) }), 200);
  },
});

// SQL 查询结果 CSV 导出：流式响应
const exportQueryCsvRoute = defineContractRoute(dbAdminContract.exportQueryCsv, {
  middleware: audited('system:db-admin:export', '导出 SQL 结果 CSV'),
  handler: async (c) => {
    const { sql } = c.req.valid('json');
    const stream = await exportQueryCsv(sql);
    return new Response(stream, { status: 200, headers: downloadHeaders('text/csv; charset=utf-8', `query_${Date.now()}.csv`) });
  },
});

// SQL 查询结果 JSON 导出：流式响应
const exportQueryJsonRoute = defineContractRoute(dbAdminContract.exportQueryJson, {
  middleware: audited('system:db-admin:export', '导出 SQL 结果 JSON'),
  handler: async (c) => {
    const { sql } = c.req.valid('json');
    const stream = await exportQueryJson(sql);
    return new Response(stream, { status: 200, headers: downloadHeaders('application/json; charset=utf-8', `query_${Date.now()}.json`) });
  },
});

const explainRoute = defineContractRoute(dbAdminContract.explain, {
  middleware: audited('system:db-admin:query', 'EXPLAIN SQL'),
  handler: async (c) => {
    const { sql, analyze } = c.req.valid('json');
    return c.json(okBody(await explainQuery(sql, analyze ?? false)), 200);
  },
});

const historyRoute = defineContractRoute(dbAdminContract.history, {
  middleware: view,
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listQueryHistory(page, pageSize)), 200);
  },
});

const deleteHistoryRoute = defineContractRoute(dbAdminContract.removeHistory, {
  middleware: audited('system:db-admin:view', '删除查询历史'),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getQueryHistoryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteQueryHistory(id);
    setAuditAfterData(c, { id, deleted: true });
    return c.json(okBody(null, '已删除'), 200);
  },
});

const clearHistoryRoute = defineContractRoute(dbAdminContract.clearHistory, {
  middleware: audited('system:db-admin:view', '清空查询历史'),
  handler: async (c) => {
    const before = await getQueryHistoryClearBeforeAudit();
    if (before.total > 0) setAuditBeforeData(c, before);
    await clearQueryHistory();
    setAuditAfterData(c, { deleted: before.total });
    return c.json(okBody(null, '已清空'), 200);
  },
});

const erDiagramRoute = defineContractRoute(dbAdminContract.erDiagram, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listAllForeignKeys()), 200),
});

const erSchemaRoute = defineContractRoute(dbAdminContract.erSchema, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getErSchema()), 200),
});

// ─── SQL 收藏夹 ──────────────────────────────────────────────────────────────

const listFavoritesRoute = defineContractRoute(dbAdminContract.favorites, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listQueryFavorites()), 200),
});

const createFavoriteRoute = defineContractRoute(dbAdminContract.createFavorite, {
  middleware: audited('system:db-admin:view', '新增 SQL 收藏'),
  handler: async (c) => c.json(okBody(await createQueryFavorite(c.req.valid('json'))), 200),
});

const updateFavoriteRoute = defineContractRoute(dbAdminContract.updateFavorite, {
  middleware: audited('system:db-admin:view', '更新 SQL 收藏'),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    setAuditBeforeData(c, await getQueryFavoriteBeforeAudit(id));
    return c.json(okBody(await updateQueryFavorite(id, body)), 200);
  },
});

const deleteFavoriteRoute = defineContractRoute(dbAdminContract.removeFavorite, {
  middleware: audited('system:db-admin:view', '删除 SQL 收藏'),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getQueryFavoriteBeforeAudit(id));
    await deleteQueryFavorite(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 运维监控 / 对象浏览 / Schema 漂移 ───────────────────────────────────────────

const activityRoute = defineContractRoute(dbAdminContract.activity, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getActiveConnections()), 200),
});

const cancelBackendRoute = defineContractRoute(dbAdminContract.cancelBackend, {
  middleware: audited('system:db-admin:maintain', '取消数据库查询'),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    return c.json(okBody({ ok: await cancelBackend(pid) }), 200);
  },
});

const terminateBackendRoute = defineContractRoute(dbAdminContract.terminateBackend, {
  middleware: audited('system:db-admin:maintain', '终止数据库连接'),
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    return c.json(okBody({ ok: await terminateBackend(pid) }), 200);
  },
});

const maintenanceRoute = defineContractRoute(dbAdminContract.maintenanceTables, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getTableMaintenance()), 200),
});

const runMaintenanceRoute = defineContractRoute(dbAdminContract.runMaintenance, {
  middleware: audited('system:db-admin:maintain', '执行表维护'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { action } = c.req.valid('json');
    await runTableMaintenance(schema, name, action);
    return c.json(okBody(null, '已执行'), 200);
  },
});

const refreshMatviewRoute = defineContractRoute(dbAdminContract.refreshMatview, {
  middleware: audited('system:db-admin:maintain', '刷新物化视图'),
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    await refreshMatview(schema, name);
    return c.json(okBody(null, '已刷新'), 200);
  },
});

const indexHealthRoute = defineContractRoute(dbAdminContract.indexHealth, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getIndexHealth()), 200),
});

const objectsRoute = defineContractRoute(dbAdminContract.objects, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listDbObjects()), 200),
});

const schemaDriftRoute = defineContractRoute(dbAdminContract.schemaDrift, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getSchemaDrift()), 200),
});

const terminalAvailabilityRoute = defineContractRoute(dbAdminContract.terminalAvailability, {
  middleware: [authMiddleware, guard({ permission: 'system:db-admin:terminal' })],
  handler: async (c) => c.json(okBody(await getDbTerminalAvailability()), 200),
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
  exportTableSqlRoute,
  exportTableCsvRoute,
  executeQueryRoute,
  cancelQueryRoute,
  exportQueryCsvRoute,
  exportQueryJsonRoute,
  explainRoute,
  historyRoute,
  deleteHistoryRoute,
  clearHistoryRoute,
  erDiagramRoute,
  erSchemaRoute,
  listFavoritesRoute,
  createFavoriteRoute,
  updateFavoriteRoute,
  deleteFavoriteRoute,
  activityRoute,
  cancelBackendRoute,
  terminateBackendRoute,
  maintenanceRoute,
  runMaintenanceRoute,
  refreshMatviewRoute,
  indexHealthRoute,
  objectsRoute,
  schemaDriftRoute,
  terminalAvailabilityRoute,
] as const);

export default router;
