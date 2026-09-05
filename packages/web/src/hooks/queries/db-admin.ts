import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { dbAdminContract, type CreateDbQueryFavoriteInput, type DbAdminSqlExportMode } from '@zenith/shared/ops';
import { api, contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type DbAdminHistoryParams = NonNullable<QueryOf<typeof dbAdminContract.history>>;

const tableParams = (schema: string, table: string) => ({ schema, name: table });

export const dbAdminKeys = {
  all: ['db-admin'] as const,
  tables: contractKey(dbAdminContract.tables),
  overview: contractKey(dbAdminContract.overview),
  structure: (schema: string | undefined, table: string | undefined) =>
    contractKey(dbAdminContract.tableStructure, { params: tableParams(schema ?? '', table ?? '') }),
  historyLists: contractKey(dbAdminContract.history),
  historyList: (params: DbAdminHistoryParams) => contractKey(dbAdminContract.history, { query: params }),
  erSchema: contractKey(dbAdminContract.erSchema),
  objects: contractKey(dbAdminContract.objects),
  activity: contractKey(dbAdminContract.activity),
  maintenance: contractKey(dbAdminContract.maintenanceTables),
  indexHealth: contractKey(dbAdminContract.indexHealth),
  schemaDrift: contractKey(dbAdminContract.schemaDrift),
  favorites: contractKey(dbAdminContract.favorites),
  terminalAvailability: contractKey(dbAdminContract.terminalAvailability),
};

// ─── 只读查询 ─────────────────────────────────────────────────────────────────

export function useDbAdminOverview() {
  return useApiQuery(dbAdminContract.overview);
}

export function useDbAdminTables() {
  return useApiQuery(dbAdminContract.tables);
}

/** 数据库终端（psql）可用性；服务端环境探测结果，短期内视为静态 */
export function useDbAdminTerminalAvailability(enabled: boolean) {
  return useApiQuery(dbAdminContract.terminalAvailability, { enabled, staleTime: 5 * 60 * 1000 });
}

export function fetchDbAdminTableStructure(schema: string, table: string) {
  return api(dbAdminContract.tableStructure, { params: tableParams(schema, table) });
}

export function useDbAdminTableStructure(schema: string | undefined, table: string | undefined, enabled = true) {
  return useApiQuery(dbAdminContract.tableStructure, { params: tableParams(schema ?? '', table ?? '') }, {
    enabled: enabled && !!schema && !!table,
  });
}

export function useDbAdminHistory(params: DbAdminHistoryParams, enabled = true) {
  return useApiQuery(dbAdminContract.history, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDbAdminErSchema(enabled = true) {
  return useApiQuery(dbAdminContract.erSchema, { enabled });
}

export function useDbAdminObjects(enabled = true) {
  return useApiQuery(dbAdminContract.objects, { enabled });
}

export function useDbAdminActivity(auto: boolean) {
  return useApiQuery(dbAdminContract.activity, { refetchInterval: auto ? 5000 : false });
}

export function useDbAdminMaintenance() {
  return useApiQuery(dbAdminContract.maintenanceTables);
}

export function useDbAdminIndexHealth() {
  return useApiQuery(dbAdminContract.indexHealth);
}

export function useDbAdminSchemaDrift() {
  return useApiQuery(dbAdminContract.schemaDrift);
}

export function useDbQueryFavorites(enabled = true) {
  return useApiQuery(dbAdminContract.favorites, { enabled });
}

// ─── SQL 控制台（一次性执行，不进缓存） ────────────────────────────────────────

export function useDbAdminExecuteQuery() {
  return useApiMutation(dbAdminContract.query, { requestOptions: { silent: true } });
}

export function useDbAdminCancelQuery() {
  return useApiMutation(dbAdminContract.cancelQuery, { requestOptions: { silent: true } });
}

export function useDbAdminExplain() {
  return useApiMutation(dbAdminContract.explain, { requestOptions: { silent: true } });
}

/** SQL 结果导出（CSV / JSON）的流式下载地址；由 `request.getBlob(url, { method: 'POST', body })` 消费 */
export function dbAdminQueryExportUrl(format: 'csv' | 'json') {
  return urlOf(format === 'csv' ? dbAdminContract.exportQueryCsv : dbAdminContract.exportQueryJson);
}

export function dbAdminTableExportCsvUrl(schema: string, table: string) {
  return urlOf(dbAdminContract.exportTableCsv, { params: tableParams(schema, table) });
}

export function dbAdminTableExportSqlUrl(schema: string, table: string, mode: DbAdminSqlExportMode) {
  return urlOf(dbAdminContract.exportTableSql, { params: tableParams(schema, table), query: { mode } });
}

// ─── SQL 收藏夹 ───────────────────────────────────────────────────────────────

/** 无 id 走新增，有 id 走更新；收藏夹为当前用户私有清单，只失效自身 */
export function useSaveDbQueryFavorite() {
  const qc = useQueryClient();
  return useMutation({
    // 同一表单同时服务新增与编辑，必填字段由表单 rules 保证、服务端 schema 兜底校验
    mutationFn: ({ id, values }: { id?: number; values: Partial<CreateDbQueryFavoriteInput> }) =>
      (id === undefined
        ? api(dbAdminContract.createFavorite, { body: values as CreateDbQueryFavoriteInput })
        : api(dbAdminContract.updateFavorite, { params: { id }, body: values })),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.favorites }),
  });
}

export function useDeleteDbQueryFavorite() {
  return useApiMutation(dbAdminContract.removeFavorite, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.favorites });
    },
  });
}

// ─── 查询历史 ─────────────────────────────────────────────────────────────────

export function useDeleteDbQueryHistory() {
  return useApiMutation(dbAdminContract.removeHistory, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.historyLists });
    },
  });
}

export function useClearDbQueryHistory() {
  return useApiMutation(dbAdminContract.clearHistory, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.historyLists });
    },
  });
}

// ─── 表数据写操作 ─────────────────────────────────────────────────────────────

/** 截断只清空数据：表清单的行数估算随之变化 */
export function useDbAdminTruncateTable() {
  return useApiMutation(dbAdminContract.truncateTable, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.tables });
    },
  });
}

/** 刷新物化视图影响行数与维护统计等多处，按域根广播 */
export function useDbAdminRefreshMatview() {
  return useApiMutation(dbAdminContract.refreshMatview, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.all });
    },
  });
}

export function useDbAdminBatchMutateRows() {
  return useApiMutation(dbAdminContract.batchMutate, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.tables });
    },
  });
}

export function useDbAdminImportRows() {
  return useApiMutation(dbAdminContract.importRows, {
    requestOptions: { silent: true },
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.tables });
    },
  });
}

export function useDbAdminInsertRow() {
  return useApiMutation(dbAdminContract.insertRow);
}

export function useDbAdminUpdateRow() {
  return useApiMutation(dbAdminContract.updateRow);
}

// ─── 运维 ─────────────────────────────────────────────────────────────────────

/** 取消查询 / 终止连接：活动连接列表随之变化 */
export function useDbAdminActivityAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, action }: { pid: number; action: 'cancel' | 'terminate' }) =>
      api(action === 'cancel' ? dbAdminContract.cancelBackend : dbAdminContract.terminateBackend, { params: { pid } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.activity }),
  });
}

export function useDbAdminRunMaintenance() {
  return useApiMutation(dbAdminContract.runMaintenance, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.maintenance });
    },
  });
}
