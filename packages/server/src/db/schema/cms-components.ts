import { pgTable, integer, jsonb, varchar, text, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import type { CmsNestedFieldDefinition } from '@zenith/shared/cms';
import { idColumn, statusColumn, timestampColumns, timestamptz } from './common';
import { auditColumns } from './core';
import { cmsSites } from './cms';

export const cmsComponents = pgTable('cms_components', {
  id: idColumn(), ownerSiteId: integer().references(() => cmsSites.id, { onDelete: 'restrict' }),
  code: varchar({ length: 50 }).notNull().unique(), name: varchar({ length: 100 }).notNull(), description: text(),
  status: statusColumn(), fields: jsonb().$type<CmsNestedFieldDefinition[]>().notNull().default([]),
  version: integer().notNull().default(1), publishedVersionId: integer(), hasUnpublishedChanges: boolean().notNull().default(true),
  ...auditColumns(), ...timestampColumns(),
});
export const cmsComponentVersions = pgTable('cms_component_versions', {
  id: idColumn(), componentId: integer().notNull().references(() => cmsComponents.id, { onDelete: 'restrict' }),
  version: integer().notNull(), fields: jsonb().$type<CmsNestedFieldDefinition[]>().notNull(),
  componentVersionIds: jsonb().$type<number[]>().notNull().default([]), contentHash: varchar({ length: 64 }).notNull(),
  ...auditColumns(), createdAt: timestamptz().notNull().defaultNow(),
}, (table) => [uniqueIndex('cms_component_versions_component_version_uq').on(table.componentId, table.version)]);
export type CmsComponentRow = typeof cmsComponents.$inferSelect;
export type NewCmsComponent = typeof cmsComponents.$inferInsert;
export type CmsComponentVersionRow = typeof cmsComponentVersions.$inferSelect;
