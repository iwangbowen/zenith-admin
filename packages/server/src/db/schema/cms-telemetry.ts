import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { CmsTelemetryAttributionStatus, CmsTelemetryBusinessPayload } from '@zenith/shared/cms';
import { idColumn } from './common';
import { cmsSites } from './cms';
import { userEvents } from './analytics';

/** Delivery diagnostics are distinct from business events and never counted as PV. */
export const cmsTelemetryReceipts = pgTable('cms_telemetry_receipts', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  accepted: integer().notNull().default(0), rejected: integer().notNull().default(0), duplicates: integer().notNull().default(0),
  reason: varchar({ length: 64 }), createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('cms_telemetry_receipts_site_created_idx').on(t.siteId, t.createdAt)]);

/** Persisted in the business transaction; worker delivery is retryable and idempotent. */
export const cmsTelemetryOutbox = pgTable('cms_telemetry_outbox', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  eventId: uuid().notNull().unique('cms_telemetry_outbox_event_id_unique'),
  payload: jsonb().$type<CmsTelemetryBusinessPayload>().notNull(), attempts: integer().notNull().default(0),
  lastError: text(), consecutiveFailures: integer().notNull().default(0), replayCount: integer().notNull().default(0),
  nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(), lastAttemptAt: timestamp({ withTimezone: true }),
  leaseOwner: uuid(), leaseExpiresAt: timestamp({ withTimezone: true }), deadLetterAt: timestamp({ withTimezone: true }),
  deliveredAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
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
  computedAt: timestamp({ withTimezone: true }).notNull(), nextRecomputeAt: timestamp({ withTimezone: true }),
  settledAt: timestamp({ withTimezone: true }),
}, (t) => [index('cms_telemetry_attributions_due_idx').on(t.nextRecomputeAt), index('cms_telemetry_attributions_site_idx').on(t.siteId)]);
