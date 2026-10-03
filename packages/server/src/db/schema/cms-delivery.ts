import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';
import { cmsResources, cmsSites } from './cms';
import { cmsDeployments, cmsReleaseActivations, cmsReleases } from './cms-releases';
import { asyncTasks } from './tasks';
import type { CmsDeliveryObservation, CmsDeliveryPathExpectation, CmsDeliveryRun } from '@zenith/shared/cms';

/** Live visibility changes have their own epoch, independent of activation counters. */
export const cmsDeliveryStates = pgTable('cms_delivery_states', {
  siteId: integer().primaryKey().references(() => cmsSites.id, { onDelete: 'cascade' }),
  visibilityEpoch: integer().notNull().default(0),
  latestRunId: integer().references((): AnyPgColumn => cmsDeliveryRuns.id, { onDelete: 'set null' }),
  ...timestampColumns(),
});

/** Evidence belongs to one activation/visibility identity and is never reused by a later identity. */
export const cmsDeliveryRuns = pgTable('cms_delivery_runs', {
  id: idColumn(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  releaseId: integer().references(() => cmsReleases.id, { onDelete: 'set null' }),
  generationId: integer().references(() => cmsDeployments.id, { onDelete: 'set null' }),
  activationId: integer().references(() => cmsReleaseActivations.id, { onDelete: 'set null' }),
  visibilityEpoch: integer().notNull(),
  configVersion: integer().notNull(),
  eventKey: varchar({ length: 240 }).notNull(),
  cause: varchar({ length: 24 }).$type<CmsDeliveryRun['cause']>().notNull(),
  status: varchar({ length: 24 }).$type<CmsDeliveryRun['status']>().notNull().default('activated'),
  taskId: integer().references(() => asyncTasks.id, { onDelete: 'set null' }),
  sourceBaseUrl: varchar({ length: 1000 }), publicBaseUrl: varchar({ length: 1000 }), sourceHost: varchar({ length: 255 }),
  purgeStatus: varchar({ length: 24 }).$type<CmsDeliveryRun['purgeStatus']>().notNull().default('pending'),
  purgeHttpStatus: integer(), purgeMessage: text(),
  paths: jsonb().$type<CmsDeliveryPathExpectation[]>().notNull(),
  observations: jsonb().$type<CmsDeliveryObservation[]>().notNull().default([]),
  error: text(), startedAt: timestamp(), completedAt: timestamp(),
  ...timestampColumns(),
}, t => [
  uniqueIndex('cms_delivery_runs_site_event_uq').on(t.siteId, t.eventKey),
  index('cms_delivery_runs_site_id_idx').on(t.siteId, t.id),
  index('cms_delivery_runs_release_idx').on(t.releaseId),
  index('cms_delivery_runs_status_started_idx').on(t.status, t.startedAt),
  index('cms_delivery_runs_purge_created_idx').on(t.purgeStatus, t.createdAt),
  index('cms_delivery_runs_status_completed_idx').on(t.status, t.completedAt),
]);

/** One receipt for each resource's most recently handled natural expiration. */
export const cmsDeliveryExpiryReceipts = pgTable('cms_delivery_expiry_receipts', {
  resourceId: integer().primaryKey().references(() => cmsResources.id, { onDelete: 'cascade' }),
  expiresAt: timestamp().notNull(),
  ...timestampColumns(),
});
export type CmsDeliveryRunRow = typeof cmsDeliveryRuns.$inferSelect;
