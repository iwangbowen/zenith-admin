import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  DB_ADMIN_COLUMN_DIFF_ISSUES,
  DB_ADMIN_SQL_EXPORT_MODES,
  DB_ADMIN_TABLE_DRIFT_STATUSES,
  DB_ADMIN_TABLE_KINDS,
} from '../constants';
import {
  createDbQueryFavoriteSchema,
  dbAdminBatchMutateSchema,
  dbAdminCancelQuerySchema,
  dbAdminDeleteRowSchema,
  dbAdminExplainBodySchema,
  dbAdminExportQueryBodySchema,
  dbAdminImportRowsSchema,
  dbAdminInsertRowSchema,
  dbAdminMaintenanceActionSchema,
  dbAdminQueryBodySchema,
  dbAdminUpdateRowSchema,
  updateDbQueryFavoriteSchema,
} from '../validation';

// ─── 实体：表 / 结构 ─────────────────────────────────────────────────────────

/** 任意列组成的数据行（列名 → 值，值类型由表结构决定） */
export const dbAdminRowSchema = z.record(z.string(), z.unknown()).meta({ description: '数据行：列名 → 值' });

export type DbAdminRow = z.infer<typeof dbAdminRowSchema>;

export const dbAdminTableItemSchema = z.object({
  schema: z.string(),
  name: z.string(),
  kind: z.enum(DB_ADMIN_TABLE_KINDS),
  rowEstimate: z.number(),
  sizeBytes: z.number(),
  sizeText: z.string(),
  comment: z.string().nullable(),
}).meta({ id: 'DbAdminTableItem' });

export type DbAdminTableItem = z.infer<typeof dbAdminTableItemSchema>;

export const dbAdminOverviewTopTableSchema = z.object({
  schema: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  sizeText: z.string(),
  rowEstimate: z.number(),
}).meta({ id: 'DbAdminOverviewTopTable' });

export type DbAdminOverviewTopTable = z.infer<typeof dbAdminOverviewTopTableSchema>;

export const dbAdminOverviewSchema = z.object({
  version: z.string(),
  databaseName: z.string(),
  databaseSize: z.number(),
  databaseSizeText: z.string(),
  schemaCount: z.number(),
  tableCount: z.number(),
  viewCount: z.number(),
  indexCount: z.number(),
  totalRowEstimate: z.number(),
  activeConnections: z.number(),
  maxConnections: z.number(),
  startedAt: z.string().nullable(),
  uptimeSeconds: z.number(),
  topTables: z.array(dbAdminOverviewTopTableSchema),
}).meta({ id: 'DbAdminOverview' });

export type DbAdminOverview = z.infer<typeof dbAdminOverviewSchema>;

export const dbAdminColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  isNullable: z.boolean(),
  defaultValue: z.string().nullable(),
  isPrimaryKey: z.boolean(),
  comment: z.string().nullable(),
  maxLength: z.number().nullable(),
  enumValues: z.array(z.string()).nullable().meta({ description: 'PG 枚举列的取值列表（非枚举列为 null）' }),
}).meta({ id: 'DbAdminColumn' });

export type DbAdminColumn = z.infer<typeof dbAdminColumnSchema>;

export const dbAdminIndexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  isUnique: z.boolean(),
  isPrimary: z.boolean(),
  definition: z.string(),
}).meta({ id: 'DbAdminIndex' });

export type DbAdminIndex = z.infer<typeof dbAdminIndexSchema>;

export const dbAdminForeignKeySchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  referencedSchema: z.string(),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()),
  onUpdate: z.string(),
  onDelete: z.string(),
}).meta({ id: 'DbAdminForeignKey' });

export type DbAdminForeignKey = z.infer<typeof dbAdminForeignKeySchema>;

export const dbAdminTableStructureSchema = z.object({
  columns: z.array(dbAdminColumnSchema),
  indexes: z.array(dbAdminIndexSchema),
  foreignKeys: z.array(dbAdminForeignKeySchema),
  primaryKey: z.array(z.string()),
}).meta({ id: 'DbAdminTableStructure' });

export type DbAdminTableStructure = z.infer<typeof dbAdminTableStructureSchema>;

export const dbAdminTableRowsSchema = z.object({
  list: z.array(dbAdminRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
}).meta({ id: 'DbAdminTableRows' });

export type DbAdminTableRows = z.infer<typeof dbAdminTableRowsSchema>;

// ─── 实体：SQL 控制台 ────────────────────────────────────────────────────────

export const dbAdminQueryResultColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
}).meta({ id: 'DbAdminQueryResultColumn' });

export type DbAdminQueryResultColumn = z.infer<typeof dbAdminQueryResultColumnSchema>;

export const dbAdminQueryResultSchema = z.object({
  columns: z.array(dbAdminQueryResultColumnSchema),
  rows: z.array(dbAdminRowSchema),
  rowCount: z.number(),
  durationMs: z.number(),
  truncated: z.boolean(),
  paginated: z.boolean().meta({ description: '是否服务端分页（单条 SELECT / WITH 自动启用）；false 时为整段执行 + 5000 行硬截断' }),
  total: z.number().nullable().meta({ description: '分页时的总行数；非分页为 null' }),
  page: z.number().nullable(),
  pageSize: z.number().nullable(),
}).meta({ id: 'DbAdminQueryResult' });

export type DbAdminQueryResult = z.infer<typeof dbAdminQueryResultSchema>;

export const dbAdminImportResultSchema = z.object({ inserted: z.number() }).meta({ id: 'DbAdminImportResult' });

export type DbAdminImportResult = z.infer<typeof dbAdminImportResultSchema>;

export const dbAdminBatchMutateResultSchema = z.object({
  inserted: z.number(),
  updated: z.number(),
  deleted: z.number(),
}).meta({ id: 'DbAdminBatchMutateResult' });

export type DbAdminBatchMutateResult = z.infer<typeof dbAdminBatchMutateResultSchema>;

export const dbAdminExplainResultSchema = z.object({
  plan: z.unknown().meta({ description: 'EXPLAIN (FORMAT JSON) 计划树' }),
  durationMs: z.number(),
  analyzed: z.boolean(),
}).meta({ id: 'DbAdminExplainResult' });

export type DbAdminExplainResult = z.infer<typeof dbAdminExplainResultSchema>;

export const dbAdminQueryHistoryItemSchema = z.object({
  id: z.int(),
  sqlText: z.string(),
  durationMs: z.number(),
  rowCount: z.number(),
  success: z.boolean(),
  errorMessage: z.string().nullable(),
  executedAt: z.string(),
}).meta({ id: 'DbAdminQueryHistoryItem' });

export type DbAdminQueryHistoryItem = z.infer<typeof dbAdminQueryHistoryItemSchema>;

export const dbQueryFavoriteSchema = z.object({
  id: z.int(),
  name: z.string(),
  sql: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DbQueryFavorite' });

export type DbQueryFavorite = z.infer<typeof dbQueryFavoriteSchema>;

// ─── 实体：ER 图 ─────────────────────────────────────────────────────────────

export const dbAdminErDiagramFkSchema = z.object({
  schema: z.string(),
  table: z.string(),
  columns: z.array(z.string()),
  referencedSchema: z.string(),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()),
}).meta({ id: 'DbAdminErDiagramFk' });

export type DbAdminErDiagramFk = z.infer<typeof dbAdminErDiagramFkSchema>;

export const dbAdminErColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  isPrimaryKey: z.boolean(),
}).meta({ id: 'DbAdminErColumn' });

export type DbAdminErColumn = z.infer<typeof dbAdminErColumnSchema>;

export const dbAdminErTableSchema = z.object({
  schema: z.string(),
  name: z.string(),
  columns: z.array(dbAdminErColumnSchema),
}).meta({ id: 'DbAdminErTable' });

export type DbAdminErTable = z.infer<typeof dbAdminErTableSchema>;

export const dbAdminErSchemaSchema = z.object({
  tables: z.array(dbAdminErTableSchema),
  foreignKeys: z.array(dbAdminErDiagramFkSchema),
}).meta({ id: 'DbAdminErSchema' });

export type DbAdminErSchema = z.infer<typeof dbAdminErSchemaSchema>;

// ─── 实体：运维监控 / 对象浏览 / Schema 漂移 ──────────────────────────────────

export const dbAdminActivityConnectionSchema = z.object({
  pid: z.int(),
  username: z.string().nullable(),
  applicationName: z.string().nullable(),
  clientAddr: z.string().nullable(),
  database: z.string().nullable(),
  state: z.string().nullable(),
  waitEventType: z.string().nullable(),
  waitEvent: z.string().nullable(),
  backendType: z.string().nullable(),
  query: z.string().nullable(),
  querySeconds: z.number().nullable(),
  xactSeconds: z.number().nullable(),
  backendSeconds: z.number().nullable(),
  queryStart: z.string().nullable(),
  backendStart: z.string().nullable(),
  blockedBy: z.array(z.int()),
  isCurrent: z.boolean().meta({ description: '是否为当前请求自身的连接' }),
}).meta({ id: 'DbAdminActivityConnection' });

export type DbAdminActivityConnection = z.infer<typeof dbAdminActivityConnectionSchema>;

export const dbAdminTableMaintenanceSchema = z.object({
  schema: z.string(),
  name: z.string(),
  liveTuples: z.number(),
  deadTuples: z.number(),
  deadRatio: z.number(),
  sizeBytes: z.number(),
  sizeText: z.string(),
  lastVacuum: z.string().nullable(),
  lastAutovacuum: z.string().nullable(),
  lastAnalyze: z.string().nullable(),
  lastAutoanalyze: z.string().nullable(),
  vacuumCount: z.number(),
  autovacuumCount: z.number(),
  analyzeCount: z.number(),
  autoanalyzeCount: z.number(),
}).meta({ id: 'DbAdminTableMaintenance' });

export type DbAdminTableMaintenance = z.infer<typeof dbAdminTableMaintenanceSchema>;

export const dbAdminIndexInfoSchema = z.object({
  schema: z.string(),
  table: z.string(),
  index: z.string(),
  scans: z.number(),
  sizeBytes: z.number(),
  sizeText: z.string(),
  isUnique: z.boolean(),
  isPrimary: z.boolean(),
  columns: z.array(z.string()),
  definition: z.string(),
  partitions: z.number().meta({ description: '归并进本行的叶子分区索引数；普通索引为 1' }),
}).meta({ id: 'DbAdminIndexInfo' });

export type DbAdminIndexInfo = z.infer<typeof dbAdminIndexInfoSchema>;

export const dbAdminIndexHealthSchema = z.object({
  unused: z.array(dbAdminIndexInfoSchema),
  duplicate: z.array(z.object({
    schema: z.string(),
    table: z.string(),
    columns: z.array(z.string()),
    shape: z.string().meta({ description: '判重依据：去掉 UNIQUE / 索引名 / 表名后的定义正文' }),
    indexes: z.array(dbAdminIndexInfoSchema),
  })),
  totalIndexes: z.number(),
  totalIndexBytes: z.number(),
}).meta({ id: 'DbAdminIndexHealth' });

export type DbAdminIndexHealth = z.infer<typeof dbAdminIndexHealthSchema>;

export const dbAdminObjectsSchema = z.object({
  sequences: z.array(z.object({
    schema: z.string(), name: z.string(), dataType: z.string(),
    startValue: z.string(), incrementBy: z.string(), lastValue: z.string().nullable(),
  })),
  functions: z.array(z.object({
    schema: z.string(), name: z.string(), kind: z.string(), language: z.string(),
    args: z.string(), result: z.string(), definition: z.string().nullable(),
  })),
  triggers: z.array(z.object({
    schema: z.string(), table: z.string(), name: z.string(),
    enabled: z.boolean(), definition: z.string(),
  })),
  enums: z.array(z.object({
    schema: z.string(), name: z.string(), values: z.array(z.string()),
  })),
  extensions: z.array(z.object({
    name: z.string(), version: z.string(), schema: z.string(), comment: z.string().nullable(),
  })),
}).meta({ id: 'DbAdminObjects' });

export type DbAdminObjects = z.infer<typeof dbAdminObjectsSchema>;

export const dbAdminColumnDiffSchema = z.object({
  column: z.string(),
  issue: z.enum(DB_ADMIN_COLUMN_DIFF_ISSUES),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
}).meta({ id: 'DbAdminColumnDiff' });

export type DbAdminColumnDiff = z.infer<typeof dbAdminColumnDiffSchema>;

export const dbAdminTableDriftSchema = z.object({
  schema: z.string(),
  table: z.string(),
  status: z.enum(DB_ADMIN_TABLE_DRIFT_STATUSES),
  columns: z.array(dbAdminColumnDiffSchema),
}).meta({ id: 'DbAdminTableDrift' });

export type DbAdminTableDrift = z.infer<typeof dbAdminTableDriftSchema>;

export const dbAdminSchemaDriftSchema = z.object({
  inSync: z.boolean(),
  expectedTables: z.number(),
  actualTables: z.number(),
  drifts: z.array(dbAdminTableDriftSchema),
}).meta({ id: 'DbAdminSchemaDrift' });

export type DbAdminSchemaDrift = z.infer<typeof dbAdminSchemaDriftSchema>;

export const dbAdminOpResultSchema = z.object({ ok: z.boolean() }).meta({ id: 'DbAdminOpResult' });

export type DbAdminOpResult = z.infer<typeof dbAdminOpResultSchema>;

export const dbAdminTerminalAvailabilitySchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  reason: z.string().nullable(),
}).meta({ id: 'DbAdminTerminalAvailability' });

export type DbAdminTerminalAvailability = z.infer<typeof dbAdminTerminalAvailabilitySchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const dbAdminTableParam = z.object({
  schema: z.string().meta({ description: 'schema 名', example: 'public' }),
  name: z.string().meta({ description: '表 / 视图名', example: 'users' }),
});

export const dbAdminTableRowsQuery = paginationQuery.extend({
  orderBy: z.string().optional(),
  orderDir: z.enum(['asc', 'desc']).optional(),
  filters: z.string().optional().meta({ description: 'JSON 字符串：{ 列名: 关键字 }，每列做 ILIKE 模糊匹配' }),
  search: z.string().optional().meta({ description: '全列模糊搜索关键字' }),
  where: z.string().max(2000).optional().meta({ description: '原生 WHERE 片段（需 system:db-admin:query 权限，可跨表子查询）' }),
});

export const dbAdminExportSqlQuery = z.object({
  mode: z.enum(DB_ADMIN_SQL_EXPORT_MODES).default('full').meta({ description: 'ddl=仅结构 data=仅数据 full=结构 + 数据' }),
});

export const dbAdminBackendPidParam = z.object({
  pid: z.coerce.number().int().meta({ description: '数据库后端进程 PID', example: 12345 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const dbAdminContract = defineContract('/api/db-admin', {
  tables: op.get('/tables', { response: z.array(dbAdminTableItemSchema), summary: '表列表' }),
  overview: op.get('/overview', { response: dbAdminOverviewSchema, summary: '数据库总览' }),
  tableStructure: op.get('/tables/{schema}/{name}/structure', { params: dbAdminTableParam, response: dbAdminTableStructureSchema, summary: '表结构' }),
  tableRows: op.get('/tables/{schema}/{name}/rows', { params: dbAdminTableParam, query: dbAdminTableRowsQuery, response: dbAdminTableRowsSchema, summary: '表数据' }),
  insertRow: op.post('/tables/{schema}/{name}/rows', { params: dbAdminTableParam, body: dbAdminInsertRowSchema, response: dbAdminRowSchema, summary: '插入行' }),
  updateRow: op.patch('/tables/{schema}/{name}/rows', { params: dbAdminTableParam, body: dbAdminUpdateRowSchema, response: dbAdminRowSchema, summary: '更新行' }),
  deleteRow: op.delete('/tables/{schema}/{name}/rows', { params: dbAdminTableParam, body: dbAdminDeleteRowSchema, summary: '删除行' }),
  batchMutate: op.post('/tables/{schema}/{name}/batch-mutate', { params: dbAdminTableParam, body: dbAdminBatchMutateSchema, response: dbAdminBatchMutateResultSchema, summary: '批量变更行（事务：插入 / 更新 / 删除）' }),
  importRows: op.post('/tables/{schema}/{name}/import', { params: dbAdminTableParam, body: dbAdminImportRowsSchema, response: dbAdminImportResultSchema, summary: '批量导入数据（CSV / JSON）' }),
  truncateTable: op.post('/tables/{schema}/{name}/truncate', { params: dbAdminTableParam, summary: '截断表（TRUNCATE）' }),
  exportTableSql: op.get('/tables/{schema}/{name}/export.sql', { params: dbAdminTableParam, query: dbAdminExportSqlQuery, kind: 'file', summary: '导出表 SQL（DDL / INSERT / 完整）' }),
  exportTableCsv: op.get('/tables/{schema}/{name}/export.csv', { params: dbAdminTableParam, kind: 'csv', summary: '导出表数据 CSV' }),
  runMaintenance: op.post('/tables/{schema}/{name}/maintenance', { params: dbAdminTableParam, body: dbAdminMaintenanceActionSchema, summary: '执行表维护（VACUUM / ANALYZE / REINDEX）' }),
  refreshMatview: op.post('/tables/{schema}/{name}/refresh', { params: dbAdminTableParam, summary: '刷新物化视图' }),
  query: op.post('/query', { body: dbAdminQueryBodySchema, response: dbAdminQueryResultSchema, summary: '执行只读 SQL' }),
  cancelQuery: op.post('/query/cancel', { body: dbAdminCancelQuerySchema, response: dbAdminOpResultSchema, summary: '取消正在执行的查询' }),
  exportQueryCsv: op.post('/query/export.csv', { body: dbAdminExportQueryBodySchema, kind: 'csv', summary: '导出 SQL 结果 CSV' }),
  exportQueryJson: op.post('/query/export.json', { body: dbAdminExportQueryBodySchema, kind: 'file', summary: '导出 SQL 结果 JSON' }),
  explain: op.post('/explain', { body: dbAdminExplainBodySchema, response: dbAdminExplainResultSchema, summary: 'EXPLAIN 查询计划' }),
  history: op.get('/query/history', { query: paginationQuery, response: paginated(dbAdminQueryHistoryItemSchema), summary: '查询历史' }),
  removeHistory: op.delete('/query/history/{id}', { params: idParam, summary: '删除一条查询历史' }),
  clearHistory: op.delete('/query/history', { summary: '清空查询历史' }),
  erDiagram: op.get('/er-diagram', { response: z.array(dbAdminErDiagramFkSchema), summary: 'ER 图（所有外键关系）' }),
  erSchema: op.get('/er-schema', { response: dbAdminErSchemaSchema, summary: 'ER 图完整模式（表 + 列 + 外键）' }),
  favorites: op.get('/query-favorites', { response: z.array(dbQueryFavoriteSchema), summary: '获取 SQL 收藏夹列表' }),
  createFavorite: op.post('/query-favorites', { body: createDbQueryFavoriteSchema, response: dbQueryFavoriteSchema, summary: '新增 SQL 收藏' }),
  updateFavorite: op.put('/query-favorites/{id}', { params: idParam, body: updateDbQueryFavoriteSchema, response: dbQueryFavoriteSchema, summary: '更新 SQL 收藏' }),
  removeFavorite: op.delete('/query-favorites/{id}', { params: idParam, summary: '删除 SQL 收藏' }),
  activity: op.get('/activity', { response: z.array(dbAdminActivityConnectionSchema), summary: '活动连接列表' }),
  cancelBackend: op.post('/activity/{pid}/cancel', { params: dbAdminBackendPidParam, response: dbAdminOpResultSchema, summary: '取消查询' }),
  terminateBackend: op.post('/activity/{pid}/terminate', { params: dbAdminBackendPidParam, response: dbAdminOpResultSchema, summary: '终止连接' }),
  maintenanceTables: op.get('/maintenance/tables', { response: z.array(dbAdminTableMaintenanceSchema), summary: '表维护统计' }),
  indexHealth: op.get('/index-health', { response: dbAdminIndexHealthSchema, summary: '索引健康' }),
  objects: op.get('/objects', { response: dbAdminObjectsSchema, summary: '数据库对象（序列 / 函数 / 触发器 / 枚举 / 扩展）' }),
  schemaDrift: op.get('/schema-drift', { response: dbAdminSchemaDriftSchema, summary: 'Drizzle Schema 漂移对照' }),
  terminalAvailability: op.get('/terminal-availability', { response: dbAdminTerminalAvailabilitySchema, summary: '数据库终端（psql）可用性' }),
}, { tags: ['DbAdmin'] });
