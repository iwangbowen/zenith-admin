import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { dbAdminContract, type DbAdminSqlExportMode, type DbBackupStatus } from '@zenith/shared/ops';
import { api, useSaveMutation, contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type DbAdminHistoryParams = NonNullable<QueryOf<typeof dbAdminContract.history>>;

export type DbBackupListParams = NonNullable<QueryOf<typeof dbAdminContract.backups>>;

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
  backupLists: contractKey(dbAdminContract.backups),
  backupList: (params: DbBackupListParams) => contractKey(dbAdminContract.backups, { query: params }),
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
  return useSaveMutation(dbAdminContract.createFavorite, dbAdminContract.updateFavorite, {
    invalidate: (qc) => qc.invalidateQueries({ queryKey: dbAdminKeys.favorites }),
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

// ─── 数据库备份 ───────────────────────────────────────────────────────────────

const DB_BACKUP_ACTIVE_STATUSES: ReadonlySet<DbBackupStatus> = new Set(['pending', 'running']);

/** 备份任务在后台执行：面板可见且列表里仍有未完成记录时每 3 秒轮询，直到全部落到 success / failed */
export function useDbBackups(params: DbBackupListParams, enabled = true) {
  return useApiQuery(dbAdminContract.backups, { query: params }, {
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      (enabled && query.state.data?.list.some((item) => DB_BACKUP_ACTIVE_STATUSES.has(item.status)) ? 3000 : false),
  });
}

/** 创建只返回任务回执；新记录经列表失效回源，后续状态由轮询跟进 */
export function useCreateDbBackup() {
  return useApiMutation(dbAdminContract.createBackup, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.backupLists });
    },
  });
}

export function useDeleteDbBackup() {
  return useApiMutation(dbAdminContract.removeBackup, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dbAdminKeys.backupLists });
    },
  });
}
