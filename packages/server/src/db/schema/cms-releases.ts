import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { CMS_DEPLOYMENT_STATUSES, CMS_RELEASE_STATUSES } from '@zenith/shared/cms';
import type { CmsRelease } from '@zenith/shared/cms';
import { idColumn, timestampColumns } from './common';
import { auditColumns } from './core';
import { cmsContents, cmsSites } from './cms';

export const cmsReleaseStatusEnum = pgEnum('cms_release_status', CMS_RELEASE_STATUSES);
export const cmsDeploymentStatusEnum = pgEnum('cms_deployment_status', CMS_DEPLOYMENT_STATUSES);

/** Complete public projection. Rows are stored as JSON with timestamps in ISO format. */
export interface CmsDeploymentSnapshot {
  tables: Record<string, Record<string, unknown>[]>;
  revisions: Array<{ contentId: number; revisionId: number; hash: string }>;
  sitePublicRevision: number;
  createdAt: string;
  siteCode?: string;
  artifacts?: Array<{ path: string; checksum: string; size: number }>;
}
export const cmsReleases = pgTable('cms_releases', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar({ length: 200 }).notNull(), status: cmsReleaseStatusEnum().notNull().default('draft'),
  baseGenerationId: integer(), deploymentId: integer(),
  items: jsonb().$type<CmsRelease['items']>().notNull().default([]),
  activateAt: timestamp({ withTimezone: true }), timeZone: varchar({ length: 80 }).notNull().default('Asia/Shanghai'),
  autoActivate: boolean().notNull().default(false), error: text(),
  ...auditColumns(), ...timestampColumns(),
}, (t) => [index('cms_releases_site_status_idx').on(t.siteId, t.status), index('cms_releases_schedule_idx').on(t.activateAt)]);
export const cmsDeployments = pgTable('cms_deployments', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  releaseId: integer().notNull().references(() => cmsReleases.id, { onDelete: 'restrict' }),
  status: cmsDeploymentStatusEnum().notNull().default('building'),
  snapshot: jsonb().$type<CmsDeploymentSnapshot>(), manifestHash: varchar({ length: 64 }),
  artifactCount: integer().notNull().default(0), error: text(), activatedAt: timestamp({ withTimezone: true }),
  ...auditColumns(), ...timestampColumns(),
}, (t) => [index('cms_deployments_site_idx').on(t.siteId)]);
export const cmsSiteGenerations = pgTable('cms_site_generations', {
  siteId: integer().primaryKey().references(() => cmsSites.id, { onDelete: 'cascade' }),
  activeGenerationId: integer().references(() => cmsDeployments.id, { onDelete: 'restrict' }),
  revision: integer().notNull().default(0), ...timestampColumns(),
});
export const cmsContentSuppressions = pgTable('cms_content_suppressions', {
  contentId: integer().primaryKey().references(() => cmsContents.id, { onDelete: 'cascade' }),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  reason: text().notNull(), ...auditColumns(), ...timestampColumns(),
}, (t) => [index('cms_content_suppressions_site_idx').on(t.siteId)]);
export type CmsReleaseRow = typeof cmsReleases.$inferSelect;
export type CmsDeploymentRow = typeof cmsDeployments.$inferSelect;
