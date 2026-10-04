import { pgTable, integer, varchar, text, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import type { CmsCollectionDefinition } from '@zenith/shared/cms';
import { cmsSites } from './cms';
import { auditColumns, users } from './core';
import { idColumn, timestampColumns, timestamptz } from './common';
export const cmsContentCollections = pgTable('cms_content_collections', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }), name: varchar({ length: 100 }).notNull(), code: varchar({ length: 80 }).notNull(), description: text(),
  definition: jsonb().$type<CmsCollectionDefinition>().notNull(), version: integer().notNull().default(1), ...auditColumns(), ...timestampColumns(),
}, table => [uniqueIndex('cms_content_collections_site_code_uq').on(table.siteId, table.code)]);
export const cmsContentCollectionVersions = pgTable('cms_content_collection_versions', {
  id: idColumn(), collectionId: integer().notNull().references(() => cmsContentCollections.id, { onDelete: 'cascade' }), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  version: integer().notNull(), name: varchar({ length: 100 }).notNull(), definition: jsonb().$type<CmsCollectionDefinition>().notNull(),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }), createdAt: timestamptz().notNull().defaultNow(),
}, table => [uniqueIndex('cms_collection_versions_collection_version_uq').on(table.collectionId, table.version)]);
