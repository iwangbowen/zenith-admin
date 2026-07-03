import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DbQueryFavorite, PaginatedResponse } from '@zenith/shared';
import type { ErSchema } from '@/pages/system/db-admin/ErDiagram';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface DbAdminTableItem {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'matview';
  rowEstimate: number;
  sizeBytes: number;
  sizeText: string;
  comment: string | null;
}

export interface DbAdminColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment: string | null;
  maxLength: number | null;
  enumValues?: string[] | null;
}

export interface DbAdminIndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  definition: string;
}

export interface DbAdminForeignKeyInfo {
  name: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface DbAdminTableStructure {
  columns: DbAdminColumnInfo[];
  indexes: DbAdminIndexInfo[];
  foreignKeys: DbAdminForeignKeyInfo[];
  primaryKey: string[];
}

export interface DbAdminOverviewTopTable {
  schema: string;
  name: string;
  sizeBytes: number;
  sizeText: string;
  rowEstimate: number;
}

export interface DbAdminOverview {
  version: string;
  databaseName: string;
  databaseSize: number;
  databaseSizeText: string;
  schemaCount: number;
  tableCount: number;
  viewCount: number;
  indexCount: number;
  totalRowEstimate: number;
  activeConnections: number;
  maxConnections: number;
  startedAt: string | null;
  uptimeSeconds: number;
  topTables: DbAdminOverviewTopTable[];
}

export interface DbAdminObjects {
  sequences: Array<{ schema: string; name: string; dataType: string; startValue: string; incrementBy: string; lastValue: string | null }>;
  functions: Array<{ schema: string; name: string; kind: string; language: string; args: string; result: string; definition: string | null }>;
  triggers: Array<{ schema: string; table: string; name: string; enabled: boolean; definition: string }>;
  enums: Array<{ schema: string; name: string; values: string[] }>;
  extensions: Array<{ name: string; version: string; schema: string; comment: string | null }>;
}

export interface DbAdminActivityConnection {
  pid: number;
  username: string | null;
  applicationName: string | null;
  clientAddr: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  backendType: string | null;
  query: string | null;
  querySeconds: number | null;
  xactSeconds: number | null;
  backendSeconds: number | null;
  queryStart: string | null;
  backendStart: string | null;
  blockedBy: number[];
  isCurrent: boolean;
}

export interface DbAdminTableMaintenance {
  schema: string;
  name: string;
  liveTuples: number;
  deadTuples: number;
  deadRatio: number;
  sizeBytes: number;
  sizeText: string;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
}

export interface DbAdminIndexInfoRow {
  schema: string;
  table: string;
  index: string;
  scans: number;
  sizeBytes: number;
  sizeText: string;
  isUnique: boolean;
  isPrimary: boolean;
  columns: string[];
  definition: string;
}

export interface DbAdminIndexHealth {
  unused: DbAdminIndexInfoRow[];
  duplicate: Array<{ schema: string; table: string; columns: string[]; indexes: DbAdminIndexInfoRow[] }>;
  totalIndexes: number;
  totalIndexBytes: number;
}

export interface DbAdminColumnDiff {
  column: string;
  issue: 'missing_in_db' | 'extra_in_db' | 'type_mismatch' | 'nullable_mismatch';
  expected: string | null;
  actual: string | null;
}

export interface DbAdminTableDrift {
  schema: string;
  table: string;
  status: 'missing_in_db' | 'extra_in_db' | 'column_diff';
  columns: DbAdminColumnDiff[];
}

export interface DbAdminSchemaDrift {
  inSync: boolean;
  expectedTables: number;
  actualTables: number;
  drifts: DbAdminTableDrift[];
}

export interface DbAdminQueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
  paginated: boolean;
  total: number | null;
  page: number | null;
  pageSize: number | null;
}

export interface DbAdminQueryHistoryItem {
  id: number;
  sqlText: string;
  durationMs: number;
  rowCount: number;
  success: boolean;
  errorMessage: string | null;
  executedAt: string;
}

export interface DbAdminHistoryParams {
  page: number;
  pageSize: number;
}

export interface DbAdminImportResult {
  inserted: number;
}

export interface DbAdminBatchMutateResult {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface DbAdminExplainResult {
  plan: unknown;
  durationMs: number;
  analyzed: boolean;
}

export const dbAdminKeys = {
  all: ['db-admin'] as const,
  tables: ['db-admin', 'tables'] as const,
  overview: ['db-admin', 'overview'] as const,
  structure: (schema: string | undefined, table: string | undefined) => ['db-admin', 'structure', schema, table] as const,
  historyLists: ['db-admin', 'history', 'list'] as const,
  historyList: (params: DbAdminHistoryParams) => ['db-admin', 'history', 'list', params] as const,
  erSchema: ['db-admin', 'er-schema'] as const,
  objects: ['db-admin', 'objects'] as const,
  activity: ['db-admin', 'activity'] as const,
  maintenance: ['db-admin', 'maintenance'] as const,
  indexHealth: ['db-admin', 'index-health'] as const,
  schemaDrift: ['db-admin', 'schema-drift'] as const,
  favorites: ['db-admin', 'query-favorites'] as const,
};

export function useDbAdminOverview() {
  return useQuery({
    queryKey: dbAdminKeys.overview,
    queryFn: () => request.get<DbAdminOverview>('/api/db-admin/overview').then(unwrap),
  });
}

export function useDbAdminTables() {
  return useQuery({
    queryKey: dbAdminKeys.tables,
    queryFn: () => request.get<DbAdminTableItem[]>('/api/db-admin/tables').then(unwrap),
  });
}

export function fetchDbAdminTableStructure(schema: string, table: string) {
  return request
    .get<DbAdminTableStructure>(`/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/structure`)
    .then(unwrap);
}

export function useDbAdminTableStructure(schema: string | undefined, table: string | undefined, enabled = true) {
  return useQuery({
    queryKey: dbAdminKeys.structure(schema, table),
    queryFn: () => fetchDbAdminTableStructure(schema!, table!),
    enabled: enabled && !!schema && !!table,
  });
}

export function useDbAdminHistory(params: DbAdminHistoryParams, enabled = true) {
  return useQuery({
    queryKey: dbAdminKeys.historyList(params),
    queryFn: () =>
      request.get<PaginatedResponse<DbAdminQueryHistoryItem>>(`/api/db-admin/query/history${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDbAdminErSchema(enabled = true) {
  return useQuery({
    queryKey: dbAdminKeys.erSchema,
    queryFn: () => request.get<ErSchema>('/api/db-admin/er-schema').then(unwrap),
    enabled,
  });
}

export function useDbAdminObjects(enabled = true) {
  return useQuery({
    queryKey: dbAdminKeys.objects,
    queryFn: () => request.get<DbAdminObjects>('/api/db-admin/objects').then(unwrap),
    enabled,
  });
}

export function useDbAdminActivity(auto: boolean) {
  return useQuery({
    queryKey: dbAdminKeys.activity,
    queryFn: () => request.get<DbAdminActivityConnection[]>('/api/db-admin/activity').then(unwrap),
    refetchInterval: auto ? 5000 : false,
  });
}

export function useDbAdminMaintenance() {
  return useQuery({
    queryKey: dbAdminKeys.maintenance,
    queryFn: () => request.get<DbAdminTableMaintenance[]>('/api/db-admin/maintenance/tables').then(unwrap),
  });
}

export function useDbAdminIndexHealth() {
  return useQuery({
    queryKey: dbAdminKeys.indexHealth,
    queryFn: () => request.get<DbAdminIndexHealth>('/api/db-admin/index-health').then(unwrap),
  });
}

export function useDbAdminSchemaDrift() {
  return useQuery({
    queryKey: dbAdminKeys.schemaDrift,
    queryFn: () => request.get<DbAdminSchemaDrift>('/api/db-admin/schema-drift').then(unwrap),
  });
}

export function useDbQueryFavorites(enabled = true) {
  return useQuery({
    queryKey: dbAdminKeys.favorites,
    queryFn: () => request.get<DbQueryFavorite[]>('/api/db-admin/query-favorites').then(unwrap),
    enabled,
  });
}

export function useDbAdminExecuteQuery() {
  return useMutation({
    mutationFn: (body: { sql: string; queryId: string; page: number; pageSize: number }) =>
      request.post<DbAdminQueryResult>('/api/db-admin/query', body, { silent: true }).then(unwrap),
  });
}

export function useDbAdminCancelQuery() {
  return useMutation({
    mutationFn: (queryId: string) =>
      request.post<{ ok: boolean }>('/api/db-admin/query/cancel', { queryId }, { silent: true }).then(unwrap),
  });
}

export function useDbAdminExplain() {
  return useMutation({
    mutationFn: ({ sql, analyze }: { sql: string; analyze: boolean }) =>
      request.post<DbAdminExplainResult>('/api/db-admin/explain', { sql, analyze }, { silent: true }).then(unwrap),
  });
}

export function useSaveDbQueryFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: { name?: string; sql?: string; description?: string; tags?: string[] } }) =>
      (id === undefined
        ? request.post<DbQueryFavorite>('/api/db-admin/query-favorites', values)
        : request.put<DbQueryFavorite>(`/api/db-admin/query-favorites/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.favorites }),
  });
}

export function useDeleteDbQueryFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/db-admin/query-favorites/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.favorites }),
  });
}

export function useDeleteDbQueryHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/db-admin/query/history/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.historyLists }),
  });
}

export function useClearDbQueryHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.delete<null>('/api/db-admin/query/history').then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.historyLists }),
  });
}

export function useDbAdminTruncateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ schema, table }: { schema: string; table: string }) =>
      request.post<null>(`/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/truncate`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.tables }),
  });
}

export function useDbAdminRefreshMatview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ schema, table }: { schema: string; table: string }) =>
      request.post<null>(`/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/refresh`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.all }),
  });
}

export function useDbAdminBatchMutateRows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ schema, table, values }: {
      schema: string;
      table: string;
      values: {
        inserts?: Array<Record<string, unknown>>;
        updates?: Array<{ pk: Record<string, unknown>; changes: Record<string, unknown> }>;
        deletes?: Array<{ pk: Record<string, unknown> }>;
      };
    }) =>
      request
        .post<DbAdminBatchMutateResult>(`/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/batch-mutate`, values)
        .then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.tables }),
  });
}

export function useDbAdminImportRows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ schema, table, rows }: { schema: string; table: string; rows: Array<Record<string, unknown>> }) =>
      request
        .post<DbAdminImportResult>(
          `/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/import`,
          { rows },
          { silent: true },
        )
        .then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.tables }),
  });
}

export function useDbAdminActivityAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, action }: { pid: number; action: 'cancel' | 'terminate' }) =>
      request.post<{ ok: boolean }>(`/api/db-admin/activity/${pid}/${action}`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.activity }),
  });
}

export function useDbAdminRunMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ schema, table, action }: { schema: string; table: string; action: 'vacuum' | 'vacuum_analyze' | 'analyze' | 'reindex' }) =>
      request.post<null>(`/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/maintenance`, { action }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbAdminKeys.maintenance }),
  });
}
