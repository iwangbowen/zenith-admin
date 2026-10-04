import { index, integer, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import type { CmsTelemetryAttributionStatus, CmsTelemetryBusinessPayload } from '@zenith/shared/cms';
import { idColumn, timestamptz } from './common';
import { cmsSites } from './cms';
import { userEvents } from './analytics';

/** Delivery diagnostics are distinct from business events and never counted as PV. */
export const cmsTelemetryReceipts = pgTable('cms_telemetry_receipts', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  accepted: integer().notNull().default(0), rejected: integer().notNull().default(0), duplicates: integer().notNull().default(0),
  reason: varchar({ length: 64 }), createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [index('cms_telemetry_receipts_site_created_idx').on(t.siteId, t.createdAt)]);

/** Persisted in the business transaction; worker delivery is retryable and idempotent. */
export const cmsTelemetryOutbox = pgTable('cms_telemetry_outbox', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  eventId: uuid().notNull().unique('cms_telemetry_outbox_event_id_unique'),
  payload: jsonb().$type<CmsTelemetryBusinessPayload>().notNull(), attempts: integer().notNull().default(0),
  lastError: text(), consecutiveFailures: integer().notNull().default(0), replayCount: integer().notNull().default(0),
  nextAttemptAt: timestamptz().notNull().defaultNow(), lastAttemptAt: timestamptz(),
  leaseOwner: uuid(), leaseExpiresAt: timestamptz(), deadLetterAt: timestamptz(),
  deliveredAt: timestamptz(),
  createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  index('cms_telemetry_outbox_pending_idx').on(t.deliveredAt, t.deadLetterAt, t.nextAttemptAt, t.id),
  index('cms_telemetry_outbox_lease_idx').on(t.deliveredAt, t.deadLetterAt, t.leaseExpiresAt),
  index('cms_telemetry_outbox_delivered_idx').on(t.deliveredAt),
  index('cms_telemetry_outbox_dead_idx').on(t.deadLetterAt),
]);

/** Recomputable attribution; immutable business events are never rewritten by late client events. */
export const cmsTelemetryAttributions = pgTable('cms_telemetry_attributions', {
  eventId: uuid().primaryKey().references(() => userEvents.eventId, { onDelete: 'cascade' }), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  status: varchar({ length: 32 }).$type<CmsTelemetryAttributionStatus>().notNull(),
  origin: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  computedAt: timestamptz().notNull(), nextRecomputeAt: timestamptz(),
  settledAt: timestamptz(),
}, (t) => [index('cms_telemetry_attributions_due_idx').on(t.nextRecomputeAt), index('cms_telemetry_attributions_site_idx').on(t.siteId)]);
