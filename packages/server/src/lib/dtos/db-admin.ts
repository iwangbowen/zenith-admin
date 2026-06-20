/**
 * 数据库管理（DB Inspector）相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const DbAdminTableItemDTO = z
  .object({
    schema: z.string(),
    name: z.string(),
    /** table=普通表, view=视图, matview=物化视图 */
    kind: z.enum(['table', 'view', 'matview']),
    rowEstimate: z.number(),
    sizeBytes: z.number(),
    sizeText: z.string(),
    comment: z.string().nullable(),
  })
  .openapi('DbAdminTableItem');

export const DbAdminOverviewTopTableDTO = z
  .object({
    schema: z.string(),
    name: z.string(),
    sizeBytes: z.number(),
    sizeText: z.string(),
    rowEstimate: z.number(),
  })
  .openapi('DbAdminOverviewTopTable');

export const DbAdminOverviewDTO = z
  .object({
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
    topTables: z.array(DbAdminOverviewTopTableDTO),
  })
  .openapi('DbAdminOverview');

export const DbAdminColumnDTO = z
  .object({
    name: z.string(),
    dataType: z.string(),
    isNullable: z.boolean(),
    defaultValue: z.string().nullable(),
    isPrimaryKey: z.boolean(),
    comment: z.string().nullable(),
    maxLength: z.number().nullable(),
  })
  .openapi('DbAdminColumn');

export const DbAdminIndexDTO = z
  .object({
    name: z.string(),
    columns: z.array(z.string()),
    isUnique: z.boolean(),
    isPrimary: z.boolean(),
    definition: z.string(),
  })
  .openapi('DbAdminIndex');

export const DbAdminForeignKeyDTO = z
  .object({
    name: z.string(),
    columns: z.array(z.string()),
    referencedSchema: z.string(),
    referencedTable: z.string(),
    referencedColumns: z.array(z.string()),
    onUpdate: z.string(),
    onDelete: z.string(),
  })
  .openapi('DbAdminForeignKey');

export const DbAdminTableStructureDTO = z
  .object({
    columns: z.array(DbAdminColumnDTO),
    indexes: z.array(DbAdminIndexDTO),
    foreignKeys: z.array(DbAdminForeignKeyDTO),
    primaryKey: z.array(z.string()),
  })
  .openapi('DbAdminTableStructure');

export const DbAdminQueryResultColumnDTO = z
  .object({
    name: z.string(),
    dataType: z.string(),
  })
  .openapi('DbAdminQueryResultColumn');

export const DbAdminQueryResultDTO = z
  .object({
    columns: z.array(DbAdminQueryResultColumnDTO),
    rows: z.array(z.record(z.string(), z.unknown())),
    rowCount: z.number(),
    durationMs: z.number(),
    truncated: z.boolean(),
  })
  .openapi('DbAdminQueryResult');

export const DbAdminExplainResultDTO = z
  .object({
    plan: z.unknown(),
    durationMs: z.number(),
    analyzed: z.boolean(),
  })
  .openapi('DbAdminExplainResult');

export const DbAdminQueryHistoryItemDTO = z
  .object({
    id: z.number().int(),
    sqlText: z.string(),
    durationMs: z.number(),
    rowCount: z.number(),
    success: z.boolean(),
    errorMessage: z.string().nullable(),
    executedAt: z.string(),
  })
  .openapi('DbAdminQueryHistoryItem');

export const DbAdminErDiagramFkDTO = z
  .object({
    schema: z.string(),
    table: z.string(),
    columns: z.array(z.string()),
    referencedSchema: z.string(),
    referencedTable: z.string(),
    referencedColumns: z.array(z.string()),
  })
  .openapi('DbAdminErDiagramFk');

export const DbAdminErColumnDTO = z
  .object({
    name: z.string(),
    dataType: z.string(),
    isPrimaryKey: z.boolean(),
  })
  .openapi('DbAdminErColumn');

export const DbAdminErTableDTO = z
  .object({
    schema: z.string(),
    name: z.string(),
    columns: z.array(DbAdminErColumnDTO),
  })
  .openapi('DbAdminErTable');

export const DbAdminErSchemaDTO = z
  .object({
    tables: z.array(DbAdminErTableDTO),
    foreignKeys: z.array(DbAdminErDiagramFkDTO),
  })
  .openapi('DbAdminErSchema');

export const DbQueryFavoriteDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    sql: z.string(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('DbQueryFavorite');

// ─── 运维监控：活动连接 ─────────────────────────────────────────────────────────
export const DbAdminActivityConnectionDTO = z
  .object({
    pid: z.number().int(),
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
    blockedBy: z.array(z.number().int()),
    isCurrent: z.boolean(),
  })
  .openapi('DbAdminActivityConnection');

// ─── 运维监控：表维护 ───────────────────────────────────────────────────────────
export const DbAdminTableMaintenanceDTO = z
  .object({
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
  })
  .openapi('DbAdminTableMaintenance');

// ─── 运维监控：索引健康 ─────────────────────────────────────────────────────────
export const DbAdminIndexInfoDTO = z
  .object({
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
  })
  .openapi('DbAdminIndexInfo');

export const DbAdminIndexHealthDTO = z
  .object({
    unused: z.array(DbAdminIndexInfoDTO),
    duplicate: z.array(z.object({
      schema: z.string(),
      table: z.string(),
      columns: z.array(z.string()),
      indexes: z.array(DbAdminIndexInfoDTO),
    })),
    totalIndexes: z.number(),
    totalIndexBytes: z.number(),
  })
  .openapi('DbAdminIndexHealth');

// ─── 对象浏览 ───────────────────────────────────────────────────────────────────
export const DbAdminObjectsDTO = z
  .object({
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
  })
  .openapi('DbAdminObjects');

// ─── Drizzle Schema 漂移对照 ────────────────────────────────────────────────────
export const DbAdminColumnDiffDTO = z
  .object({
    column: z.string(),
    issue: z.enum(['missing_in_db', 'extra_in_db', 'type_mismatch', 'nullable_mismatch']),
    expected: z.string().nullable(),
    actual: z.string().nullable(),
  })
  .openapi('DbAdminColumnDiff');

export const DbAdminTableDriftDTO = z
  .object({
    schema: z.string(),
    table: z.string(),
    status: z.enum(['missing_in_db', 'extra_in_db', 'column_diff']),
    columns: z.array(DbAdminColumnDiffDTO),
  })
  .openapi('DbAdminTableDrift');

export const DbAdminSchemaDriftDTO = z
  .object({
    inSync: z.boolean(),
    expectedTables: z.number(),
    actualTables: z.number(),
    drifts: z.array(DbAdminTableDriftDTO),
  })
  .openapi('DbAdminSchemaDrift');

export const DbAdminOpResultDTO = z
  .object({ ok: z.boolean() })
  .openapi('DbAdminOpResult');
