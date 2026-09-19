import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { dbAdminContract } from '@zenith/shared/ops';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
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
import {
  createDbBackup,
  deleteDbBackup,
  getDbBackupBeforeAudit,
  getDbBackupFileForDownload,
  listDbBackups,
} from '../../services/ops/db-admin-backups.service';
import { attachmentDisposition } from '../../lib/content-disposition';
import { readStoredFile } from '../../lib/file-storage';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 流式导出的公共响应头：禁止缓存、禁止嗅探 */
function downloadHeaders(contentType: string, filename: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Disposition': attachmentDisposition(filename),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

// ─── 表 / 总览 / 结构 / 数据 ───────────────────────────────────────────────────

const listTablesRoute = defineContractRoute(dbAdminContract.tables, {
  handler: async (c) => c.json(okBody(await listTables()), 200),
});

const overviewRoute = defineContractRoute(dbAdminContract.overview, {
  handler: async (c) => c.json(okBody(await getOverview()), 200),
});

const tableStructureRoute = defineContractRoute(dbAdminContract.tableStructure, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    return c.json(okBody(await getTableStructure(schema, name)), 200);
  },
});

const tableRowsRoute = defineContractRoute(dbAdminContract.tableRows, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const query = c.req.valid('query');
    // 原生 WHERE 片段可含跨表子查询，要求与 SQL 控制台一致的 query 权限
    if (query.where?.trim()) {
      const user = c.get('user');
      if (!isSuperAdmin(user)) {
        const perms = await getUserPermissions(user.userId);
        if (!perms.includes('system:db-admin:query')) {
          throw new HTTPException(403, { message: '使用 WHERE 条件需要 SQL 查询权限（system:db-admin:query）' });
        }
      }
    }
    return c.json(okBody(await getTableRows(schema, name, query)), 200);
  },
});

const insertRowRoute = defineContractRoute(dbAdminContract.insertRow, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { values } = c.req.valid('json');
    return c.json(okBody(await insertTableRow(schema, name, values)), 200);
  },
});

const updateRowRoute = defineContractRoute(dbAdminContract.updateRow, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { pk, changes } = c.req.valid('json');
    const before = await getTableRowBeforeAudit(schema, name, pk);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateTableRow(schema, name, pk, changes)), 200);
  },
});

const deleteRowRoute = defineContractRoute(dbAdminContract.deleteRow, {
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
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { inserts, updates, deletes } = c.req.valid('json');
    const result = await batchMutateTableRows(schema, name, { inserts, updates, deletes });
    setAuditAfterData(c, { schema, name, ...result });
    return c.json(okBody(result), 200);
  },
});

const importRowsRoute = defineContractRoute(dbAdminContract.importRows, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { rows } = c.req.valid('json');
    return c.json(okBody(await importTableData(schema, name, rows)), 200);
  },
});

const truncateTableRoute = defineContractRoute(dbAdminContract.truncateTable, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    await truncateTable(schema, name);
    setAuditAfterData(c, { schema, name, truncated: true });
    return c.json(okBody(null, '已截断'), 200);
  },
});

// 表 SQL 导出（DDL / INSERT / 完整）：流式响应
const exportTableSqlRoute = defineContractRoute(dbAdminContract.exportTableSql, {
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
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const stream = await exportTableDataCsv(schema, name);
    const filename = `${schema}_${name}_${Date.now()}.csv`;
    return new Response(stream, { status: 200, headers: downloadHeaders('text/csv; charset=utf-8', filename) });
  },
});

// ─── SQL 控制台 ──────────────────────────────────────────────────────────────

const executeQueryRoute = defineContractRoute(dbAdminContract.query, {
  handler: async (c) => {
    const { sql, queryId, page, pageSize } = c.req.valid('json');
    return c.json(okBody(await executeReadonlyQuery(sql, { queryId, page, pageSize })), 200);
  },
});

const cancelQueryRoute = defineContractRoute(dbAdminContract.cancelQuery, {
  handler: async (c) => {
    const { queryId } = c.req.valid('json');
    return c.json(okBody({ ok: await cancelQuery(queryId) }), 200);
  },
});

// SQL 查询结果 CSV 导出：流式响应
const exportQueryCsvRoute = defineContractRoute(dbAdminContract.exportQueryCsv, {
  handler: async (c) => {
    const { sql } = c.req.valid('json');
    const stream = await exportQueryCsv(sql);
    return new Response(stream, { status: 200, headers: downloadHeaders('text/csv; charset=utf-8', `query_${Date.now()}.csv`) });
  },
});

// SQL 查询结果 JSON 导出：流式响应
const exportQueryJsonRoute = defineContractRoute(dbAdminContract.exportQueryJson, {
  handler: async (c) => {
    const { sql } = c.req.valid('json');
    const stream = await exportQueryJson(sql);
    return new Response(stream, { status: 200, headers: downloadHeaders('application/json; charset=utf-8', `query_${Date.now()}.json`) });
  },
});

const explainRoute = defineContractRoute(dbAdminContract.explain, {
  handler: async (c) => {
    const { sql, analyze } = c.req.valid('json');
    return c.json(okBody(await explainQuery(sql, analyze ?? false)), 200);
  },
});

const historyRoute = defineContractRoute(dbAdminContract.history, {
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listQueryHistory(page, pageSize)), 200);
  },
});

const deleteHistoryRoute = defineContractRoute(dbAdminContract.removeHistory, {
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
  handler: async (c) => {
    const before = await getQueryHistoryClearBeforeAudit();
    if (before.total > 0) setAuditBeforeData(c, before);
    await clearQueryHistory();
    setAuditAfterData(c, { deleted: before.total });
    return c.json(okBody(null, '已清空'), 200);
  },
});

const erDiagramRoute = defineContractRoute(dbAdminContract.erDiagram, {
  handler: async (c) => c.json(okBody(await listAllForeignKeys()), 200),
});

const erSchemaRoute = defineContractRoute(dbAdminContract.erSchema, {
  handler: async (c) => c.json(okBody(await getErSchema()), 200),
});

// ─── SQL 收藏夹 ──────────────────────────────────────────────────────────────

const listFavoritesRoute = defineContractRoute(dbAdminContract.favorites, {
  handler: async (c) => c.json(okBody(await listQueryFavorites()), 200),
});

const createFavoriteRoute = defineContractRoute(dbAdminContract.createFavorite, {
  handler: async (c) => c.json(okBody(await createQueryFavorite(c.req.valid('json'))), 200),
});

const updateFavoriteRoute = defineContractRoute(dbAdminContract.updateFavorite, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    setAuditBeforeData(c, await getQueryFavoriteBeforeAudit(id));
    return c.json(okBody(await updateQueryFavorite(id, body)), 200);
  },
});

const deleteFavoriteRoute = defineContractRoute(dbAdminContract.removeFavorite, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getQueryFavoriteBeforeAudit(id));
    await deleteQueryFavorite(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 运维监控 / 对象浏览 / Schema 漂移 ───────────────────────────────────────────

const activityRoute = defineContractRoute(dbAdminContract.activity, {
  handler: async (c) => c.json(okBody(await getActiveConnections()), 200),
});

const cancelBackendRoute = defineContractRoute(dbAdminContract.cancelBackend, {
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    return c.json(okBody({ ok: await cancelBackend(pid) }), 200);
  },
});

const terminateBackendRoute = defineContractRoute(dbAdminContract.terminateBackend, {
  handler: async (c) => {
    const { pid } = c.req.valid('param');
    return c.json(okBody({ ok: await terminateBackend(pid) }), 200);
  },
});

const maintenanceRoute = defineContractRoute(dbAdminContract.maintenanceTables, {
  handler: async (c) => c.json(okBody(await getTableMaintenance()), 200),
});

const runMaintenanceRoute = defineContractRoute(dbAdminContract.runMaintenance, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    const { action } = c.req.valid('json');
    await runTableMaintenance(schema, name, action);
    return c.json(okBody(null, '已执行'), 200);
  },
});

const refreshMatviewRoute = defineContractRoute(dbAdminContract.refreshMatview, {
  handler: async (c) => {
    const { schema, name } = c.req.valid('param');
    await refreshMatview(schema, name);
    return c.json(okBody(null, '已刷新'), 200);
  },
});

const indexHealthRoute = defineContractRoute(dbAdminContract.indexHealth, {
  handler: async (c) => c.json(okBody(await getIndexHealth()), 200),
});

const objectsRoute = defineContractRoute(dbAdminContract.objects, {
  handler: async (c) => c.json(okBody(await listDbObjects()), 200),
});

const schemaDriftRoute = defineContractRoute(dbAdminContract.schemaDrift, {
  handler: async (c) => c.json(okBody(await getSchemaDrift()), 200),
});

const terminalAvailabilityRoute = defineContractRoute(dbAdminContract.terminalAvailability, {
  handler: async (c) => c.json(okBody(await getDbTerminalAvailability()), 200),
});

// ─── 数据库备份 ───────────────────────────────────────────────────────────────

const listBackupsRoute = defineContractRoute(dbAdminContract.backups, {
  handler: async (c) => c.json(okBody(await listDbBackups(c.req.valid('query'))), 200),
});

const createBackupRoute = defineContractRoute(dbAdminContract.createBackup, {
  handler: async (c) => c.json(okBody(await createDbBackup(c.req.valid('json')), '备份任务已创建'), 200),
});

// 备份产物是 restricted 托管文件：只能走这里（带 system:db-admin:view 校验），不能走通用的 /files/{id}/content
const downloadBackupRoute = defineContractRoute(dbAdminContract.downloadBackup, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { file, storageConfig } = await getDbBackupFileForDownload(id);
    const stored = await readStoredFile(file, storageConfig);
    return new Response(stored.stream, {
      status: 200,
      headers: {
        'Content-Type': stored.contentType,
        'Content-Length': String(file.size),
        'Content-Disposition': attachmentDisposition(file.originalName ?? `backup-${id}`),
      },
    });
  },
});

const deleteBackupRoute = defineContractRoute(dbAdminContract.removeBackup, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDbBackupBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDbBackup(id);
    setAuditAfterData(c, { id, deleted: true });
    return c.json(okBody(null, '已删除'), 200);
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
  listBackupsRoute,
  createBackupRoute,
  downloadBackupRoute,
  deleteBackupRoute,
] as const);

export default router;
