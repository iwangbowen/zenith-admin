/**
 * 数据库管理（DB Inspector）相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const DbAdminTableItemDTO = z
  .object({
    schema: z.string(),
    name: z.string(),
    rowEstimate: z.number(),
    sizeBytes: z.number(),
    sizeText: z.string(),
    comment: z.string().nullable(),
  })
  .openapi('DbAdminTableItem');

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
