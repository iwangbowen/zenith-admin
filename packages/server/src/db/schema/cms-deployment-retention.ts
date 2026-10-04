import { bigint, boolean, index, integer, pgEnum, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { CMS_DEFAULT_DEPLOYMENT_RETENTION, CMS_DEPLOYMENT_STORAGE_STATES } from '@zenith/shared/cms';
import { auditColumns } from './core';
import { timestampColumns, timestamptz } from './common';
import { cmsSites } from './cms';
import { cmsDeployments } from './cms-releases';
import { asyncTasks } from './tasks';

export const cmsDeploymentStorageStateEnum = pgEnum('cms_deployment_storage_state', CMS_DEPLOYMENT_STORAGE_STATES);

export const cmsDeploymentRetentionPolicies = pgTable('cms_deployment_retention_policies', {
  siteId: integer().primaryKey().references(() => cmsSites.id, { onDelete: 'cascade' }), version: integer().notNull().default(1),
  retainCount: integer().notNull().default(CMS_DEFAULT_DEPLOYMENT_RETENTION.retainCount), retainDays: integer().notNull().default(CMS_DEFAULT_DEPLOYMENT_RETENTION.retainDays),
  failedRetainDays: integer().notNull().default(CMS_DEFAULT_DEPLOYMENT_RETENTION.failedRetainDays), automatic: boolean().notNull().default(CMS_DEFAULT_DEPLOYMENT_RETENTION.automatic),
  ...auditColumns(), ...timestampColumns(),
});
/** Storage lifecycle is independent from deployment/activation audit history. */
export const cmsDeploymentStorage = pgTable('cms_deployment_storage', {
  deploymentId: integer().primaryKey().references(() => cmsDeployments.id, { onDelete: 'cascade' }),
  siteCode: varchar({ length: 50 }),
  version: integer().notNull().default(1), storageState: cmsDeploymentStorageStateEnum().notNull().default('available'),
  pinned: boolean().notNull().default(false), pinReason: text(), schemaBytes: bigint({ mode: 'number' }), fileBytes: bigint({ mode: 'number' }), fileCount: integer(), measuredAt: timestamptz(),
  cleanupTaskId: integer().references(() => asyncTasks.id, { onDelete: 'set null' }),
  schemaPurgedAt: timestamptz(), filesPurgedAt: timestamptz(), purgedAt: timestamptz(), error: text(),
  ...auditColumns(), ...timestampColumns(),
}, (t) => [index('cms_deployment_storage_state_idx').on(t.storageState)]);
