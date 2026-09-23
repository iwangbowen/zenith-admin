import { integer, pgTable, jsonb, varchar, timestamp, uuid, uniqueIndex, index, boolean, text } from 'drizzle-orm/pg-core';
import type { CmsModelField, CmsFieldConfiguration } from '@zenith/shared/cms';
import { idColumn, timestampColumns } from './common';
import { auditColumns } from './core';
import { cmsModels, cmsResources, cmsSites, cmsContents } from './cms';
import { cmsContentRevisions } from './cms-revisions';
import { managedFiles } from './files';

/** Published model schemas are immutable; current model fields are the designer working copy. */
export const cmsModelVersions = pgTable('cms_model_versions', {
  id: idColumn(), modelId: integer().notNull().references(() => cmsModels.id, { onDelete: 'restrict' }),
  version: integer().notNull(), fields: jsonb().$type<CmsModelField[]>().notNull(),
  contentHash: varchar({ length: 64 }).notNull(), ...auditColumns(),
  createdAt: timestamp().notNull().defaultNow(),
}, (t) => [uniqueIndex('cms_model_versions_model_version_uq').on(t.modelId, t.version)]);

/** A file version remains reachable even when the logical resource is replaced. */
export const cmsAssetVersions = pgTable('cms_asset_versions', {
  id: idColumn(), resourceId: integer().notNull().references(() => cmsResources.id, { onDelete: 'restrict' }),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  version: integer().notNull(), url: varchar({ length: 500 }).notNull(), thumbUrl: varchar({ length: 500 }),
  fileId: uuid().references(() => managedFiles.id, { onDelete: 'restrict' }),
  mimeType: varchar({ length: 128 }), width: integer(), height: integer(), size: integer().notNull(),
  contentHash: varchar({ length: 64 }).notNull(), ...auditColumns(), createdAt: timestamp().notNull().defaultNow(),
}, (t) => [uniqueIndex('cms_asset_versions_resource_version_uq').on(t.resourceId, t.version), index('cms_asset_versions_file_idx').on(t.fileId)]);

export const cmsAssetRights = pgTable('cms_asset_rights', {
  id: idColumn(), resourceId: integer().notNull().references(() => cmsResources.id, { onDelete: 'cascade' }),
  source: varchar({ length: 500 }), license: varchar({ length: 500 }), expiresAt: timestamp(), revoked: boolean().notNull().default(false),
  tags: jsonb().$type<string[]>().notNull().default([]), alt: text(), ...auditColumns(), ...timestampColumns(),
}, (t) => [uniqueIndex('cms_asset_rights_resource_uq').on(t.resourceId)]);

/** Unique model fields are constrained by the database, independent of the write entry point. */
export const cmsModelUniqueValues = pgTable('cms_model_unique_values', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  modelId: integer().notNull().references(() => cmsModels.id, { onDelete: 'cascade' }),
  contentId: integer().notNull(), field: varchar({ length: 50 }).notNull(), valueHash: varchar({ length: 64 }).notNull(),
}, (t) => [uniqueIndex('cms_model_unique_value_uq').on(t.siteId, t.modelId, t.field, t.valueHash), index('cms_model_unique_content_idx').on(t.contentId)]);

export type CmsDesignFieldConfiguration = CmsFieldConfiguration;

export const cmsEditorialNotes = pgTable('cms_editorial_notes', {
  id: idColumn(), contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  revisionId: integer().references(() => cmsContentRevisions.id, { onDelete: 'restrict' }),
  fieldPath: varchar({ length: 200 }), message: text().notNull(),
  mentionedUserIds: jsonb().$type<number[]>().notNull().default([]),
  resolved: boolean().notNull().default(false), ...auditColumns(), ...timestampColumns(),
}, (t) => [index('cms_editorial_notes_content_idx').on(t.contentId, t.id)]);

export const cmsDistributionSyncStates = pgTable('cms_distribution_sync_states', {
  contentId: integer().primaryKey().references(() => cmsContents.id, { onDelete: 'cascade' }),
  sourceVersion: integer().notNull(), baseline: jsonb().$type<Record<string, unknown>>().notNull(),
  targetOwnedFields: jsonb().$type<string[]>().notNull().default([]),
  pending: jsonb().$type<{ sourceVersion: number; targetVersion: number; incoming: Record<string, unknown>; conflicts: Array<{ field: string; base: unknown; target: unknown; incoming: unknown }> }>(),
  ...auditColumns(), ...timestampColumns(),
});
